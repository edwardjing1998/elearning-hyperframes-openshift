import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,writeFile,rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { captureBlobName, validateCourseId, captureType, validateCaptureHeader, validatedCaptureBlobName, uploadCapture, listCaptures } from '../src/capture/capture-storage.mjs';
const env={ VIDEO_STORAGE_MODE:'azure', AZURE_STORAGE_CONNECTION_STRING:'mock', AZURE_STORAGE_CONTAINER:'education', AZURE_STORAGE_PREFIX:'hyperframes' };
const id='d61ff051-1111-4111-8111-144444444444';
test('course IDs and media types are tightly validated',()=>{
  assert.equal(validateCourseId('azure-storage'),'azure-storage');
  for(const x of ['../escape','ABC','', 'foo/bar'])assert.throws(()=>validateCourseId(x));
  assert.equal(captureType('screenshot','image/png').extension,'.png');
  assert.throws(()=>captureType('recording','image/png'));
});
test('upload paths use course scope and safe UUID',()=>{
  const name=captureBlobName({prefix:'hyperframes',course:'azure-storage',kind:'recording',id});
  assert.equal(name,`hyperframes/courses/azure-storage/captures/recordings/${id}.webm`);
  assert.equal(validatedCaptureBlobName(name,{prefix:'hyperframes'}),name);
  assert.throws(()=>validatedCaptureBlobName('hyperframes/other/secret',{prefix:'hyperframes'}));
});
test('header checks reject spoofed file types',()=>{
  assert.equal(validateCaptureHeader(Buffer.from([137,80,78,71,13,10,26,10]),'screenshot'),true);
  assert.equal(validateCaptureHeader(Buffer.from('notreallypng'),'screenshot'),false);
  assert.equal(validateCaptureHeader(Buffer.from([0x1a,0x45,0xdf,0xa3]),'recording'),true);
});
test('uploads PNG to private Azure blob using expected prefix',async()=>{
  const tmp=await mkdtemp(path.join(os.tmpdir(),'capture-test-'));
  const file=path.join(tmp,'capture.png');await writeFile(file,Buffer.from([137,80,78,71,13,10,26,10,1,2,3]));
  const calls=[];
  const makeService=()=>({getContainerClient:()=>({createIfNotExists:async()=>{},getBlockBlobClient:name=>({uploadFile:async(file,options)=>calls.push({name,options})})})});
  try{
    const result=await uploadCapture(file,{course:'azure-storage',kind:'screenshot',contentType:'image/png'},{env,createServiceClient:makeService});
    assert.equal(result.container,'education');assert.match(result.blob_name,/hyperframes\/courses\/azure-storage\/captures\/screenshots\/.*\.png/);
    assert.equal(calls[0].options.blobHTTPHeaders.blobContentType,'image/png');
  }finally{await rm(tmp,{recursive:true,force:true})}
});
test('lists captures scoped to course',async()=>{
  let capturedPrefix='';
  const fakeService=()=>({getContainerClient:()=>({async *listBlobsFlat({prefix}){capturedPrefix=prefix;yield {name:`${prefix}screenshots/${id}.png`,properties:{contentLength:12,contentType:'image/png'}};}})});
  const result=await listCaptures('azure-storage',{env,createServiceClient:fakeService});
  assert.equal(result.items.length,1);assert.equal(capturedPrefix,'hyperframes/courses/azure-storage/captures/');
});
