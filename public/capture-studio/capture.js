const $ = id => document.getElementById(id);
const live = $('live');
let stream = null;
let recorder = null;
let recorded = [];
let currentChunks = [];
let previewUrls = [];
let recording = false;
const status = (message) => { $('status').textContent = message; };
const updateControls = () => {
  const active = !!stream && stream.getVideoTracks().some(track => track.readyState === 'live');
  $('share').disabled=active;
  $('snapshot').disabled=!active || recording;
  $('start').disabled=!active || recording;
  $('stop').disabled=!recording;
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
function addAsset(blob,kind) {
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
    currentChunks=[];
    recorder=new MediaRecorder(stream,{mimeType:mime});
    recorder.ondataavailable=e=>{if(e.data.size) currentChunks.push(e.data)};
    recorder.onerror=e=>status('Recording error: '+(e.error?.message||'unknown'));
    recorder.onstop=()=>{
      recording=false;updateControls();
      const blob=new Blob(currentChunks,{type:'video/webm'});
      currentChunks=[];
      if(blob.size) addAsset(blob,'recording');
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
  }
}
$('refresh').onclick=()=>refresh().catch(e=>status('List failed: '+e.message));
window.addEventListener('pagehide',()=>{stream?.getTracks().forEach(t=>t.stop());previewUrls.forEach(URL.revokeObjectURL)});
updateControls();
