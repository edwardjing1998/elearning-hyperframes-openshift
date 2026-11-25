/** REST endpoint for narrating an existing private Capture Studio recording. */
import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { validatedCaptureBlobName } from '../capture/capture-storage.mjs';
import { validateStorageConfig, uploadRenderedVideo } from '../storage/azure-blob-storage.mjs';
import { validateNarrationSteps } from './action-plan.mjs';
import { createNarratedRecording } from './recording-renderer.mjs';

const jobs=new Map();const pending=[];let busy=false;
const ID=/^[0-9a-f-]{36}$/;
function json(res,status,body){res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'});res.end(JSON.stringify(body));}
function jobInfo(j){return {job_id:j.id,status:j.status,created_at:j.created_at,finished_at:j.finished_at,error:j.error,storage:j.storage,step_count:j.scenes.length,download_url:j.status==='completed'?`/api/recording-jobs/${j.id}/download`:null};}
async function parseBody(req){let body='';for await(const chunk of req){body+=chunk.toString('utf8');if(body.length>60_000){const e=new Error('Request too large');e.status=413;throw e;}}return JSON.parse(body);}
async function pump(){if(busy||!pending.length)return;busy=true;const j=pending.shift();j.status='running';const root=path.join(process.env.RENDER_DATA_DIR||'/data/jobs',j.id);
  try{
    await fs.mkdir(root,{recursive:true});
    const log=(msg)=>{fs.appendFile(path.join(root,'render.log'),msg+'\n').catch(()=>{});};
    const {output,plan}=await createNarratedRecording({blobName:j.blobName,scenes:j.scenes,jobDir:root,log});
    j.storage=await uploadRenderedVideo(output,{template:'recording-narrated',jobId:j.id});
    // Preserve the action plan together with output when Blob Storage is enabled.
    if(j.storage){
      const config=validateStorageConfig();
      const {BlobServiceClient}=await import('@azure/storage-blob');
      const client=BlobServiceClient.fromConnectionString(config.connectionString).getContainerClient(config.container);
      const manifest=JSON.stringify({source_blob:j.blobName,rendered_blob:j.storage.blob_name,plan},null,2);
      const name=j.storage.blob_name.replace(/final\.mp4$/,'action-plan.json');
      await client.getBlockBlobClient(name).uploadData(Buffer.from(manifest),{blobHTTPHeaders:{blobContentType:'application/json'}});
    }
    j.status='completed';
  }catch(e){j.status='failed';j.error=e.message;await fs.appendFile(path.join(root,'render.log'),`[error] ${e.message}\n`).catch(()=>{});}
  finally{j.finished_at=new Date().toISOString();await fs.writeFile(path.join(root,'status.json'),JSON.stringify(jobInfo(j),null,2)).catch(()=>{});busy=false;void pump();}
}
export async function handleRecordingApi(req,res,url){
  if(url.pathname==='/api/recordings/render'&&req.method==='POST'){
    try{
      if(busy&&pending.length>=2)return json(res,429,{error:'Recording renderer busy'});
      const body=await parseBody(req);
      const config=validateStorageConfig();
      if(!config)return json(res,503,{error:'VIDEO_STORAGE_MODE=azure is required'});
      if(process.env.SPEECH_MODE!=='azure'||!process.env.SPEECH_KEY||!process.env.SPEECH_ENDPOINT)return json(res,503,{error:'Azure Speech is not configured'});
      if(!body||typeof body!=='object'||typeof body.blob_name!=='string')return json(res,400,{error:'blob_name required'});
      const blobName=validatedCaptureBlobName(body.blob_name,config);
      if(!blobName.endsWith('.webm'))return json(res,400,{error:'Choose a WebM recording'});
      const scenes=validateNarrationSteps(body.scenes);
      const id=crypto.randomUUID();const j={id,blobName,scenes,status:'queued',created_at:new Date().toISOString(),finished_at:null,error:null,storage:null};
      jobs.set(id,j);pending.push(j);void pump();return json(res,202,jobInfo(j));
    }catch(e){return json(res,e.status||400,{error:e.message});}
  }
  const match=/^\/api\/recording-jobs\/([0-9a-f-]{36})(?:\/(log|download))?$/.exec(url.pathname);
  if(match&&req.method==='GET'){
    const j=jobs.get(match[1]);if(!j)return json(res,404,{error:'Job not found (jobs are currently held in memory)'});
    if(!match[2])return json(res,200,jobInfo(j));
    const directory=path.join(process.env.RENDER_DATA_DIR||'/data/jobs',j.id);
    if(match[2]==='download'&&j.status!=='completed')return json(res,409,{error:'Video not ready'});
    const filename=path.join(directory,match[2]==='download'?'final.mp4':'render.log');
    try{const stat=await fs.stat(filename);res.writeHead(200,{
      'content-type':match[2]==='download'?'video/mp4':'text/plain; charset=utf-8',
      'content-length':stat.size,'cache-control':'no-store',
      ...(match[2]==='download'?{'content-disposition':`attachment; filename="narrated-${j.id}.mp4"`}:{})
    });createReadStream(filename).pipe(res);return;}
    catch{return json(res,404,{error:'Job log or output not available'});}
  }
  return false;
}
