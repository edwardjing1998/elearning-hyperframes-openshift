/** Deterministic validation for user-approved, read-only browser captures. */
import dns from 'node:dns/promises';
import { isIP, BlockList } from 'node:net';
export function configuredOrigins(env = process.env) {
  const allowed = (env.AGENTIC_ALLOWED_ORIGINS || '').split(',').map(x=>x.trim()).filter(Boolean);
  return allowed.map(x=>{const u=new URL(x);if(!validHttpsUrl(u)||u.pathname!=='/'||u.search||u.hash)throw new Error('Invalid allowed origin');return u.origin;});
}
export function validHostname(hostname) {
  const host=hostname.toLowerCase().replace(/\.$/,'');
  return host.includes('.') && host.length<=253 && !isIP(host) &&
    /^[a-z0-9.-]+$/.test(host) && host.split('.').every(label=>/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)) &&
    !/(^|\.)(localhost|local|internal|svc|cluster|invalid|test|onion|arpa|lan|home|corp)$/.test(host);
}
export function validHttpsUrl(u) {
  return u.protocol==='https:' && !u.username && !u.password && !u.port && validHostname(u.hostname);
}
export function validatePlan(input, env = process.env) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Plan must be an object');
  if (typeof input.title !== 'string' || !input.title.trim() || input.title.length > 120) throw new Error('Title must be 1..120 characters');
  if (typeof input.course_id !== 'string' || !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(input.course_id)) throw new Error('Invalid course_id');
  if (!Array.isArray(input.scenes) || input.scenes.length < 1 || input.scenes.length > 12) throw new Error('Supply 1..12 scenes');
  const allowedOrigins = configuredOrigins(env);
  const scenes = input.scenes.map((scene,i)=>{
    if (!scene || typeof scene!=='object' || Array.isArray(scene)) throw new Error(`Scene ${i+1} must be an object`);
    if (scene.type!=='screenshot') throw new Error(`Scene ${i+1}: only screenshot capture is enabled`);
    if (typeof scene.url!=='string'||scene.url.length>2000)throw new Error(`Scene ${i+1}: invalid URL`);
    let u;try{u=new URL(scene.url);}catch{throw new Error(`Scene ${i+1}: invalid URL`);}
    if (!validHttpsUrl(u)) throw new Error(`Scene ${i+1}: URL origin not allowlisted or not a public HTTPS hostname`);
    if (allowedOrigins.length && !allowedOrigins.includes(u.origin)) throw new Error(`Scene ${i+1}: URL origin not allowlisted`);
    if (typeof scene.narration!=='string'||!scene.narration.trim()||scene.narration.length>1200) throw new Error(`Scene ${i+1}: narration must be 1..1200 characters`);
    if (scene.duration_seconds !== undefined && (!Number.isFinite(scene.duration_seconds)||scene.duration_seconds<2||scene.duration_seconds>90))throw new Error(`Scene ${i+1}: duration must be 2..90 seconds`);
    return {type:'screenshot',url:u.href,narration:scene.narration.trim(),duration_seconds:scene.duration_seconds??8};
  });
  return {title:input.title.trim(),course_id:input.course_id,scenes};
}
// Conservative rejection of special-use IPv4 and IPv6 networks.
const blocked4 = new BlockList();
for (const [ip,bits] of [
  ['0.0.0.0',8],['10.0.0.0',8],['100.64.0.0',10],['127.0.0.0',8],
  ['169.254.0.0',16],['172.16.0.0',12],['192.0.0.0',24],['192.0.2.0',24],
  ['192.88.99.0',24],['192.168.0.0',16],['198.18.0.0',15],['198.51.100.0',24],
  ['203.0.113.0',24],['224.0.0.0',3],['168.63.129.16',32]
]) blocked4.addSubnet(ip,bits,'ipv4');
const global6 = new BlockList(); global6.addSubnet('2000::',3,'ipv6');
const blocked6 = new BlockList();
for (const [ip,bits] of [['2001::',23],['2001:db8::',32],['2002::',16],['3fff::',20]]) blocked6.addSubnet(ip,bits,'ipv6');
export function isPublicAddress(ip) {
  if (typeof ip !== 'string' || ip.includes('%')) return false;
  const family = isIP(ip);
  if(family===4) return !blocked4.check(ip,'ipv4');
  if(family===6) return global6.check(ip,'ipv6') && !blocked6.check(ip,'ipv6');
  return false;
}
export async function assertPublicHost(hostname, lookup = dns.lookup) {
  if (!validHostname(hostname)) throw new Error('Target is not a public DNS hostname');
  // Absolute DNS name avoids Kubernetes search-suffix expansion.
  const answers=await lookup(hostname.replace(/\.$/,'')+'.',{all:true,verbatim:true});
  if(!answers.length||answers.some(x=>!isPublicAddress(x.address))) throw new Error('Target resolves to a non-public address');
  return answers.map(x=>({address:x.address,family:isIP(x.address)}));
}
