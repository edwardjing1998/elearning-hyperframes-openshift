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
const TEMPLATES = Object.freeze({
  'code-review': 'index.html',
  'kafka-sequence': 'kafka-sequence.html'
});
const PORT = Number(process.env.PORT || 8080);
const API_TOKEN = process.env.RENDER_API_TOKEN || '';
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
  return { job_id:id, template: job.template, status, created_at, finished_at, error, download_url: status === 'completed' ? `/api/jobs/${id}/download` : null };
}
function renderNext() {
  if (active || !queue.length) return;
  const job = queue.shift();
  active = true;
  job.status = 'running';
  const work = path.join(DATA, job.id, 'composition');
  const output = path.join(DATA, job.id, 'review.mp4');
  // Copy a trusted, allowlisted HTML composition into a per-job working directory.
  // The CLI renders index.html within its current working directory.
  try {
    fs.mkdirSync(path.join(work, 'assets'), { recursive: true });
    fs.copyFileSync(path.join(COMPOSITION, TEMPLATES[job.template]), path.join(work, 'index.html'));
    fs.copyFileSync(path.join(COMPOSITION, 'assets', 'gsap.min.js'), path.join(work, 'assets', 'gsap.min.js'));
  } catch (err) {
    job.status = 'failed'; job.error = `Could not stage composition: ${err.message}`;
    job.finished_at = new Date().toISOString();
    active = false; renderNext(); return;
  }
  const args = ['render', '--output', output, '--quality', 'draft'];
  const child = spawn(BIN, args, {
    cwd: work,
    env: { ...process.env, CI: 'true' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  const logFile = fs.createWriteStream(path.join(DATA, job.id, 'render.log'), { flags: 'a' });
  const append = data => logFile.write(data);
  child.stdout.on('data', append);
  child.stderr.on('data', append);
  child.on('error', err => { job.error = err.message; });
  child.on('close', async (code) => {
    logFile.end();
    job.status = code === 0 && fs.existsSync(output) ? 'completed' : 'failed';
    if (job.status === 'failed') job.error = job.error || `HyperFrames exited with code ${code}; see pod logs/render.log`;
    job.finished_at = new Date().toISOString();
    await fsp.writeFile(path.join(DATA, job.id, 'status.json'), JSON.stringify(info(job), null, 2)).catch(() => {});
    active = false;
    renderNext();
  });
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
  if (req.method === 'GET' && route === '/composition/index.html') return staticFile(res, path.join(COMPOSITION,'index.html'), 'text/html; charset=utf-8');
  if (req.method === 'GET' && route === '/composition/kafka-sequence.html') return staticFile(res, path.join(COMPOSITION,'kafka-sequence.html'), 'text/html; charset=utf-8');
  if (req.method === 'GET' && route === '/composition/assets/gsap.min.js') return staticFile(res, path.join(COMPOSITION,'assets','gsap.min.js'), 'text/javascript; charset=utf-8');
  if (route.startsWith('/api/')) {
    if (!safeAuth(req)) return sendJson(res, 401, { error:'Unauthorized: supply Authorization: Bearer <RENDER_API_TOKEN>' });
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
      const id = crypto.randomUUID();
      await fsp.mkdir(path.join(DATA,id), { recursive:true });
      const job = { id, template, status:'queued', created_at:new Date().toISOString(), finished_at:null, error:null };
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
