/** Deterministic validation for user-approved, read-only browser captures. */
import dns from 'node:dns/promises';
import { isIP } from 'node:net';
export function validatePlan(input, env = process.env) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Plan must be an object');
  if (typeof input.title !== 'string' || !input.title.trim() || input.title.length > 120) throw new Error('Title must be 1..120 characters');
  if (typeof input.course_id !== 'string' || !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(input.course_id)) throw new Error('Invalid course_id');
  if (!Array.isArray(input.scenes) || input.scenes.length < 1 || input.scenes.length > 12) throw new Error('Supply 1..12 scenes');
  const allowed = (env.AGENTIC_ALLOWED_ORIGINS || '').split(',').map(x=>x.trim()).filter(Boolean);
  if (!allowed.length) throw new Error('AGENTIC_ALLOWED_ORIGINS must specify approved HTTPS origins');
  const allowedOrigins = allowed.map(x=>{const u=new URL(x);if(u.protocol!=='https:'||u.pathname!=='/'||u.search||u.hash||u.username||u.password)throw new Error('Invalid allowed origin');return u.origin;});
  const scenes = input.scenes.map((scene,i)=>{
    if (!scene || typeof scene!=='object' || Array.isArray(scene)) throw new Error(`Scene ${i+1} must be an object`);
    if (scene.type!=='screenshot') throw new Error(`Scene ${i+1}: only screenshot capture is enabled`);
    if (typeof scene.url!=='string'||scene.url.length>2000)throw new Error(`Scene ${i+1}: invalid URL`);
    let u;try{u=new URL(scene.url);}catch{throw new Error(`Scene ${i+1}: invalid URL`);}
    if (u.protocol!=='https:'||u.username||u.password||u.port||isIP(u.hostname)||!allowedOrigins.includes(u.origin)) throw new Error(`Scene ${i+1}: URL origin not allowlisted`);
    if (typeof scene.narration!=='string'||!scene.narration.trim()||scene.narration.length>1200) throw new Error(`Scene ${i+1}: narration must be 1..1200 characters`);
    if (scene.duration_seconds !== undefined && (!Number.isFinite(scene.duration_seconds)||scene.duration_seconds<2||scene.duration_seconds>90))throw new Error(`Scene ${i+1}: duration must be 2..90 seconds`);
    return {type:'screenshot',url:u.href,narration:scene.narration.trim(),duration_seconds:scene.duration_seconds??8};
  });
  return {title:input.title.trim(),course_id:input.course_id,scenes};
}
function privateAddress(ip) {
  if(isIP(ip)===4){const p=ip.split('.').map(Number);return p[0]===0||p[0]===10||p[0]===127||p[0]>=224||(p[0]===169&&p[1]===254)||(p[0]===172&&p[1]>=16&&p[1]<=31)||(p[0]===192&&p[1]===168)||(p[0]===100&&p[1]>=64&&p[1]<=127)||(p[0]===192&&p[1]===0)||(p[0]===198&&p[1]>=18&&p[1]<=19);}
  return !ip || ip==='::1'||ip==='::'||ip.toLowerCase().startsWith('fe80:')||ip.toLowerCase().startsWith('fc')||ip.toLowerCase().startsWith('fd')||ip.toLowerCase().startsWith('::ffff:');
}
export async function assertPublicHost(hostname, lookup = dns.lookup) {
  if (isIP(hostname)) throw new Error('Literal IP targets are not allowed');
  const answers=await lookup(hostname,{all:true,verbatim:true});
  if(!answers.length||answers.some(x=>privateAddress(x.address))) throw new Error('Target resolves to a non-public address');
}
