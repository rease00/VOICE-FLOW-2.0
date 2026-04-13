import { GetObjectCommand, HeadObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';

import { R2_BUCKET_NAME, getR2SignedObjectUrl, isR2Configured, r2Client } from '../../lib/r2.ts';

const memoryObjectStore = new Map<string, { body: Buffer; contentType: string }>();

const streamToBuffer = async (body: AsyncIterable<Uint8Array>): Promise<Buffer> => {
  const chunks: Uint8Array[] = [];
  for await (const chunk of body) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
};

export const headAudioNovelObject = async (objectKey: string): Promise<boolean> => {
  const safeKey = String(objectKey || '').trim();
  if (!safeKey) return false;
  if (!isR2Configured) {
    return memoryObjectStore.has(safeKey);
  }

  try {
    await r2Client.send(new HeadObjectCommand({
      Bucket: R2_BUCKET_NAME,
      Key: safeKey,
    }));
    return true;
  } catch {
    return false;
  }
};

export const writeAudioNovelObject = async (
  objectKey: string,
  body: Buffer | string,
  contentType: string,
): Promise<void> => {
  const safeKey = String(objectKey || '').trim().replace(/^\/+/, '');
  const normalizedBody = typeof body === 'string' ? Buffer.from(body, 'utf8') : body;
  if (!safeKey) {
    throw new Error('objectKey is required.');
  }

  if (!isR2Configured) {
    memoryObjectStore.set(safeKey, { body: normalizedBody, contentType });
    return;
  }

  await r2Client.send(new PutObjectCommand({
    Bucket: R2_BUCKET_NAME,
    Key: safeKey,
    Body: normalizedBody,
    ContentType: contentType,
    CacheControl: 'public, max-age=31536000, immutable',
  }));
};

export const readAudioNovelObject = async (
  objectKey: string,
): Promise<{ body: Buffer; contentType: string } | null> => {
  const safeKey = String(objectKey || '').trim().replace(/^\/+/, '');
  if (!safeKey) return null;

  if (!isR2Configured) {
    return memoryObjectStore.get(safeKey) || null;
  }

  try {
    const response = await r2Client.send(new GetObjectCommand({
      Bucket: R2_BUCKET_NAME,
      Key: safeKey,
    }));
    if (!response.Body) return null;
    return {
      body: await streamToBuffer(response.Body as AsyncIterable<Uint8Array>),
      contentType: response.ContentType || 'application/octet-stream',
    };
  } catch {
    return null;
  }
};

export const getAudioNovelSignedUrl = async (objectKey: string, expiresInSeconds: number = 10_800): Promise<string> => {
  return getR2SignedObjectUrl(objectKey, expiresInSeconds);
};
