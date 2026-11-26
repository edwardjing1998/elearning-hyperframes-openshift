/** Generate/listen to a single Azure Speech clip without rendering an MP4. */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { synthesizeWav } from './azure-speech.mjs';
import { wavDuration } from '../services/audio-composition.mjs';
import { speechCacheKey, getCachedSpeech, putCachedSpeech, downloadCachedSpeech, openCachedSpeech, CACHE_KEY_PATTERN } from '../storage/speech-cache.mjs';

const inflight = new Map();

export async function ensureSpeechPreview(text, { env = process.env, synthesize = synthesizeWav, durationOf = wavDuration, cache = {} } = {}) {
  if (env.SPEECH_MODE !== 'azure') throw new Error('Azure Speech is not enabled');
  const key = speechCacheKey(text, env);
  const dependencies = { env, ...cache };
  const found = await getCachedSpeech(key, dependencies);
  if (found?.durationSeconds) return { cache_key: key, cached: true, duration_seconds: found.durationSeconds, audio_url: `/api/narration/previews/${key}/audio` };
  if (inflight.has(key)) {
    await inflight.get(key);
    const after = await getCachedSpeech(key, dependencies);
    if (after?.durationSeconds) return { cache_key:key, cached:true, duration_seconds:after.durationSeconds, audio_url:`/api/narration/previews/${key}/audio` };
  }
  const task = (async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'hyperframes-speech-'));
    try {
      const wav = path.join(directory, 'narration.wav');
      await synthesize(text.trim(), wav);
      const duration = await durationOf(wav);
      await putCachedSpeech(key, wav, duration, dependencies);
      return duration;
    } finally {
      await fs.rm(directory, { recursive: true, force: true });
    }
  })();
  inflight.set(key, task);
  try {
    const duration = await task;
    return { cache_key:key, cached:false, duration_seconds:duration, audio_url:`/api/narration/previews/${key}/audio` };
  } finally {
    if (inflight.get(key) === task) inflight.delete(key);
  }
}

function json(res, code, value) {
  res.writeHead(code, { 'content-type':'application/json; charset=utf-8', 'cache-control':'no-store' });
  res.end(JSON.stringify(value));
}

export async function handleNarrationPreviewApi(req, res, url) {
  if (url.pathname === '/api/narration/preview' && req.method === 'POST') {
    try {
      let body = '';
      for await (const chunk of req) {
        body += chunk.toString('utf8');
        if (body.length > 6000) return json(res,413,{error:'Request too large'});
      }
      const input = JSON.parse(body);
      if (!input || typeof input !== 'object' || Array.isArray(input)) return json(res,400,{error:'Invalid preview request'});
      const preview = await ensureSpeechPreview(input.text);
      return json(res,200,preview);
    } catch (error) { return json(res, /Narration must|Invalid preview|Unexpected token|JSON/.test(error.message) ? 400 : 503, {error:error.message}); }
  }
  const match = /^\/api\/narration\/previews\/([0-9a-f]{64})\/audio$/.exec(url.pathname);
  if (match && req.method === 'GET') {
    try {
      if (!CACHE_KEY_PATTERN.test(match[1])) return json(res,400,{error:'Invalid key'});
      const result = await openCachedSpeech(match[1]);
      res.writeHead(200, { 'content-type':'audio/wav', 'content-disposition':'inline; filename="narration.wav"', 'cache-control':'private, no-store', 'x-content-type-options':'nosniff' });
      await pipeline(result.readableStreamBody,res);
      return;
    } catch(error) {
      if (!res.headersSent) return json(res,error.statusCode === 404 ? 404 : 503,{error:error.message});
      res.destroy(error);
      return;
    }
  }
  return false;
}
