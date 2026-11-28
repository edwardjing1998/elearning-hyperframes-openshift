/** Screenshot-only mode; deliberately excludes AI-generated click actions. */
import fs from 'node:fs/promises';
import path from 'node:path';
import {assertPublicHost,configuredOrigins,validHttpsUrl} from './plan.mjs';
import {startPublicProxy} from './public-proxy.mjs';

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
      const response=await page.goto(s.url,{waitUntil:'domcontentloaded',timeout:45000});
      // Public mode permits public HTTPS redirects; restricted mode preserves same-origin capture.
      const finalUrl=new URL(page.url());
      if(!validHttpsUrl(finalUrl)||(restricted&&(!allowedOrigins.has(finalUrl.origin)||finalUrl.origin!==new URL(s.url).origin)))throw new Error(`Scene ${i+1}: unexpected destination; login may be required`);
      await assertPublicHost(finalUrl.hostname);
      if(!response||!response.ok())throw new Error(`Scene ${i+1}: page failed to load (${response?.status()??'unknown'})`);
      await page.locator('body').waitFor({state:'visible',timeout:15000});
      await page.evaluate(()=>document.fonts?.ready).catch(()=>{});
      const name=`scene-${String(i+1).padStart(3,'0')}.png`;
      const filename=path.join(dir,name);
      await page.screenshot({path:filename,animations:'disabled',timeout:20000});
      captures.push({...s,file:filename,actual_url:page.url(),captured_at:new Date().toISOString()});
    }
    await context.close();return captures;
  } finally {try {await browser?.close();} finally {await proxy.close();}}
}
