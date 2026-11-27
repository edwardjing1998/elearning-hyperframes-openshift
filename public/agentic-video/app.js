const $=id=>document.getElementById(id);
$('generate').addEventListener('click',async()=>{
  const button=$('generate');button.disabled=true;$('download').hidden=true;let url=null;
  try{
    const scenes=JSON.parse($('plan').value);if(!Array.isArray(scenes))throw new Error('Scenes must be a JSON array');
    const headers={Authorization:`Bearer ${$('token').value}`,'Content-Type':'application/json'};
    const r=await fetch('/api/agentic/jobs',{method:'POST',headers,body:JSON.stringify({title:$('title').value,course_id:$('course').value,scenes})});
    const job=await r.json();if(!r.ok)throw new Error(job.error||`HTTP ${r.status}`);
    $('status').textContent=`Job ${job.job_id}: ${job.status}`;
    let completed=false;
    for(let i=0;i<180;i++){
      await new Promise(resolve=>setTimeout(resolve,3000));
      const response=await fetch(`/api/agentic/jobs/${job.job_id}`,{headers});const info=await response.json();
      if(!response.ok)throw Error(info.error||`HTTP ${response.status}`);
      $('status').textContent=JSON.stringify(info,null,2);
      if(info.status==='failed')throw Error(info.error||'Job failed');
      if(info.status==='completed'){completed=true;break;}
    }
    if(!completed)throw Error('Polling timed out; check job status');
    const d=await fetch(`/api/agentic/jobs/${job.job_id}/download`,{headers});if(!d.ok)throw Error('Could not download MP4');
    url=URL.createObjectURL(await d.blob());const a=$('download');a.href=url;a.download=`agentic-${job.job_id}.mp4`;a.hidden=false;a.textContent='Download narrated MP4';
  }catch(e){$('status').textContent+=`\nERROR: ${e.message}`;}
  finally{button.disabled=false;}
});
