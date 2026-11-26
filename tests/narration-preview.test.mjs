import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { speechCacheKey, putCachedSpeech, getCachedSpeech, downloadCachedSpeech } from '../src/storage/speech-cache.mjs';
import { ensureSpeechPreview } from '../src/speech/narration-preview.mjs';

const env = {
  SPEECH_MODE: 'azure', SPEECH_VOICE: 'en-US-JennyNeural',
  SPEECH_ENDPOINT: 'https://eastus.api.cognitive.microsoft.com/',
  VIDEO_STORAGE_MODE: 'azure', AZURE_STORAGE_CONNECTION_STRING: 'UseDevelopmentStorage=true',
  AZURE_STORAGE_CONTAINER: 'education', AZURE_STORAGE_PREFIX: 'hyperframes'
};
function fakeAzure() {
  const blobs=new Map();
  const container={
    createIfNotExists:async()=>{},
    getBlockBlobClient(name){return {
      exists:async()=>blobs.has(name),
      getProperties:async()=>({metadata:{durationseconds:blobs.get(name).duration.toString()}}),
      uploadFile:async(file,opts)=>{blobs.set(name,{bytes:await fs.readFile(file),duration:Number(opts.metadata.durationseconds)});},
      downloadToFile:async(file)=>{await fs.writeFile(file,blobs.get(name).bytes);},
      download:async()=>({readableStreamBody:null})
    }}
  };
  return {blobs,createServiceClient:()=>({getContainerClient:()=>container})};
}

test('cache key is stable and changes with voice or text',()=>{
  assert.equal(speechCacheKey('hello',env),speechCacheKey('hello',env));
  assert.notEqual(speechCacheKey('hello',env),speechCacheKey('hello',{...env,SPEECH_VOICE:'en-US-GuyNeural'}));
  assert.notEqual(speechCacheKey('hello',env),speechCacheKey('another',env));
  assert.throws(()=>speechCacheKey(''),/Narration/);
});

test('Azure cache roundtrips WAV and duration',async()=>{
  const fake=fakeAzure();const dir=await fs.mkdtemp(path.join(os.tmpdir(),'hf-preview-test-'));
  try {
    const file=path.join(dir,'a.wav');await fs.writeFile(file,'fixture-wave');
    const key=speechCacheKey('hello',env);const options={env,createServiceClient:fake.createServiceClient};
    assert.equal(await getCachedSpeech(key,options),null);
    await putCachedSpeech(key,file,3.25,options);
    assert.equal((await getCachedSpeech(key,options)).durationSeconds,3.25);
    const downloaded=path.join(dir,'b.wav');await downloadCachedSpeech(key,downloaded,options);
    assert.equal(await fs.readFile(downloaded,'utf8'),'fixture-wave');
  } finally {await fs.rm(dir,{recursive:true,force:true});}
});

test('preview only synthesizes once and returns cached duration',async()=>{
  const fake=fakeAzure();let synthCount=0;
  const options={env,cache:{createServiceClient:fake.createServiceClient},
    synthesize:async(_text,file)=>{synthCount++;await fs.writeFile(file,'fixture-wave');},
    durationOf:async()=>4.75};
  const first=await ensureSpeechPreview('Speak about storage',options);
  const second=await ensureSpeechPreview('Speak about storage',options);
  assert.equal(first.cached,false);assert.equal(second.cached,true);
  assert.equal(second.duration_seconds,4.75);assert.equal(synthCount,1);
});
