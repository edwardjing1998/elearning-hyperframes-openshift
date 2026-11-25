const $ = id => document.getElementById(id);
const live = $('live');
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
    recorder.start(1000);recording=true;updateControls();status('Recording. Type and click normally in the shared Azure Portal tab.');
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
$('mark').onclick=()=>{
  if(!recording)return;
  const seconds=Math.max(0,(performance.now()-recordingStartedAt)/1000);
  if(seconds<0.25)return;
  stepMarkers.push(seconds);
  status(`Marked step at ${seconds.toFixed(2)} seconds. Return to the shared tab to continue.`);
};
function stepEditor(){
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
    const remove=document.createElement('button');remove.textContent='Remove step';remove.onclick=()=>{narrationSteps.splice(i,1);stepEditor()};row.append(remove);card.append(row);
    const label=document.createElement('label');label.textContent='Narration (spoken during this step)';
    const text=document.createElement('textarea');text.placeholder='Explain this recorded action';text.maxLength=1200;text.value=s.text;
    text.oninput=()=>{s.text=text.value};label.append(text);card.append(label);$('steps').append(card);
  });
}
function selectRecording(blobName,duration,markers=[]){
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
  narrationSteps.push({start_seconds:0,end_seconds:chosenDuration,text:''});stepEditor();
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
