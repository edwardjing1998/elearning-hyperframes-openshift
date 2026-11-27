const $ = id => document.getElementById(id);
const live = $('live');
// Sites are configured in public/capture-studio/sites.json. Users may also open a custom HTTPS site.
const sitesById = new Map();
function checkedSiteUrl(raw) {
  const value = String(raw || '').trim();
  if (!value || value.length > 2048) throw new Error('Enter an HTTPS website URL');
  let url;
  try { url = new URL(value); } catch { throw new Error('Enter a valid HTTPS URL'); }
  if (url.protocol !== 'https:' || !url.hostname || url.username || url.password) {
    throw new Error('Only HTTPS website URLs without embedded credentials are allowed');
  }
  return url.href;
}
function selectedSite() {
  const id = $('target-site').value;
  if (id === 'custom') return {name:'Custom website',url:checkedSiteUrl($('custom-site-url').value)};
  const site = sitesById.get(id);
  if (!site) throw new Error('Select a website first');
  return {...site,url:checkedSiteUrl(site.url)};
}
function updateSelectedSite() {
  const custom = $('target-site').value === 'custom';
  $('custom-site-group').hidden = !custom;
  if (custom) {
    $('target-description').textContent = 'Enter the HTTPS address of the web application you want to demonstrate.';
  } else {
    const site = sitesById.get($('target-site').value);
    $('target-description').textContent = site ? `${site.description || site.name} · ${site.url}` : 'Select a website.';
    if (site?.course_id) $('course').value = site.course_id;
  }
}
async function loadCaptureSites() {
  try {
    const response = await fetch('/capture-studio/sites.json', {cache:'no-store'});
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const config = await response.json();
    if (!Array.isArray(config.sites)) throw new Error('Site configuration must include sites array');
    const select = $('target-site');
    select.replaceChildren();
    for (const item of config.sites) {
      if (!item || !/^[a-z0-9-]+$/.test(item.id || '') || sitesById.has(item.id) || item.id==='custom') continue;
      try { checkedSiteUrl(item.url); } catch { continue; }
      sitesById.set(item.id, item);
      const opt=document.createElement('option');opt.value=item.id;opt.textContent=item.name || item.id;select.append(opt);
    }
    const custom=document.createElement('option');custom.value='custom';custom.textContent='Custom HTTPS website';select.append(custom);
    updateSelectedSite();
  } catch (e) {
    const select=$('target-site');select.replaceChildren();
    const custom=document.createElement('option');custom.value='custom';custom.textContent='Custom HTTPS website';select.append(custom);
    updateSelectedSite();
    status('Website configuration could not be loaded; custom HTTPS URL is still available: '+e.message);
  }
}
$('target-site').addEventListener('change',updateSelectedSite);
$('open-site').onclick=()=>{
  try {
    const site=selectedSite();
    // Must be called from the click handler to avoid popup blockers.
    window.open(site.url,'_blank','noopener,noreferrer');
    status(`Requested a new tab for ${site.name}. If it did not open, allow pop-ups. Return here and explicitly share the target tab/window.`);
  } catch(e) { status('Cannot open website: '+e.message); }
};
loadCaptureSites();
let stream = null;
let recorder = null;
let recorded = [];
let currentChunks = [];
let previewUrls = [];
let recording = false;
let recordedDuration=0;let lastMarkers=[];
const status = (message) => { $('status').textContent = message; };
const updateControls = () => {
  const active = !!stream && stream.getVideoTracks().some(track => track.readyState === 'live');
  $('share').disabled=active;
  $('snapshot').disabled=!active || recording;
  $('start').disabled=!active || recording;
  $('stop').disabled=!recording;
  $('mark').disabled=!recording;
  $('unshare').disabled=!active;
  $('placeholder').hidden=active;
};
function stopSharing() {
  if (recording) recorder.stop();
  stream?.getTracks().forEach(t=>t.stop());
  stream=null; live.srcObject=null; updateControls();
}
$('share').onclick=async () => {
  try {
    if (!navigator.mediaDevices?.getDisplayMedia) throw new Error('Screen sharing requires HTTPS and a supported browser');
    stream=await navigator.mediaDevices.getDisplayMedia({video:{frameRate:30},audio:false});
    for (const track of stream.getVideoTracks()) track.addEventListener('ended',stopSharing,{once:true});
    live.srcObject=stream;
    await live.play();
    status('Screen sharing enabled. Navigate in the shared tab/window to show your tutorial steps.');
    updateControls();
  } catch(e) { status('Unable to share: '+e.message); }
};
$('unshare').onclick=stopSharing;
function addAsset(blob,kind,recordMeta=null) {
  const url=URL.createObjectURL(blob);previewUrls.push(url);
  const item=document.createElement('div');item.className='asset';
  const media=document.createElement(kind==='screenshot'?'img':'video');media.src=url;
  if(kind==='recording') media.controls=true;
  item.append(media);
  const name=document.createElement('strong');name.textContent=kind==='screenshot'?'PNG snapshot':'WebM recording';item.append(name);
  const details=document.createElement('p');details.textContent=`${(blob.size/1024/1024).toFixed(2)} MiB · Review before uploading`;item.append(details);
  const save=document.createElement('button');save.textContent='Upload to Azure';
  save.onclick=async()=>{save.disabled=true;try{
    const result=await uploadAsset(blob,kind);status('Uploaded to '+result.container+'/'+result.blob_name);
    if(kind==='recording'){const d=await durationOfBlob(blob,recordMeta?.duration||1);selectRecording(result.blob_name,d,recordMeta?.markers||[]);}
    save.textContent='Uploaded';await refresh();
  }catch(err){save.disabled=false;status('Upload failed: '+err.message)}};
  const download=document.createElement('button');download.textContent='Download locally';
  download.onclick=()=>{const a=document.createElement('a');a.href=url;a.download=`capture-${Date.now()}.${kind==='screenshot'?'png':'webm'}`;a.click();};
  const discard=document.createElement('button');discard.textContent='Discard';
  discard.onclick=()=>{URL.revokeObjectURL(url);item.remove();};
  item.append(save,download,discard);
  if($('assets').querySelector('p')) $('assets').replaceChildren();
  $('assets').prepend(item);
}
$('snapshot').onclick=async()=>{
  try {
    if (!stream || live.readyState<2) throw new Error('No live video frame available');
    const canvas=document.createElement('canvas');canvas.width=live.videoWidth;canvas.height=live.videoHeight;
    canvas.getContext('2d').drawImage(live,0,0,canvas.width,canvas.height);
    const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));
    if(!blob)throw new Error('Screenshot encoding failed');
    addAsset(blob,'screenshot');status('PNG snapshot captured. Review it before upload.');
  } catch(err) { status('Snapshot failed: '+err.message); }
};
$('start').onclick=()=>{
  try {
    if (!stream)throw new Error('Share a tab first');
    const mime=['video/webm;codecs=vp9','video/webm;codecs=vp8','video/webm'].find(MediaRecorder.isTypeSupported);
    if(!mime)throw new Error('This browser does not support WebM recording; try Chrome or Edge');
    currentChunks=[];stepMarkers=[];recordingStartedAt=performance.now();
    recorder=new MediaRecorder(stream,{mimeType:mime});
    recorder.ondataavailable=e=>{if(e.data.size) currentChunks.push(e.data)};
    recorder.onerror=e=>status('Recording error: '+(e.error?.message||'unknown'));
    recorder.onstop=()=>{
      recordedDuration=Math.max(1,(performance.now()-recordingStartedAt)/1000);lastMarkers=stepMarkers.slice();
      recording=false;updateControls();
      const blob=new Blob(currentChunks,{type:'video/webm'});
      currentChunks=[];
      if(blob.size) addAsset(blob,'recording',{duration:recordedDuration,markers:lastMarkers});
      status(blob.size?'Recording captured. Review before upload.':'No video captured.');
    };
    recorder.start(1000);recording=true;updateControls();status('Recording. Type and click normally in the shared website tab/window.');
  } catch(e) { status('Recording failed: '+e.message); }
};
$('stop').onclick=()=>{if(recorder?.state==='recording')recorder.stop()};
function courseId(){
  const name=$('course').value.trim();
  if(!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(name))throw new Error('Invalid course ID');
  return name;
}
function auth(){const token=$('token').value;if(!token)throw new Error('Enter the Render API token');return 'Bearer '+token}
async function uploadAsset(blob,kind){
  const response=await fetch('/api/captures',{
    method:'POST',headers:{'Authorization':auth(),'Content-Type':kind==='screenshot'?'image/png':'video/webm',
      'X-Course-Id':courseId(),'X-Capture-Kind':kind},body:blob
  });
  const result=await response.json();if(!response.ok)throw new Error(result.error||`HTTP ${response.status}`);return result;
}
async function refresh(){
  const response=await fetch('/api/captures?course='+encodeURIComponent(courseId()),{headers:{Authorization:auth()}});
  const data=await response.json();if(!response.ok)throw new Error(data.error||`HTTP ${response.status}`);
  const list=$('saved');list.replaceChildren();
  if(!data.items.length){list.textContent='No saved captures for this course.';return}
  for(const item of data.items){
    const button=document.createElement('button');button.textContent='Download: '+item.blob_name.split('/').pop();
    button.title=item.blob_name;
    button.onclick=async()=>{
      try{
        const r=await fetch('/api/captures/file?name='+encodeURIComponent(item.blob_name),{headers:{Authorization:auth()}});
        if(!r.ok){const err=await r.json();throw Error(err.error||`HTTP ${r.status}`)}
        const file=await r.blob();const url=URL.createObjectURL(file);
        const a=document.createElement('a');a.href=url;a.download=item.blob_name.split('/').pop();a.click();
        setTimeout(()=>URL.revokeObjectURL(url),60000);
      }catch(e){status('Download failed: '+e.message)}
    };
    list.append(button);
    if(item.content_type==='video/webm'){const narrate=document.createElement('button');narrate.textContent='Narrate recording';narrate.onclick=async()=>{try{
      const r=await fetch('/api/captures/file?name='+encodeURIComponent(item.blob_name),{headers:{Authorization:auth()}});if(!r.ok)throw Error('Recording download failed');
      const blob=await r.blob();const duration=await durationOfBlob(blob,1);selectRecording(item.blob_name,duration);
      status('Recording selected. Enter action timestamps and narration.');
    }catch(e){status('Could not select recording: '+e.message)}};list.append(narrate);}
  }
}
$('refresh').onclick=()=>refresh().catch(e=>status('List failed: '+e.message));
window.addEventListener('pagehide',()=>{stream?.getTracks().forEach(t=>t.stop());previewUrls.forEach(URL.revokeObjectURL)});
updateControls();


// A recording's timeline is measured with performance.now() (not wall-clock time).
let stepMarkers=[];
let recordingStartedAt=0;
let chosenRecording=null;
let selectedBlobName=null;
let chosenDuration=0;
let narrationSteps=[];
let recordingJobTimer=null;
// Single-scene previews are browser-only: no MP4 is rendered or uploaded.
let previewRecordingUrl=null;
let previewRecordingName=null;
let activeScene=null;
const scrubVideo=$('scene-video');
const sceneAudio=$('scene-audio');
const EPS=0.04;

function stopScenePreview() {
  if (activeScene) {
    activeScene=null;
    scrubVideo.pause();
    sceneAudio.pause();
    sceneAudio.currentTime=0;
    $('scene-preview-status').textContent='Preview stopped. Scrub the video to choose another split point.';
  }
}
function resetSceneSource() {
  stopScenePreview();
  scrubVideo.pause();
  scrubVideo.removeAttribute('src');
  scrubVideo.load();
  if (previewRecordingUrl) URL.revokeObjectURL(previewRecordingUrl);
  previewRecordingUrl=null;
  previewRecordingName=null;
}
async function loadSceneVideo() {
  if (!selectedBlobName) throw new Error('Select an uploaded WebM recording first');
  if (previewRecordingName===selectedBlobName && previewRecordingUrl) return;
  resetSceneSource();
  $('scene-preview-status').textContent='Loading recording for scene preview...';
  const response=await fetch('/api/captures/file?name='+encodeURIComponent(selectedBlobName),
    {headers:{Authorization:auth()}});
  if (!response.ok) {
    let message=`HTTP ${response.status}`;
    try {message=(await response.json()).error||message;} catch {}
    throw new Error(message);
  }
  const blob=await response.blob();
  if (!blob.size) throw new Error('The recording is empty');
  previewRecordingUrl=URL.createObjectURL(blob);
  previewRecordingName=selectedBlobName;
  scrubVideo.src=previewRecordingUrl;
  scrubVideo.load();
  $('scene-preview-status').textContent='Recording ready. Scrub to a point, then click Split at playhead.';
}
function actualSpeechDuration(s) {
  return s._speechText===s.text.trim() && Number.isFinite(s._speechDuration)
    ? s._speechDuration : null;
}
function comparisonText(s) {
  const speech=actualSpeechDuration(s);
  const seconds=s.end_seconds-s.start_seconds;
  if (speech===null) return `Video: ${seconds.toFixed(2)}s · Preview Azure Speech to measure audio`;
  const hold=Math.max(0,speech+0.5-seconds);
  return `Video: ${seconds.toFixed(2)}s · Speech: ${speech.toFixed(2)}s · `+
    (hold>0?`Estimated final-frame hold: ${hold.toFixed(2)}s`:'No frame hold needed');
}
function splitStep(index,time) {
  const step=narrationSteps[index];
  if (!step || !Number.isFinite(time)) throw new Error('Select a valid playhead position');
  if (time-step.start_seconds<0.25 || step.end_seconds-time<0.25)
    throw new Error(`Place the playhead at least 0.25s inside Step ${index+1}`);
  const end=step.end_seconds;
  step.end_seconds=time;
  // Clear narration for the second half, so the author can write a focused new sentence.
  narrationSteps.splice(index+1,0,{start_seconds:time,end_seconds:end,text:''});
  stepEditor();
}
function scenePreviewTick() {
  if (!activeScene) return;
  if (scrubVideo.currentTime>=activeScene.end-EPS) {
    scrubVideo.pause();
    // Preserve the last meaningful frame while narration continues.
    if (scrubVideo.currentTime>activeScene.end) scrubVideo.currentTime=Math.max(activeScene.start,activeScene.end-EPS);
    activeScene.videoDone=true;
  }
  finishSceneIfReady();
}
function finishSceneIfReady() {
  if (!activeScene) return;
  if (activeScene.videoDone && (sceneAudio.ended || sceneAudio.paused && sceneAudio.currentTime>=sceneAudio.duration-EPS)) {
    activeScene=null;
    $('scene-preview-status').textContent='Scene preview finished.';
  }
}
scrubVideo.addEventListener('timeupdate',scenePreviewTick);
scrubVideo.addEventListener('ended',()=>{if(activeScene){activeScene.videoDone=true;finishSceneIfReady();}});
sceneAudio.addEventListener('ended',finishSceneIfReady);
$('load-scene-video').onclick=()=>loadSceneVideo().catch(e=>{
  $('scene-preview-status').textContent='Preview load failed: '+e.message;
});
$('stop-scene-preview').onclick=stopScenePreview;
window.addEventListener('pagehide',resetSceneSource);

$('mark').onclick=()=>{
  if(!recording)return;
  const seconds=Math.max(0,(performance.now()-recordingStartedAt)/1000);
  if(seconds<0.25)return;
  stepMarkers.push(seconds);
  status(`Marked step at ${seconds.toFixed(2)} seconds. Return to the shared tab to continue.`);
};
function stepEditor(){
  stopScenePreview();
  $('steps').replaceChildren();
  narrationSteps.forEach((s,i)=>{
    const card=document.createElement('div');card.className='step';
    const title=document.createElement('strong');title.textContent=`Step ${i+1}`;card.append(title);
    const row=document.createElement('div');row.className='step-row';
    for(const [key,label] of [['start_seconds','Start (s)'],['end_seconds','End (s)']]){
      const wrapper=document.createElement('label');wrapper.textContent=label;
      const inp=document.createElement('input');inp.type='number';inp.min=0;inp.step='0.01';inp.value=s[key].toFixed(2);
      inp.onchange=()=>{s[key]=Number(inp.value)};
      wrapper.append(inp);row.append(wrapper);
    }
    const remove=document.createElement('button');remove.textContent='Remove step';remove.onclick=()=>{narrationSteps.splice(i,1);stepEditor()};row.append(remove);
    const split=document.createElement('button');split.type='button';split.textContent='Split at playhead';
    split.onclick=()=>{try{splitStep(i,scrubVideo.currentTime)}catch(e){status('Split failed: '+e.message)}};
    row.append(split);card.append(row);
    const label=document.createElement('label');label.textContent='Narration (spoken during this step)';
    const text=document.createElement('textarea');text.placeholder='Explain this recorded action';text.maxLength=1200;text.value=s.text;
    text.oninput=()=>{s.text=text.value;player.hidden=true;player.pause();
      details.textContent='Narration changed. Preview again to update the audio.';
      comparison.textContent=comparisonText(s);
    };label.append(text);card.append(label);
    const comparison=document.createElement('p');comparison.className='scene-comparison';
    comparison.textContent=comparisonText(s);card.append(comparison);
    const panel=document.createElement('div');panel.className='narration-preview';
    const preview=document.createElement('button');preview.textContent='Preview Azure Speech';
    const details=document.createElement('small');details.textContent='No narration preview generated.';
    const player=document.createElement('audio');player.controls=true;player.hidden=true;
    let audioUrl=null;
    preview.onclick=async()=>{
      const current=s.text.trim();
      if(!current){details.textContent='Enter narration text first.';return;}
      preview.disabled=true;details.textContent='Generating Azure Speech...';
      try {
        const response=await fetch('/api/narration/preview',{
          method:'POST',headers:{Authorization:auth(),'Content-Type':'application/json'},body:JSON.stringify({text:current})
        });
        const result=await response.json();if(!response.ok)throw Error(result.error||`HTTP ${response.status}`);
        const wavResponse=await fetch(result.audio_url,{headers:{Authorization:auth()}});
        if(!wavResponse.ok)throw Error('Unable to retrieve preview WAV');
        const blob=await wavResponse.blob();
        if(audioUrl)URL.revokeObjectURL(audioUrl);
        audioUrl=URL.createObjectURL(blob);previewUrls.push(audioUrl);
        player.src=audioUrl;player.hidden=false;
        s._speechDuration=result.duration_seconds;
        s._speechText=current;
        s._audioUrl=audioUrl;
        comparison.textContent=comparisonText(s);
        details.textContent=`Duration: ${result.duration_seconds.toFixed(2)}s · ${result.cached?'Cached WAV':'New WAV'}`;
      }catch(e){details.textContent='Preview failed: '+e.message;}
      finally{preview.disabled=false;}
    };
    const playScene=document.createElement('button');playScene.textContent='Preview synchronized scene';
    playScene.onclick=async()=>{
      try {
        if (!s._audioUrl || actualSpeechDuration(s)===null)
          throw new Error('Preview Azure Speech first, after finishing your narration text');
        await loadSceneVideo();
        stopScenePreview();
        const start=s.start_seconds, end=s.end_seconds;
        if (!(end-start>=0.25)) throw new Error('Step must last at least 0.25s');
        if (end>chosenDuration+0.05) throw new Error('Step end exceeds recording duration');
        sceneAudio.src=s._audioUrl;
        sceneAudio.load();
        // Wait for the recording to seek before speech begins.
        if (Math.abs(scrubVideo.currentTime-start)>EPS) {
          await new Promise((resolve,reject)=>{
            const timeout=setTimeout(()=>{cleanup();reject(new Error('Video seek timed out'));},5000);
            const cleanup=()=>{clearTimeout(timeout);scrubVideo.removeEventListener('seeked',onSeek);scrubVideo.removeEventListener('error',onError);};
            const onSeek=()=>{cleanup();resolve();};
            const onError=()=>{cleanup();reject(new Error('Recording cannot be decoded'));};
            scrubVideo.addEventListener('seeked',onSeek,{once:true});
            scrubVideo.addEventListener('error',onError,{once:true});
            scrubVideo.currentTime=start;
          });
        }
        sceneAudio.currentTime=0;
        activeScene={start,end,videoDone:false};
        $('scene-preview-status').textContent=`Previewing Step ${i+1}: ${comparisonText(s)}`;
        // Both play() calls originate in this user action; either may reject
        // for unsupported audio or media decoding.
        await Promise.all([scrubVideo.play(),sceneAudio.play()]);
      } catch(e) {stopScenePreview();status('Scene preview failed: '+e.message)}
    };
    panel.append(preview,playScene,details,player);card.append(panel);$('steps').append(card);
  });
}
function selectRecording(blobName,duration,markers=[]){
  if (blobName!==previewRecordingName) resetSceneSource();
  selectedBlobName=blobName;chosenDuration=duration;
  const bounds=[0,...markers.filter(t=>t>=0.25&&t<duration-0.25).sort((a,b)=>a-b),duration];
  narrationSteps=[];
  for(let i=0;i<bounds.length-1;i++){
    if(bounds[i+1]-bounds[i]<0.25)continue;
    narrationSteps.push({start_seconds:bounds[i],end_seconds:bounds[i+1],text:''});
  }
  $('recording-source').textContent=`Selected: ${blobName} · ${duration.toFixed(2)} seconds`;
  $('recording-duration').disabled=false;$('recording-duration').value=duration.toFixed(2);
  $('add-step').disabled=false;$('render-narration').disabled=false;stepEditor();
}
async function durationOfBlob(blob,fallback){
  const url=URL.createObjectURL(blob);
  try{
    return await new Promise(resolve=>{
      const v=document.createElement('video');v.preload='metadata';v.src=url;
      const timer=setTimeout(()=>resolve(fallback),3000);
      v.onloadedmetadata=()=>{clearTimeout(timer);resolve(Number.isFinite(v.duration)&&v.duration>0?v.duration:fallback)};
      v.onerror=()=>{clearTimeout(timer);resolve(fallback)};
    });
  }finally{URL.revokeObjectURL(url)}
}
$('recording-duration').onchange=()=>{
  const d=Number($('recording-duration').value);if(!Number.isFinite(d)||d<1)return;
  chosenDuration=d;for(const step of narrationSteps)if(step.end_seconds>chosenDuration)step.end_seconds=chosenDuration;stepEditor();
};
$('add-step').onclick=()=>{
  if(!chosenDuration)return;
  const lastEnd=narrationSteps.length?Math.max(...narrationSteps.map(s=>s.end_seconds)):0;
  if (chosenDuration-lastEnd<0.25) {status('No unused time remains. Use Split at playhead instead.');return;}
  narrationSteps.push({start_seconds:lastEnd,end_seconds:chosenDuration,text:''});stepEditor();
};
$('render-narration').onclick=async()=>{
  try{
    if(!selectedBlobName)throw Error('Select an uploaded WebM recording first');
    const scenes=narrationSteps.map(s=>({...s})).sort((a,b)=>a.start_seconds-b.start_seconds);
    if(!scenes.length||scenes.some(s=>!s.text.trim()))throw Error('Provide narration for every step');
    $('render-narration').disabled=true;
    const response=await fetch('/api/recordings/render',{method:'POST',headers:{Authorization:auth(),'Content-Type':'application/json'},
      body:JSON.stringify({blob_name:selectedBlobName,scenes})});
    const data=await response.json();if(!response.ok)throw Error(data.error||`HTTP ${response.status}`);
    $('render-status').textContent=`Job ${data.job_id}: ${data.status}`;
    if(recordingJobTimer)clearInterval(recordingJobTimer);
    const poll=async()=>{
      const r=await fetch('/api/recording-jobs/'+data.job_id,{headers:{Authorization:auth()}});
      const j=await r.json();if(!r.ok)throw Error(j.error||`HTTP ${r.status}`);
      $('render-status').textContent=JSON.stringify(j,null,2);
      if(j.status==='completed'||j.status==='failed'){
        clearInterval(recordingJobTimer);recordingJobTimer=null;$('render-narration').disabled=false;
        if(j.status==='completed'){
          const button=document.createElement('button');button.textContent='Download narrated MP4';
          button.onclick=async()=>{const r=await fetch(j.download_url,{headers:{Authorization:auth()}});if(!r.ok)throw Error('MP4 download failed');const video=await r.blob();const url=URL.createObjectURL(video);const a=document.createElement('a');a.href=url;a.download='narrated-'+data.job_id+'.mp4';a.click();setTimeout(()=>URL.revokeObjectURL(url),60000)};
          $('render-status').after(button);
        }
      }
    };
    recordingJobTimer=setInterval(()=>poll().catch(e=>{clearInterval(recordingJobTimer);recordingJobTimer=null;$('render-narration').disabled=false;status(e.message)}),4000);
    await poll();
  }catch(e){$('render-narration').disabled=false;status('Narration render failed: '+e.message)}
};
