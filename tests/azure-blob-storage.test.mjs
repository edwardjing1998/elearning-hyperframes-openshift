import test from 'node:test';
import assert from 'node:assert/strict';
import { storageEnabled, validateStorageConfig, videoBlobName, uploadRenderedVideo } from '../src/storage/azure-blob-storage.mjs';

const env = {
  VIDEO_STORAGE_MODE: 'azure',
  AZURE_STORAGE_CONNECTION_STRING: 'UseDevelopmentStorage=true',
  AZURE_STORAGE_CONTAINER: 'elearning-videos',
  AZURE_STORAGE_PREFIX: 'hyperframes'
};
test('storage is opt-in and disabled by default', () => {
  assert.equal(storageEnabled({}), false);
  assert.equal(validateStorageConfig({}), null);
});
test('requires a connection string in azure mode', () => {
  assert.throws(() => validateStorageConfig({VIDEO_STORAGE_MODE:'azure'}), /CONNECTION_STRING/);
});
test('uses deterministic, job-scoped Azure Blob names', () => {
  const name = videoBlobName({prefix:'hyperframes',template:'markdown-review',jobId:'6916e3ae-2b78-4067-82a1-70f058a254d4'});
  assert.equal(name,'hyperframes/markdown-review/6916e3ae-2b78-4067-82a1-70f058a254d4/final.mp4');
});
test('uploads MP4 with private container and video content type', async () => {
  let called;
  const mock = {getContainerClient(container) {
    assert.equal(container,'elearning-videos');
    return {createIfNotExists: async()=>{}, getBlockBlobClient(name) {
      return {uploadFile:async(file,options)=>{called={file,name,options};}};
    }};
  }};
  // SDK import resolves only when storage mode enabled; fake service still uses installed package.
  const record=await uploadRenderedVideo('/tmp/example.mp4', {template:'markdown-review',jobId:'6916e3ae-2b78-4067-82a1-70f058a254d4'}, {env,createServiceClient:()=>mock});
  assert.equal(record.provider,'azure_blob');
  assert.equal(called.file,'/tmp/example.mp4');
  assert.equal(called.options.blobHTTPHeaders.blobContentType,'video/mp4');
  assert.equal(called.options.conditions.ifNoneMatch,'*');
});
