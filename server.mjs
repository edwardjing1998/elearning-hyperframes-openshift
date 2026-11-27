import {handleAgenticApi} from './src/agentic/routes.mjs';
import { handleNarrationPreviewApi } from './src/speech/narration-preview.mjs';
import { handleCaptureApi } from './src/capture/capture-routes.mjs';
import { handleRecordingApi } from './src/recordings/recording-routes.mjs';
import { uploadRenderedVideo, validateStorageConfig } from './src/storage/azure-blob-storage.mjs';
import { synthesizeWav } from './src/speech/azure-speech.mjs';
import { makeNarration, validateNarrationRequest } from './src/services/narration-builder.mjs';
import { wavDuration, addNarrationAudio, addSceneAudioClips } from './src/services/audio-composition.mjs';
import { buildNarrationScenes, makeSceneTiming, injectSceneTiming } from './src/services/scene-narration.mjs';
import { compileKafkaComposition, parseSequenceDiagram } from './src/loaders/diagram-loader.mjs';
import { parseReviewMarkdown } from './src/loaders/markdown-loader.mjs';
import { loadTemplateRegistry, resolveDocument, listDocuments } from './src/loaders/document-registry.mjs';
import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const DATA = process.env.RENDER_DATA_DIR || '/data/jobs';
const COMPOSITION = path.join(ROOT, 'composition');
const TEMPLATES_DIR = path.join(COMPOSITION, 'templates');
const TEMPLATES = loadTemplateRegistry(COMPOSITION);
function safeJsonForScript(value) {
  return JSON.stringify(value).replace(/</g,'\\u003c').replace(/>/g,'\\u003e').replace(/&/g,'\\u0026').replace(/\u2028/g,'\\u2028').replace(/\u2029/g,'\\u2029');
}
function getCompositionHtml(template, document) {
  const config=TEMPLATES[template];
  if (!config) throw new Error('Unknown template');
  let html=fs.readFileSync(path.join(TEMPLATES_DIR,config.html),'utf8');
  if (config.type==='kafka') return compileKafkaComposition(html,document.markdown);
  if (config.type==='review') {
    const result=parseReviewMarkdown(document.markdown);
    if (result.diagramMarkdown) result.diagram=parseSequenceDiagram(result.diagramMarkdown);
    delete result.diagramMarkdown;
    return html.replace('{{RENDER_DATA}}',safeJsonForScript(result));
  }
  if (config.type==='sequence') {
    return html.replace('{{RENDER_DATA}}',safeJsonForScript(parseSequenceDiagram(document.markdown)));
  }
  return html;
}
const PORT = Number(process.env.PORT || 8080);
const API_TOKEN = process.env.RENDER_API_TOKEN || '';
// Validate optional Azure Blob settings before accepting render jobs.
validateStorageConfig();
const jobs = new Map();
const queue = [];
let active = false;

if (!API_TOKEN || API_TOKEN.length < 20) {
  console.error('RENDER_API_TOKEN is required (minimum 20 characters)');
  process.exit(1);
}
await fsp.mkdir(DATA, { recursive: true });
const BIN = path.join(ROOT, 'node_modules', '.bin', 'hyperframes');

function sendJson(res, status, value) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
  res.end(JSON.stringify(value));
}
function safeAuth(req) {
  const candidate = req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.slice(7) : '';
  const x = Buffer.from(candidate);
  const y = Buffer.from(API_TOKEN);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}
function info(job) {
  const { id, status, created_at, finished_at, error } = job;
  return { job_id:id, template: job.template, document: job.documentId || null, narration_enabled: job.narration.enabled, status, created_at, finished_at, error, storage: job.storage || null, download_url: status === 'completed' ? `/api/jobs/${id}/download` : null };
}
// Preserve the original single-worker queue, REST paths, and HyperFrames CLI invocation.
async function renderNext() {
  if (active || !queue.length) return;
  const job = queue.shift();
  active = true;
  job.status = 'running';
  const jobRoot = path.join(DATA, job.id);
  const work = path.join(jobRoot, 'composition');
  const output = path.join(jobRoot, 'review.mp4');
  const logPath = path.join(jobRoot, 'render.log');
  const writeLog = (message) => fs.appendFileSync(logPath, String(message) + '\n');
  try {
    await fsp.mkdir(path.join(work,'assets'), {recursive:true});
    const document = resolveDocument(COMPOSITION,TEMPLATES[job.template],job.documentId);
    let html = getCompositionHtml(job.template, document);
    await fsp.copyFile(path.join(COMPOSITION,'assets','gsap.min.js'),path.join(work,'assets','gsap.min.js'));
    if (job.narration.enabled && !job.narration.text) {
      const scenes=buildNarrationScenes({type:TEMPLATES[job.template].type,markdown:document?.markdown});
      const clips=[];
      for (let i=0;i<scenes.length;i++) {
        const file=path.join(work,'assets',`narration-${String(i+1).padStart(3,'0')}.wav`);
        writeLog(`[speech] Scene ${i+1}/${scenes.length}: ${scenes[i].text.length} characters`);
        await synthesizeWav(scenes[i].text,file);
        clips.push({file:`./assets/${path.basename(file)}`,duration:await wavDuration(file)});
      }
      const timing=makeSceneTiming(clips.map(c=>c.duration));
      html=injectSceneTiming(html,timing);
      html=addSceneAudioClips(html,clips,timing);
      writeLog(`[speech] ${clips.length} synchronized scenes, total ${timing.duration.toFixed(2)}s`);
    } else if (job.narration.enabled) {
      const text = job.narration.text || makeNarration({type:TEMPLATES[job.template].type,markdown:document?.markdown});
      writeLog(`[speech] Synthesizing ${text.length} characters using configured SPEECH_ENDPOINT and SPEECH_VOICE`);
      const file=path.join(work,'assets','narration.wav');
      await synthesizeWav(text,file);
      const duration=await wavDuration(file);
      html=addNarrationAudio(html,duration);
      writeLog(`[speech] WAV ready; duration=${duration.toFixed(2)}s`);
    }
    // Silent or explicitly overridden narration uses the original evenly spaced timeline.
    // For explicit single-track speech, the template's fallback timeline stretches to the WAV duration.
    await fsp.writeFile(path.join(work,'index.html'),html);
    writeLog('[render] Starting HyperFrames CLI');
    const code = await new Promise((resolve,reject) => {
      const child=spawn(BIN,['render','--output',output,'--quality','draft'],{
        cwd:work, env:{...process.env,CI:'true'},stdio:['ignore','pipe','pipe']
      });
      const log=fs.createWriteStream(logPath,{flags:'a'});
      child.stdout.pipe(log,{end:false});
      child.stderr.pipe(log,{end:false});
      child.once('error',reject);
      child.once('close',(exitCode)=>{log.end();resolve(exitCode);});
    });
    if (code!==0 || !fs.existsSync(output)) throw new Error(`HyperFrames exited with code ${code}; see render.log`);
    // Upload only after HyperFrames produced a valid local MP4.
    writeLog('[storage] Uploading rendered MP4 to Azure Blob Storage if enabled');
    job.storage = await uploadRenderedVideo(output, { template: job.template, jobId: job.id });
    if (job.storage) writeLog(`[storage] Uploaded: ${job.storage.container}/${job.storage.blob_name}`);
    else writeLog('[storage] Azure upload disabled; MP4 remains local');
    job.status='completed';
  } catch(err) {
    job.status='failed'; job.error=err.message;
    writeLog(`[error] ${err.message}`);
  } finally {
    job.finished_at=new Date().toISOString();
    await fsp.writeFile(path.join(jobRoot,'status.json'),JSON.stringify(info(job),null,2)).catch(()=>{});
    active=false;
    renderNext();
  }
}
function staticFile(res, file, contentType) {
  const stream = fs.createReadStream(file);
  stream.on('error', () => sendJson(res, 404, { error:'Not found' }));
  stream.on('open', () => {
    res.writeHead(200, { 'content-type': contentType, 'x-content-type-options': 'nosniff', 'cache-control': 'no-store' });
    stream.pipe(res);
  });
}

http.createServer(async (req,res) => {
  const route = new URL(req.url, 'http://localhost').pathname;
  if (req.method === 'GET' && route === '/healthz') return sendJson(res, 200, { status:'ok' });
  if (req.method === 'GET' && route === '/') return staticFile(res, path.join(ROOT,'public','index.html'), 'text/html; charset=utf-8');
  if (req.method === 'GET' && (route === '/capture-studio' || route === '/capture-studio/'))
    return staticFile(res, path.join(ROOT,'public','capture-studio','index.html'), 'text/html; charset=utf-8');
  if (req.method === 'GET' && route === '/capture-studio/capture.js')
    return staticFile(res, path.join(ROOT,'public','capture-studio','capture.js'), 'text/javascript; charset=utf-8');
  if (req.method === 'GET' && route === '/capture-studio/auth.js')
    return staticFile(res, path.join(ROOT,'public','capture-studio','auth.js'), 'text/javascript; charset=utf-8');
  if (req.method === 'GET' && route === '/capture-studio/styles.css')
    return staticFile(res, path.join(ROOT,'public','capture-studio','styles.css'), 'text/css; charset=utf-8');
  if (req.method === 'GET' && (route === '/agentic-video' || route === '/agentic-video/'))
    return staticFile(res, path.join(ROOT,'public','agentic-video','index.html'), 'text/html; charset=utf-8');
  if (req.method === 'GET' && route === '/agentic-video/app.js') return staticFile(res,path.join(ROOT,'public','agentic-video','app.js'),'text/javascript; charset=utf-8');
  if (req.method === 'GET' && route === '/agentic-video/styles.css') return staticFile(res,path.join(ROOT,'public','agentic-video','styles.css'),'text/css; charset=utf-8');
  if (req.method === 'GET' && route === '/capture-studio/sites.json')
    return staticFile(res, path.join(ROOT,'public','capture-studio','sites.json'), 'application/json; charset=utf-8');

  if (req.method === 'GET' && route === '/composition/index.html') return staticFile(res, path.join(TEMPLATES_DIR,'index.html'), 'text/html; charset=utf-8');
  if (req.method === 'GET' && route === '/composition/kafka-sequence.html') {
    try {
      const html = getCompositionHtml('kafka-sequence',resolveDocument(COMPOSITION,TEMPLATES['kafka-sequence']));
      res.writeHead(200, { 'content-type':'text/html; charset=utf-8', 'cache-control':'no-store' });
      return res.end(html);
    } catch (err) { return sendJson(res, 500, { error:'Diagram compilation failed', detail:err.message }); }
  }
  if (req.method === 'GET' && route === '/composition/markdown-review.html') {
    try { res.writeHead(200,{'content-type':'text/html; charset=utf-8'}); return res.end(getCompositionHtml('markdown-review',resolveDocument(COMPOSITION,TEMPLATES['markdown-review']))); }
    catch(err) { return sendJson(res,500,{error:'Review compilation failed',detail:err.message}); }
  }
  if (req.method === 'GET' && route === '/composition/sequence-diagram.html') {
    try { res.writeHead(200,{'content-type':'text/html; charset=utf-8'}); return res.end(getCompositionHtml('sequence-diagram',resolveDocument(COMPOSITION,TEMPLATES['sequence-diagram']))); }
    catch(err) { return sendJson(res,500,{error:'Sequence compilation failed',detail:err.message}); }
  }
  if (req.method === 'GET' && route === '/composition/kafka-sequence.md')
    return staticFile(res, resolveDocument(COMPOSITION,TEMPLATES['kafka-sequence']).filename, 'text/markdown; charset=utf-8');
  if (req.method === 'GET' && route === '/composition/assets/gsap.min.js') return staticFile(res, path.join(COMPOSITION,'assets','gsap.min.js'), 'text/javascript; charset=utf-8');
  if (route.startsWith('/api/')) {
    if (!safeAuth(req)) return sendJson(res, 401, { error:'Unauthorized: supply Authorization: Bearer <RENDER_API_TOKEN>' });
    if (req.method === 'GET' && route === '/api/auth/verify')
      return sendJson(res, 200, { authenticated: true });
    if (route.startsWith('/api/agentic/')) return handleAgenticApi(req,res,new URL(req.url,'http://localhost'));
    if (route === '/api/narration/preview' || route.startsWith('/api/narration/previews/')) return handleNarrationPreviewApi(req,res,new URL(req.url, 'http://localhost'));
    if (route === '/api/captures' || route === '/api/captures/file') return handleCaptureApi(req,res,new URL(req.url, 'http://localhost'));
    if (route === '/api/recordings/render' || route.startsWith('/api/recording-jobs/')) return handleRecordingApi(req,res,new URL(req.url, 'http://localhost'));
    if (req.method === 'GET' && route === '/api/templates') {
      return sendJson(res,200,{templates:Object.entries(TEMPLATES).map(([name,config])=>({
        name, type:config.type, default_document:config.defaultDocument??null,
        documents:listDocuments(COMPOSITION,config)
      }))});
    }
    if (req.method === 'POST' && route === '/api/render') {
      if (active && queue.length >= 2) return sendJson(res, 429, { error:'Renderer busy: max 2 queued jobs' });
      // Optional JSON payload; never accept an arbitrary filesystem path or HTML URL.
      let body = '';
      try {
        for await (const chunk of req) {
          body += chunk.toString('utf8');
          if (body.length > 4096) return sendJson(res, 413, { error:'Request too large' });
        }
      } catch (err) { return sendJson(res, 400, { error:'Invalid request body' }); }
      let config = {};
      try { config = body.trim() ? JSON.parse(body) : {}; }
      catch { return sendJson(res, 400, { error:'Invalid JSON' }); }
      if (!config || typeof config !== 'object' || Array.isArray(config))
        return sendJson(res, 400, {error:'JSON body must be an object'});
      const template = config.template ?? 'code-review';
      if (!Object.hasOwn(TEMPLATES, template))
        return sendJson(res, 400, { error:'Unknown template', allowed_templates:Object.keys(TEMPLATES) });
      const documentId = config.document ?? null;
      let document;
      try {
        document = resolveDocument(COMPOSITION,TEMPLATES[template],documentId);
        getCompositionHtml(template,document); // Validate before enqueueing.
      } catch(err) {
        return sendJson(res,400,{error:'Invalid template source or document',detail:err.message,
          allowed_documents:listDocuments(COMPOSITION,TEMPLATES[template])});
      }
      let narration;
      try { narration=validateNarrationRequest(config.narration); }
      catch(err) { return sendJson(res,400,{error:err.message}); }
      if (narration.enabled && (process.env.SPEECH_MODE !== 'azure' || !process.env.SPEECH_KEY || !process.env.SPEECH_ENDPOINT))
        return sendJson(res,503,{error:'Azure Speech is not configured (SPEECH_MODE, SPEECH_KEY, SPEECH_ENDPOINT)'});
      const id = crypto.randomUUID();
      await fsp.mkdir(path.join(DATA,id), { recursive:true });
      const job = { id, template, documentId, narration, status:'queued', created_at:new Date().toISOString(), finished_at:null, error:null, storage:null };
      jobs.set(id, job); queue.push(job); renderNext();
      return sendJson(res, 202, info(job));
    }
    const m = /^\/api\/jobs\/([0-9a-f-]{36})(?:\/(download|log))?$/.exec(route);
    if (m && req.method === 'GET') {
      const job = jobs.get(m[1]);
      if (!job) return sendJson(res, 404, { error:'Job missing (jobs are in-memory for this PoC)' });
      if (!m[2]) return sendJson(res, 200, info(job));
      if (m[2] === 'log') return staticFile(res, path.join(DATA,job.id,'render.log'), 'text/plain; charset=utf-8');
      if (job.status !== 'completed') return sendJson(res, 409, { error:'Video not ready' });
      const outfile=path.join(DATA,job.id,'review.mp4');
      res.setHeader('content-disposition', `attachment; filename="code-review-${job.id}.mp4"`);
      return staticFile(res,outfile,'video/mp4');
    }
    return sendJson(res, 404, { error:'Unknown endpoint' });
  }
  sendJson(res, 404, {error:'Not found'});
}).listen(PORT, '0.0.0.0', () => console.log(`HyperFrames PoC listening on ${PORT}`));
