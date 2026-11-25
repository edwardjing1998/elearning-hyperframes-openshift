/** Private Azure Blob persistence for user-approved browser captures. */
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { validateStorageConfig } from '../storage/azure-blob-storage.mjs';

export const MAX_CAPTURE_BYTES = 64 * 1024 * 1024;
const TYPES = Object.freeze({
  screenshot: { mime: 'image/png', extension: '.png', folder: 'screenshots' },
  recording: { mime: 'video/webm', extension: '.webm', folder: 'recordings' }
});
const IDENTIFIER = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
export function validateCourseId(value) {
  if (typeof value !== 'string' || !IDENTIFIER.test(value)) throw new Error('Invalid course ID: use lowercase letters, digits, hyphens');
  return value;
}
export function captureType(kind, contentType) {
  const kindConfig = TYPES[kind];
  if (!kindConfig || contentType?.split(';')[0].trim().toLowerCase() !== kindConfig.mime) {
    throw new Error('Unsupported capture format: screenshot=image/png, recording=video/webm');
  }
  return kindConfig;
}
export function validateCaptureHeader(bytes, kind) {
  if (kind === 'screenshot') return bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
  if (kind === 'recording') return bytes.subarray(0,4).equals(Buffer.from([0x1a,0x45,0xdf,0xa3]));
  return false;
}
export function captureBlobName({ prefix, course, kind, id }) {
  const type = TYPES[kind];
  validateCourseId(course);
  if (!type || !/^[0-9a-f-]{36}$/.test(id)) throw new Error('Invalid capture metadata');
  return path.posix.join(prefix, 'courses', course, 'captures', type.folder, id + type.extension);
}
function azureConfig(env = process.env) {
  const config = validateStorageConfig(env);
  if (!config) throw new Error('Capture upload requires VIDEO_STORAGE_MODE=azure');
  return config;
}
async function getContainerClient(config, options) {
  const service = options.createServiceClient
    ? options.createServiceClient(config.connectionString)
    : (await import('@azure/storage-blob')).BlobServiceClient.fromConnectionString(config.connectionString);
  return service.getContainerClient(config.container);
}
export async function uploadCapture(localFile, { course, kind, contentType }, options = {}) {
  const type = captureType(kind, contentType);
  const config = azureConfig(options.env);
  const stat = await fs.stat(localFile);
  if (stat.size < 8 || stat.size > MAX_CAPTURE_BYTES) throw new Error('Invalid capture size');
  const handle = await fs.open(localFile, 'r');
  let header;
  try { const b = Buffer.alloc(8); await handle.read(b, 0, 8, 0); header = b; }
  finally { await handle.close(); }
  if (!validateCaptureHeader(header, kind)) throw new Error('File content does not match declared capture format');
  const blobName = captureBlobName({ prefix:config.prefix, course, kind, id:crypto.randomUUID() });
  const container = await getContainerClient(config, options);
  await container.createIfNotExists();
  await container.getBlockBlobClient(blobName).uploadFile(localFile, {
    blobHTTPHeaders: { blobContentType: type.mime },
    conditions: { ifNoneMatch: '*' }, concurrency: 2
  });
  return { provider:'azure_blob', container:config.container, blob_name:blobName, kind, course, bytes:stat.size, content_type:type.mime };
}
export function validatedCaptureBlobName(name, config) {
  if (typeof name !== 'string' || name.length > 500 || name.includes('..') || name.includes('\\')) throw new Error('Invalid blob name');
  const base = `${config.prefix}/courses/`;
  if (!name.startsWith(base)) throw new Error('Invalid blob prefix');
  const suffix = name.slice(base.length);
  if (!/^[a-z0-9-]+\/captures\/(screenshots\/[0-9a-f-]{36}\.png|recordings\/[0-9a-f-]{36}\.webm)$/.test(suffix)) {
    throw new Error('Invalid capture blob name');
  }
  return name;
}
export async function listCaptures(course, options = {}) {
  validateCourseId(course);
  const config = azureConfig(options.env);
  const container = await getContainerClient(config, options);
  const items = [];
  const prefix = `${config.prefix}/courses/${course}/captures/`;
  for await (const item of container.listBlobsFlat({ prefix })) {
    if (!validatedCaptureBlobName(item.name,config)) continue;
    items.push({ blob_name:item.name, bytes:item.properties.contentLength ?? null,
      content_type:item.properties.contentType ?? null, modified_at:item.properties.lastModified ?? null });
    if (items.length >= 100) break;
  }
  return { container: config.container, course, items };
}
export async function openCaptureBlob(name, options = {}) {
  const config = azureConfig(options.env);
  validatedCaptureBlobName(name,config);
  const container = await getContainerClient(config,options);
  const client = container.getBlobClient(name);
  const response = await client.download();
  const mime = name.endsWith('.png') ? 'image/png' : 'video/webm';
  return { stream:response.readableStreamBody, mime, length:response.contentLength };
}
