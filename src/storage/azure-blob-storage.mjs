/** Azure Blob video uploads. Storage is optional for local render jobs. */
import path from 'node:path';

export function storageEnabled(env = process.env) {
  return (env.VIDEO_STORAGE_MODE || 'disabled') === 'azure';
}

export function validateStorageConfig(env = process.env) {
  const mode = env.VIDEO_STORAGE_MODE || 'disabled';
  if (!['disabled', 'azure'].includes(mode)) {
    throw new Error('VIDEO_STORAGE_MODE must be disabled or azure');
  }
  if (mode !== 'azure') return null;
  const connectionString = env.AZURE_STORAGE_CONNECTION_STRING;
  const container = env.AZURE_STORAGE_CONTAINER || 'elearning-videos';
  const prefix = env.AZURE_STORAGE_PREFIX || 'hyperframes';
  if (!connectionString) throw new Error('AZURE_STORAGE_CONNECTION_STRING is required when VIDEO_STORAGE_MODE=azure');
  if (!/^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])?$/.test(container)) {
    throw new Error('Invalid AZURE_STORAGE_CONTAINER');
  }
  if (!/^[a-zA-Z0-9/_-]+$/.test(prefix) || prefix.includes('..') || prefix.startsWith('/') || prefix.endsWith('/')) {
    throw new Error('Invalid AZURE_STORAGE_PREFIX');
  }
  return { connectionString, container, prefix };
}

export function videoBlobName({ prefix, template, jobId }) {
  if (!/^[a-z0-9-]+$/.test(template) || !/^[0-9a-f-]{36}$/.test(jobId)) {
    throw new Error('Invalid template or job ID for Blob path');
  }
  return path.posix.join(prefix, template, jobId, 'final.mp4');
}

export async function uploadRenderedVideo(localFile, { template, jobId }, options = {}) {
  const config = validateStorageConfig(options.env || process.env);
  if (!config) return null;
  const service = options.createServiceClient
    ? options.createServiceClient(config.connectionString)
    : (await import('@azure/storage-blob')).BlobServiceClient.fromConnectionString(config.connectionString);
  const containerClient = service.getContainerClient(config.container);
  // Create a private container if missing. Public access is never enabled.
  await containerClient.createIfNotExists();
  const blobName = videoBlobName({ prefix: config.prefix, template, jobId });
  const blobClient = containerClient.getBlockBlobClient(blobName);
  await blobClient.uploadFile(localFile, {
    blobHTTPHeaders: { blobContentType: 'video/mp4' },
    concurrency: 2,
    conditions: { ifNoneMatch: '*' }
  });
  return { provider: 'azure_blob', container: config.container, blob_name: blobName };
}
