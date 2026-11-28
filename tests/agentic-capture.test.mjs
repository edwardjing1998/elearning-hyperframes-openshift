import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {isBlankRgb,isBlankScreenshot,captureReadyScreenshot,destinationMessage} from '../src/agentic/capture.mjs';

const scene={type:'screenshot',url:'https://example.com/',narration:'Demo',duration_seconds:60};
const filename='scene-001.png';
function stub({url=scene.url,afterFirstScreenshot,selectorFails=false}={}){
  let current=url;let shots=0;const waits=[];
  const page={
    url:()=>current,
    locator(selector){const locator={first:()=>locator,waitFor:async options=>{waits.push({selector,...options});if(selectorFails&&selector!=='body')throw new Error('Timeout');}};return locator;},
    waitForFunction:async()=>{},
    screenshot:async()=>{shots++;if(shots===1&&afterFirstScreenshot)current=afterFirstScreenshot;}
  };
  return {page,waits,shots:()=>shots};
}
function controls(blankResults){const waits=[],messages=[],destinations=[];let index=0;return {waits,messages,destinations,options:{delay:async ms=>waits.push(ms),log:m=>messages.push(m),checkDestination:async u=>destinations.push(u),checkBlank:async()=>blankResults[index++]??false}};}

test('normal screenshot uses the original fast path without fixed delay',async()=>{
  const s=stub(),c=controls([false]);
  assert.equal(await captureReadyScreenshot(s.page,scene,filename,c.options),scene.url);
  assert.equal(s.shots(),1);assert.deepEqual(c.waits,[]);
});
test('explicit initialization wait and visible selector are honored',async()=>{
  const s=stub(),c=controls([false]);
  await captureReadyScreenshot(s.page,{...scene,wait_seconds:20,wait_for_selector:'h1'},filename,c.options);
  assert.deepEqual(c.waits,[20000]);assert.ok(s.waits.some(w=>w.selector==='h1'&&w.state==='visible'));assert.equal(s.shots(),1);
});
test('blank screenshot retries until meaningful pixels appear',async()=>{
  const s=stub(),c=controls([true,true,false]);
  assert.equal(await captureReadyScreenshot(s.page,scene,filename,c.options),scene.url);
  assert.equal(s.shots(),3);assert.deepEqual(c.waits,[2000,4000]);assert.ok(c.messages.some(m=>m.includes('blank or near-uniform')));
});
test('persistent blank scene fails instead of reaching video rendering',async()=>{
  const s=stub(),c=controls([true,true,true,true,true]);
  await assert.rejects(()=>captureReadyScreenshot(s.page,scene,filename,c.options),/blank.*bounded capture retries/);
  assert.equal(s.shots(),5);assert.deepEqual(c.waits,[2000,4000,6000,8000]);
});
test('navigation during screenshot is revalidated and recaptured; auth hint omits query',async()=>{
  const login='https://login.microsoftonline.com/organizations/oauth2/v2.0/authorize?state=sensitive';
  const s=stub({afterFirstScreenshot:login}),c=controls([false]);
  const target={...scene,url:'https://portal.azure.com/'};
  assert.equal(await captureReadyScreenshot(s.page,target,filename,c.options),login);
  assert.equal(s.shots(),2);assert.ok(c.destinations.includes(login));
  assert.ok(c.messages.some(m=>m.includes('Authentication may be required at https://login.microsoftonline.com')));
  assert.ok(c.messages.every(m=>!m.includes('sensitive')));
  assert.match(destinationMessage(target.url,login),/Authentication may be required/);
});
test('existing destination validation remains authoritative after navigation',async()=>{
  const blocked='https://127.0.0.1/';const s=stub({afterFirstScreenshot:blocked}),c=controls([false]);
  c.options.checkDestination=async u=>{if(u===blocked)throw new Error('unexpected destination');};
  await assert.rejects(()=>captureReadyScreenshot(s.page,scene,filename,c.options),/unexpected destination/);
  assert.equal(s.shots(),1);
});
test('missing selector returns an explicit failure rather than an unrelated capture',async()=>{
  const s=stub({selectorFails:true}),c=controls([false]);
  await assert.rejects(()=>captureReadyScreenshot(s.page,{...scene,wait_for_selector:'#missing'},filename,c.options),/wait_for_selector did not become visible/);
  assert.equal(s.shots(),0);
});
test('blank checker failure does not silently accept the image',async()=>{
  const s=stub(),c=controls([]);c.options.checkBlank=async()=>{throw new Error('decoder failure');};
  await assert.rejects(()=>captureReadyScreenshot(s.page,scene,filename,c.options),/unable to validate captured screenshot/);
});
test('RGB check accepts contrast and rejects uniform white, black and nearly uniform images',()=>{
  for(const value of [0,255,92])assert.equal(isBlankRgb(Buffer.alloc(3000,value)),true);
  const nearly=Buffer.alloc(3000,255);nearly[0]=250;assert.equal(isBlankRgb(nearly),true);
  const content=Buffer.alloc(3000,255);content.fill(10,30,60);assert.equal(isBlankRgb(content),false);
  assert.throws(()=>isBlankRgb(Buffer.alloc(2)),/Invalid RGB/);
});
// Run the real decoder when the existing rendering dependency is installed.
const run=promisify(execFile);
let ffmpegAvailable=true;try{await run('ffmpeg',['-version']);}catch(e){if(e.code==='ENOENT')ffmpegAvailable=false;else throw e;}
test('actual PNG validation through FFmpeg', {skip:!ffmpegAvailable?'FFmpeg not installed on this test host':false},async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'agentic-png-test-'));
  try{
    const blank=path.join(dir,'blank.png'),content=path.join(dir,'content.png');
    const args=['-nostdin','-hide_banner','-loglevel','error','-f','lavfi','-i','color=white:s=1280x720','-frames:v','1','-threads','1'];
    await run('ffmpeg',[...args,blank]);
    await run('ffmpeg',[...args,'-vf','drawbox=x=40:y=80:w=180:h=100:color=black:t=fill',content]);
    assert.equal(await isBlankScreenshot(blank),true);assert.equal(await isBlankScreenshot(content),false);
  }finally{await fs.rm(dir,{recursive:true,force:true});}
});
