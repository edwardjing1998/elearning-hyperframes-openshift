/** Separate opt-in route, preserving existing capture and render endpoints. */
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import path from 'node:path';
import {validatePlan} from './plan.mjs';
import {captureScenes} from './capture.mjs';
import {renderCaptures} from './render.mjs';
import {uploadRenderedVideo} from '../storage/azure-blob-storage.mjs';
const jobs=new Map();let busy=false;
function json(res,status,value){res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'});res.end(JSON.stringify(value));}
function info(j){return {job_id:j.id,status:j.status,created_at:j.created_at,finished_at:j.finished_at,error:j.error,storage:j.storage,download_url:j.status==='completed'?`/api/agentic/jobs/${j.id}/download`:null};}
async function readBody(req){let b='';for await(const chunk of req){b+=chunk.toString();if(b.length>30000)throw new Error('Request too large');}return JSON.parse(b);}
async function run(j){busy=true;j.status='running';const dir=path.join(process.env.RENDER_DATA_DIR||'/data/jobs','agentic-'+j.id);j.dir=dir;
  try{await fs.mkdir(dir,{recursive:true});const log=m=>fs.appendFile(path.join(dir,'agentic.log'),m+'\n').catch(()=>{});
    await fs.writeFile(path.join(dir,'plan.json'),JSON.stringify(j.plan,null,2));
    const captures=await captureScenes(j.plan,dir,log);
    const output=await renderCaptures(captures,dir,log);
    j.storage=await uploadRenderedVideo(output,{template:'agentic-capture',jobId:j.id});j.status='completed';
  }catch(e){j.status='failed';j.error=e.message;await fs.appendFile(path.join(dir,'agentic.log'),`ERROR: ${e.message}\n`).catch(()=>{});}
  finally{j.finished_at=new Date().toISOString();await fs.writeFile(path.join(dir,'status.json'),JSON.stringify(info(j),null,2)).catch(()=>{});busy=false;}
}
export async function handleAgenticApi(req,res,url){
  if(req.method==='POST'&&url.pathname==='/api/agentic/jobs'){
    if(process.env.AGENTIC_VIDEO_ENABLED!=='true')return json(res,503,{error:'Agentic capture disabled; set AGENTIC_VIDEO_ENABLED=true'});
    if(busy)return json(res,429,{error:'Another agentic job is running'});
    if(process.env.SPEECH_MODE!=='azure'||!process.env.SPEECH_KEY||!process.env.SPEECH_ENDPOINT)return json(res,503,{error:'Azure Speech not configured'});
    try{const plan=validatePlan(await readBody(req));const id=crypto.randomUUID();const j={id,plan,status:'queued',created_at:new Date().toISOString(),finished_at:null,error:null,storage:null};jobs.set(id,j);void run(j);return json(res,202,info(j));}
    catch(e){return json(res,400,{error:e.message});}
  }
  const m=/^\/api\/agentic\/jobs\/([0-9a-f-]{36})(?:\/(download|log|evidence))?$/.exec(url.pathname);
  if(!m||req.method!=='GET')return json(res,404,{error:'Unknown agentic endpoint'});
  const j=jobs.get(m[1]);if(!j)return json(res,404,{error:'Job not found (jobs are in-memory)'});
  if(!m[2])return json(res,200,info(j));
  if(m[2]==='download'&&j.status!=='completed')return json(res,409,{error:'Video not ready'});
  const kind=m[2],file=path.join(j.dir||'',kind==='download'?'final.mp4':kind==='log'?'agentic.log':'evidence.json');
  try{const stat=await fs.stat(file);res.writeHead(200,{'content-type':kind==='download'?'video/mp4':kind==='evidence'?'application/json':'text/plain; charset=utf-8','content-length':stat.size,'cache-control':'no-store',...(kind==='download'?{'content-disposition':`attachment; filename="agentic-${j.id}.mp4"`}:{})});createReadStream(file).pipe(res);}
  catch{json(res,404,{error:'Requested output unavailable'});}
}
