/** Authenticated capture endpoints mounted within the existing /api router. */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { uploadCapture, listCaptures, openCaptureBlob, MAX_CAPTURE_BYTES, validateCourseId, captureType } from './capture-storage.mjs';

function json(res, status, value) {
  res.writeHead(status, {'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'});
  res.end(JSON.stringify(value));
}
async function saveLimitedStream(req, filename) {
  const handle = await fs.open(filename,'wx',0o600);
  let bytes=0;
  try {
    for await (const chunk of req) {
      bytes += chunk.length;
      if (bytes > MAX_CAPTURE_BYTES) {
        const err=new Error('Capture exceeds the 64 MiB upload limit');err.status=413;throw err;
      }
      await handle.writeFile(chunk);
    }
    if (bytes < 8) throw new Error('Capture is empty');
  } finally { await handle.close(); }
}
export async function handleCaptureApi(req,res,url) {
  if (url.pathname === '/api/captures' && req.method === 'POST') {
    let folder;
    try {
      const course = validateCourseId(req.headers['x-course-id']);
      const kind = req.headers['x-capture-kind'];
      captureType(kind,req.headers['content-type']);
      const length = Number(req.headers['content-length']);
      if (Number.isFinite(length) && length > MAX_CAPTURE_BYTES) return json(res,413,{error:'Capture exceeds 64 MiB'});
      folder = await fs.mkdtemp(path.join(os.tmpdir(),'hf-capture-'));
      const file=path.join(folder,'upload.bin');
      await saveLimitedStream(req,file);
      const result=await uploadCapture(file,{course,kind,contentType:req.headers['content-type']});
      return json(res,201,result);
    } catch(err) {
      const status=err.status || (/Invalid|Unsupported|empty|does not match|requires VIDEO_STORAGE_MODE/.test(err.message) ? 400 : 502);
      return json(res,status,{error:err.message});
    } finally {
      if(folder) await fs.rm(folder,{recursive:true,force:true}).catch(()=>{});
    }
  }
  if (url.pathname === '/api/captures' && req.method === 'GET') {
    try { return json(res,200,await listCaptures(url.searchParams.get('course'))); }
    catch(err) { return json(res,/Invalid|requires VIDEO_STORAGE_MODE/.test(err.message)?400:502,{error:err.message}); }
  }
  if (url.pathname === '/api/captures/file' && req.method === 'GET') {
    try {
      const result=await openCaptureBlob(url.searchParams.get('name'));
      res.writeHead(200,{
        'content-type':result.mime,'cache-control':'private, no-store','x-content-type-options':'nosniff',
        'content-disposition':`attachment; filename="capture.${result.mime==='image/png'?'png':'webm'}"`,
        ...(Number.isInteger(result.length)?{'content-length':result.length}:{})
      });
      result.stream.on('error',()=>res.destroy()).pipe(res);
      return;
    } catch(err) { return json(res,/Invalid|requires VIDEO_STORAGE_MODE/.test(err.message)?400:502,{error:err.message}); }
  }
  return false;
}
