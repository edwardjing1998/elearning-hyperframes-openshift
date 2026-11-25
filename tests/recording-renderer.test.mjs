import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createReadStream } from 'node:fs';
import { runProcess, createNarratedRecording } from '../src/recordings/recording-renderer.mjs';

test('FFmpeg stretches recorded scene to speech and produces an MP4', async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'hf-narrated-test-'));
  try{
    const source=path.join(dir,'input.webm');
    await runProcess('ffmpeg',['-hide_banner','-loglevel','error','-f','lavfi','-i','color=c=blue:s=320x180:r=15:d=2.2','-c:v','libvpx','-y',source],{timeoutMs:30000});
    const {output,plan}=await createNarratedRecording({
      blobName:'fixture',jobDir:path.join(dir,'output'),scenes:[{start_seconds:0,end_seconds:2,text:'Long explanation'}],
      load:async()=>({mime:'video/webm',stream:createReadStream(source)}),
      speech:async(_text,file)=>runProcess('ffmpeg',['-hide_banner','-loglevel','error','-y','-f','lavfi','-i','anullsrc=r=24000:cl=mono','-t','3','-c:a','pcm_s16le',file],{timeoutMs:30000})
    });
    assert.ok((await fs.stat(output)).size>1000);
    assert.ok(plan.duration_seconds>=3.5);
  }finally{await fs.rm(dir,{recursive:true,force:true});}
});
