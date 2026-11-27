/** Screenshot-only mode; deliberately excludes AI-generated click actions. */
import fs from 'node:fs/promises';
import path from 'node:path';
import {assertPublicHost} from './plan.mjs';

export async function captureScenes(plan, dir, log=()=>{}) {
  const {chromium}=await import('playwright');
  const browser=await chromium.launch({headless:true,executablePath:process.env.AGENTIC_CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox','--disable-dev-shm-usage']});
  const stateFile=process.env.AGENTIC_BROWSER_STATE_FILE;
  try {
    const context=await browser.newContext({...(stateFile?{storageState:stateFile}:{}),viewport:{width:1280,height:720},acceptDownloads:false,serviceWorkers:'block'});
    const allowedOrigins=new Set(plan.scenes.map(s=>new URL(s.url).origin));
    // Reject redirects and other navigation outside allowlisted origins; reject internal address destinations.
    await context.route('**/*',async route=>{
      const request=route.request();let url;
      try{url=new URL(request.url());}catch{return route.abort();}
      if(url.protocol==='data:'||url.protocol==='blob:')return route.continue();
      if(!['https:'].includes(url.protocol))return route.abort();
      // Allow supporting CDNs for ordinary page rendering, but block local hosts/IPs and unsafe schemes.
      try{await assertPublicHost(url.hostname);}catch{return route.abort();}
      return route.continue();
    });
    const page=await context.newPage();
    await fs.mkdir(dir,{recursive:true});
    const captures=[];
    for(let i=0;i<plan.scenes.length;i++){
      const s=plan.scenes[i];
      await assertPublicHost(new URL(s.url).hostname);
      log(`Capturing scene ${i+1}/${plan.scenes.length}`);
      const response=await page.goto(s.url,{waitUntil:'domcontentloaded',timeout:45000});
      // Confirm the top-level page is an approved origin, not a login redirect or wrong site.
      const finalUrl=new URL(page.url());
      if(!allowedOrigins.has(finalUrl.origin)||finalUrl.origin!==new URL(s.url).origin)throw new Error(`Scene ${i+1}: unexpected destination; login may be required`);
      if(!response||!response.ok())throw new Error(`Scene ${i+1}: page failed to load (${response?.status()??'unknown'})`);
      await page.locator('body').waitFor({state:'visible',timeout:15000});
      await page.evaluate(()=>document.fonts?.ready).catch(()=>{});
      const name=`scene-${String(i+1).padStart(3,'0')}.png`;
      const filename=path.join(dir,name);
      await page.screenshot({path:filename,animations:'disabled',timeout:20000});
      captures.push({...s,file:filename,actual_url:page.url(),captured_at:new Date().toISOString()});
    }
    await context.close();return captures;
  } finally {await browser.close();}
}
