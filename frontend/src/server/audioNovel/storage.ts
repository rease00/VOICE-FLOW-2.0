import {
  getR2SignedObjectUrl,
  headR2Object,
  isR2StorageConfigured,
  normalizeR2ObjectKey,
  readR2Object,
  writeR2Object,
} from '../../lib/r2.ts';

const memoryObjectStore = new Map<string, { body: Buffer; contentType: string }>();

export const headAudioNovelObject = async (objectKey: string): Promise<boolean> => {
  const safeKey = normalizeR2ObjectKey(objectKey);
  if (!safeKey) return false;
  if (!isR2StorageConfigured()) {
    return memoryObjectStore.has(safeKey);
  }
  return headR2Object(safeKey);
};

export const writeAudioNovelObject = async (
  objectKey: string,
  body: Buffer | string,
  contentType: string,
): Promise<void> => {
  const safeKey = normalizeR2ObjectKey(objectKey);
  const normalizedBody = typeof body === 'string' ? Buffer.from(body, 'utf8') : body;
  if (!safeKey) {
    throw new Error('objectKey is required.');
  }

  if (!isR2StorageConfigured()) {
    memoryObjectStore.set(safeKey, { body: normalizedBody, contentType });
    return;
  }

  await writeR2Object(safeKey, normalizedBody, contentType);
};

export const readAudioNovelObject = async (
  objectKey: string,
): Promise<{ body: Buffer; contentType: string } | null> => {
  const safeKey = normalizeR2ObjectKey(objectKey);
  if (!safeKey) return null;

  if (!isR2StorageConfigured()) {
    return memoryObjectStore.get(safeKey) || null;
  }

  return readR2Object(safeKey);
};

export const getAudioNovelSignedUrl = async (objectKey: string, expiresInSeconds: number = 10_800): Promise<string> => {
  return getR2SignedObjectUrl(objectKey, expiresInSeconds);
};
