/** Private Azure Blob WAV cache, keyed by text and synthesis settings. */
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import { validateStorageConfig } from './azure-blob-storage.mjs';

const WAV_MIME = 'audio/wav';
export const CACHE_VERSION = 'v1';
export const CACHE_KEY_PATTERN = /^[a-f0-9]{64}$/;

export function speechCacheKey(text, env = process.env) {
  if (typeof text !== 'string' || !text.trim() || text.length > 1200) {
    throw new Error('Narration must be 1..1200 characters');
  }
  return crypto.createHash('sha256').update(JSON.stringify({
    version: CACHE_VERSION,
    text: text.trim(),
    voice: env.SPEECH_VOICE || 'en-US-JennyNeural',
    endpoint: env.SPEECH_ENDPOINT || '',
    output: 'Riff24Khz16BitMonoPcm'
  })).digest('hex');
}

function cacheName(config, key) {
  if (!CACHE_KEY_PATTERN.test(key)) throw new Error('Invalid speech cache key');
  return `${config.prefix}/speech-cache/${CACHE_VERSION}/${key}.wav`;
}

async function clientFor(env, createServiceClient) {
  const config = validateStorageConfig(env);
  if (!config) throw new Error('Speech preview requires VIDEO_STORAGE_MODE=azure');
  const service = createServiceClient
    ? createServiceClient(config.connectionString)
    : (await import('@azure/storage-blob')).BlobServiceClient.fromConnectionString(config.connectionString);
  return { config, container: service.getContainerClient(config.container) };
}

export async function getCachedSpeech(key, { env = process.env, createServiceClient } = {}) {
  const { config, container } = await clientFor(env, createServiceClient);
  const blob = container.getBlockBlobClient(cacheName(config, key));
  if (!await blob.exists()) return null;
  const properties = await blob.getProperties();
  const duration = Number(properties.metadata?.durationseconds);
  return { key, blobName: cacheName(config, key), durationSeconds: Number.isFinite(duration) && duration > 0 ? duration : null };
}

export async function putCachedSpeech(key, wavFile, durationSeconds, { env = process.env, createServiceClient } = {}) {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) throw new Error('Invalid WAV duration');
  const { config, container } = await clientFor(env, createServiceClient);
  const blob = container.getBlockBlobClient(cacheName(config, key));
  await container.createIfNotExists();
  try {
    await blob.uploadFile(wavFile, {
      blobHTTPHeaders: { blobContentType: WAV_MIME },
      metadata: { durationseconds: durationSeconds.toFixed(6) },
      conditions: { ifNoneMatch: '*' }
    });
  } catch (error) {
    if (error.statusCode !== 409 && error.statusCode !== 412) throw error;
    // Two requests can synthesize concurrently; treat another successful upload as a cache hit.
    if (!await blob.exists()) throw error;
  }
  return { key, blobName: cacheName(config, key), durationSeconds };
}

export async function downloadCachedSpeech(key, file, { env = process.env, createServiceClient } = {}) {
  const { config, container } = await clientFor(env, createServiceClient);
  const blob = container.getBlockBlobClient(cacheName(config, key));
  await blob.downloadToFile(file);
  return file;
}

export async function openCachedSpeech(key, { env = process.env, createServiceClient } = {}) {
  const { config, container } = await clientFor(env, createServiceClient);
  const blob = container.getBlockBlobClient(cacheName(config, key));
  return blob.download();
}
