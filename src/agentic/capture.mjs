/** Screenshot-only mode; deliberately excludes AI-generated click actions. */
import fs from 'node:fs/promises';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {setTimeout as sleep} from 'node:timers/promises';
import {assertPublicHost,configuredOrigins,validHttpsUrl} from './plan.mjs';
import {startPublicProxy} from './public-proxy.mjs';

const execFileAsync=promisify(execFile);
const sampleWidth=320, sampleHeight=180;
const retryDelays=[0,2000,4000,6000,8000];

// A conservative near-uniform-image test, not an assertion that a UI is fully loaded.
// Use median RGB rather than the color of a single potentially non-background pixel.
export function isBlankRgb(rgb) {
  if(!Buffer.isBuffer(rgb)||!rgb.length||rgb.length%3!==0)throw new Error('Invalid RGB screenshot sample');
  const n=rgb.length/3;
  const hist=[new Uint32Array(256),new Uint32Array(256),new Uint32Array(256)];
  for(let i=0;i<rgb.length;i+=3)for(let c=0;c<3;c++)hist[c][rgb[i+c]]++;
  const median=hist.map(h=>{let count=0;for(let v=0;v<256;v++){count+=h[v];if(count>=n/2)return v;}return 0;});
  const minDifferent=Math.max(1,Math.ceil(n*0.001));
  let different=0;
  for(let i=0;i<rgb.length;i+=3){
    if(Math.max(Math.abs(rgb[i]-median[0]),Math.abs(rgb[i+1]-median[1]),Math.abs(rgb[i+2]-median[2]))>=12){
      if(++different>=minDifferent)return false;
    }
  }
  return true;
}

// FFmpeg is already installed in the renderer image. No new npm dependencies.
export async function isBlankScreenshot(filename, timeout=10000) {
  const {stdout}=await execFileAsync('ffmpeg',[
    '-nostdin','-hide_banner','-loglevel','error','-threads','1','-i',filename,
    '-filter_threads','1','-vf',`scale=${sampleWidth}:${sampleHeight}:flags=area`,
    '-frames:v','1','-threads','1','-f','rawvideo','-pix_fmt','rgb24','pipe:1'
  ],{encoding:'buffer',timeout,maxBuffer:1024*1024});
  if(stdout.length!==sampleWidth*sampleHeight*3)throw new Error('Screenshot could not be decoded');
  return isBlankRgb(stdout);
}

function safeOrigin(url) {
  try{const u=new URL(url);return u.protocol==='https:'?u.origin:'non-HTTPS destination';}
  catch{return 'unknown destination';}
}

export function destinationMessage(requested,actual) {
  const target=new URL(requested), final=new URL(actual);
  const authLike=/^(login|signin|sign-in|auth|accounts|sso|identity|idp)(\.|$)/i.test(final.hostname)||
    /(?:^|\/)(login|signin|sign-in|oauth2?|authorize|saml|sso)(?:\/|$)/i.test(final.pathname);
  if(authLike)return `Authentication may be required at ${safeOrigin(actual)}; a public browser does not inherit your login session.`;
  if(target.origin!==final.origin)return `Redirected to ${safeOrigin(actual)}.`;
  return null;
}

// Bound diagnostics and omit paths, query strings, fragments, credentials and page text.
function observePage(page,sceneNumber,log) {
  const seen=new Set();let documentResponse;
  const important=new Set(['document','script','stylesheet','font','xhr','fetch']);
  function note(message){if(seen.size>=12||seen.has(message))return;seen.add(message);log(`Scene ${sceneNumber}: ${message}`);}
  const failed=request=>{
    if(!important.has(request.resourceType()))return;
    const code=request.failure()?.errorText||'';
    const reason=/^net::ERR_[A-Z0-9_]+$/.test(code)?code:'request failed';
    note(`${request.resourceType()} ${safeOrigin(request.url())}: ${reason}`);
  };
  const response=r=>{
    const req=r.request();const status=r.status();
    try{if(req.isNavigationRequest()&&req.frame()===page.mainFrame())documentResponse={url:r.url(),status};}catch{}
    if(status>=400&&important.has(req.resourceType()))note(`${req.resourceType()} ${safeOrigin(r.url())}: HTTP ${status}`);
  };
  page.on('requestfailed',failed);page.on('response',response);
  return {checkResponse(url){if(documentResponse?.url===url&&documentResponse.status>=400)throw new Error(`Scene ${sceneNumber}: page failed to load (HTTP ${documentResponse.status})`);},
    close(){page.off('requestfailed',failed);page.off('response',response);}};
}

// Simple pages keep the original fast path. Only blank/unstable captures retry.
// Optional per-scene waiting is separate from the scene's playback duration.
export async function captureReadyScreenshot(page,scene,filename,{
  sceneNumber=1,log=()=>{},checkDestination=async()=>{},checkResponse=()=>{},
  checkBlank=isBlankScreenshot,delay=sleep
}={}) {
  const label=`Scene ${sceneNumber}`;
  if(scene.wait_seconds>0){log(`${label}: waiting ${scene.wait_seconds}s for page initialization`);await delay(scene.wait_seconds*1000);}
  const deadline=Date.now()+45000;
  const remaining=limit=>{const ms=deadline-Date.now();if(ms<=0)throw new Error(`${label}: screenshot readiness timed out`);return Math.min(ms,limit);};
  const reported=new Set();let lastReason='blank screenshot';
  async function checkUrl(url){
    await checkDestination(url);checkResponse(url);
    const message=destinationMessage(scene.url,url);
    if(message&&!reported.has(message)){reported.add(message);log(`${label}: ${message}`);}
  }
  for(let attempt=0;attempt<retryDelays.length;attempt++){
    const wait=retryDelays[attempt];
    if(wait){if(remaining(wait)<wait)break;await delay(wait);}
    await page.locator('body').waitFor({state:'visible',timeout:remaining(15000)});
    if(scene.wait_for_selector){
      try{await page.locator(scene.wait_for_selector).first().waitFor({state:'visible',timeout:remaining(15000)});}
      catch{throw new Error(`${label}: wait_for_selector did not become visible (or the selector is invalid)`);}
    }
    // Do not wait indefinitely for fonts on a dynamic application.
    await page.waitForFunction(()=>!document.fonts||document.fonts.status==='loaded',undefined,{timeout:remaining(3000)}).catch(()=>{});
    const before=page.url();await checkUrl(before);
    await page.screenshot({path:filename,animations:'disabled',timeout:remaining(20000)});
    const after=page.url();await checkUrl(after);
    if(before!==after){lastReason='page navigated during screenshot';log(`${label}: ${lastReason}; retrying if time permits`);continue;}
    let blank;
    const validationTimeout=remaining(10000);
    try{blank=await checkBlank(filename,validationTimeout);}
    catch{throw new Error(`${label}: unable to validate captured screenshot; verify FFmpeg is available`);}
    const current=page.url();
    if(current!==after){await checkUrl(current);lastReason='page navigated while validating screenshot';log(`${label}: ${lastReason}; retrying if time permits`);continue;}
    checkResponse(current);
    if(!blank){log(`${label}: screenshot validated (attempt ${attempt+1}, ${safeOrigin(current)})`);return current;}
    lastReason='blank or near-uniform screenshot';
    log(`${label}: ${lastReason} (attempt ${attempt+1}/${retryDelays.length})`);
  }
  throw new Error(`${label}: ${lastReason} after bounded capture retries. Check page loading, authentication or network resources; try wait_seconds or wait_for_selector.`);
}

export async function captureScenes(plan, dir, log=()=>{}) {
  const {chromium}=await import('playwright');
  const stateFile=process.env.AGENTIC_BROWSER_STATE_FILE;
  const restricted=configuredOrigins().length>0;
  if(stateFile && !restricted)throw new Error('Saved browser sessions require an explicit AGENTIC_ALLOWED_ORIGINS list');
  const proxy=await startPublicProxy();
  let browser;
  try {
    // Do not inherit service credentials into the browser process.
    const browserEnv=Object.fromEntries(Object.entries(process.env).filter(([key])=>['PATH','HOME','USER','LOGNAME','TMPDIR','TMP','TEMP','LANG','LC_ALL','TZ','XDG_CACHE_HOME','XDG_CONFIG_HOME','XDG_RUNTIME_DIR','SSL_CERT_FILE','SSL_CERT_DIR'].includes(key)));
    browser=await chromium.launch({headless:true,executablePath:process.env.AGENTIC_CHROMIUM_PATH||'/usr/bin/chromium',env:browserEnv,
      proxy:{server:proxy.url,bypass:'<-loopback>'},
      args:['--no-sandbox','--disable-dev-shm-usage','--disable-quic','--force-webrtc-ip-handling-policy=disable_non_proxied_udp','--dns-prefetch-disable','--disable-background-networking']});
    const context=await browser.newContext({...(stateFile?{storageState:stateFile}:{}),viewport:{width:1280,height:720},acceptDownloads:false,serviceWorkers:'block'});
    const allowedOrigins=new Set(plan.scenes.map(s=>new URL(s.url).origin));
    const page=await context.newPage();
    // Validate requests in the browser; the proxy checks actual network connections, including redirects.
    await context.route('**/*',async route=>{
      const request=route.request();let url;
      try{url=new URL(request.url());}catch{return route.abort();}
      if(url.protocol==='data:'||url.protocol==='blob:')return route.continue();
      if(!validHttpsUrl(url))return route.abort();
      if(restricted && request.isNavigationRequest()) {
        // Navigation requests can precede frame creation. Fail closed if unavailable.
        try {if(request.frame()===page.mainFrame() && !allowedOrigins.has(url.origin))return route.abort();}
        catch {return route.abort();}
      }
      return route.continue();
    });
    await fs.mkdir(dir,{recursive:true});
    const captures=[];
    for(let i=0;i<plan.scenes.length;i++){
      const s=plan.scenes[i];
      await assertPublicHost(new URL(s.url).hostname);
      log(`Capturing scene ${i+1}/${plan.scenes.length}`);
      const observer=observePage(page,i+1,log);
      try {
        const response=await page.goto(s.url,{waitUntil:'domcontentloaded',timeout:45000});
        // Preserve existing public HTTPS and restricted-session security checks.
        const checkedHosts=new Set();
        const checkDestination=async value=>{
          const finalUrl=new URL(value);
          if(!validHttpsUrl(finalUrl)||(restricted&&(!allowedOrigins.has(finalUrl.origin)||finalUrl.origin!==new URL(s.url).origin)))throw new Error(`Scene ${i+1}: unexpected destination; login may be required`);
          if(!checkedHosts.has(finalUrl.hostname)){await assertPublicHost(finalUrl.hostname);checkedHosts.add(finalUrl.hostname);}
        };
        await checkDestination(page.url());
        if(!response||!response.ok())throw new Error(`Scene ${i+1}: page failed to load (${response?.status()??'unknown'})`);
        log(`Scene ${i+1}: navigation HTTP ${response.status()} at ${safeOrigin(page.url())}`);
        const name=`scene-${String(i+1).padStart(3,'0')}.png`;
        const filename=path.join(dir,name);
        const actualUrl=await captureReadyScreenshot(page,s,filename,{sceneNumber:i+1,log,checkDestination,checkResponse:observer.checkResponse});
        captures.push({...s,file:filename,actual_url:actualUrl,captured_at:new Date().toISOString()});
      } finally {observer.close();}
    }
    await context.close();return captures;
  } finally {try {await browser?.close();} finally {await proxy.close();}}
}
