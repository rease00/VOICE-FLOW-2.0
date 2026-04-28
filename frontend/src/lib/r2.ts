import { GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl as signS3Request } from '@aws-sdk/s3-request-presigner';

type NativeR2Object = {
  body?: unknown;
  contentType?: string;
  httpMetadata?: {
    contentType?: string;
    cacheControl?: string;
  } | undefined;
};

type NativeR2Bucket = {
  head: (key: string) => Promise<unknown> | unknown;
  get: (key: string) => Promise<NativeR2Object | null> | NativeR2Object | null;
  put: (
    key: string,
    body: Buffer | ArrayBuffer | ArrayBufferView | string,
    options?: {
      httpMetadata?: {
        contentType?: string;
        cacheControl?: string;
      };
      customMetadata?: Record<string, string>;
    },
  ) => Promise<unknown> | unknown;
};

type RuntimeBindings = {
  r2Bucket?: NativeR2Bucket | null;
};

// Cloudflare R2 configuration
const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID;
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID;
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY;
const R2_BUCKET = process.env.R2_BUCKET_NAME || 'vf-novel-storage';
const R2_PUBLIC_BASE_URL = process.env.R2_PUBLIC_BASE_URL || process.env.NEXT_PUBLIC_R2_AUDIO_URL || `https://pub-${R2_BUCKET}.r2.dev`;

const isDev = process.env.NODE_ENV === 'development';
export const isR2Configured = Boolean(R2_ACCOUNT_ID && R2_ACCESS_KEY_ID && R2_SECRET_ACCESS_KEY);

let hasLoggedMissingR2Configuration = false;

const getRuntimeBindings = (): RuntimeBindings | null => {
  const bindings = (globalThis as Record<string, unknown>).__vfRuntimeBindings;
  if (!bindings || typeof bindings !== 'object') {
    return null;
  }

  return bindings as RuntimeBindings;
};

const resolveNativeR2Bucket = (): NativeR2Bucket | null => {
  const bucket = getRuntimeBindings()?.r2Bucket;
  if (!bucket || typeof bucket !== 'object') {
    return null;
  }

  if (
    typeof bucket.head !== 'function'
    || typeof bucket.get !== 'function'
    || typeof bucket.put !== 'function'
  ) {
    return null;
  }

  return bucket;
};

export const isR2StorageConfigured = (): boolean => Boolean(isR2Configured || resolveNativeR2Bucket());

export const warnIfR2NotConfigured = (feature: string): boolean => {
  if (isR2Configured) {
    return false;
  }

  if (!hasLoggedMissingR2Configuration) {
    const normalizedFeature = String(feature || 'This feature').trim() || 'This feature';
    const log = isDev ? console.warn : console.error;

    log(
      `${normalizedFeature} requires Cloudflare R2, but R2 is not configured. ` +
      'Check R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, and R2_SECRET_ACCESS_KEY.'
    );

    hasLoggedMissingR2Configuration = true;
  }

  return true;
};

export const R2_BUCKET_NAME = R2_BUCKET;
export const R2_PUBLIC_URL_BASE = R2_PUBLIC_BASE_URL.replace(/\/+$/, '');

export const r2Client = new S3Client({
  region: 'auto',
  endpoint: `https://${R2_ACCOUNT_ID || 'mock-id'}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: R2_ACCESS_KEY_ID || 'mock-key',
    secretAccessKey: R2_SECRET_ACCESS_KEY || 'mock-secret',
  },
});

export const normalizeR2ObjectKey = (objectKey: string): string => (
  String(objectKey || '').trim().replace(/^\/+/, '')
);

const readBodyToBuffer = async (body: unknown): Promise<Buffer | null> => {
  if (!body) {
    return null;
  }

  if (Buffer.isBuffer(body)) {
    return body;
  }

  if (typeof body === 'string') {
    return Buffer.from(body, 'utf8');
  }

  if (body instanceof Uint8Array) {
    return Buffer.from(body);
  }

  if (body instanceof ArrayBuffer) {
    return Buffer.from(new Uint8Array(body));
  }

  if (ArrayBuffer.isView(body)) {
    return Buffer.from(body.buffer, body.byteOffset, body.byteLength);
  }

  if (typeof (body as { arrayBuffer?: () => Promise<ArrayBuffer> }).arrayBuffer === 'function') {
    const buffer = await (body as { arrayBuffer: () => Promise<ArrayBuffer> }).arrayBuffer();
    return Buffer.from(new Uint8Array(buffer));
  }

  if (typeof (body as { getReader?: () => ReadableStreamDefaultReader<Uint8Array> }).getReader === 'function') {
    const reader = (body as ReadableStream<Uint8Array>).getReader();
    const chunks: Uint8Array[] = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        chunks.push(value);
      }
    }
    return Buffer.concat(chunks);
  }

  if (typeof (body as AsyncIterable<Uint8Array>)[Symbol.asyncIterator] === 'function') {
    const chunks: Uint8Array[] = [];
    for await (const chunk of body as AsyncIterable<Uint8Array>) {
      if (chunk) {
        chunks.push(chunk);
      }
    }
    return Buffer.concat(chunks);
  }

  return null;
};

export const getR2PublicObjectUrl = (objectKey: string): string => {
  const safeKey = normalizeR2ObjectKey(objectKey);
  return `${R2_PUBLIC_URL_BASE}/${safeKey}`;
};

export const headR2Object = async (objectKey: string): Promise<boolean> => {
  const safeKey = normalizeR2ObjectKey(objectKey);
  if (!safeKey) return false;

  const nativeBucket = resolveNativeR2Bucket();
  if (nativeBucket) {
    try {
      return Boolean(await nativeBucket.head(safeKey));
    } catch {
      return false;
    }
  }

  if (!isR2Configured) return false;

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

export const writeR2Object = async (
  objectKey: string,
  body: Buffer | string,
  contentType: string,
  cacheControl: string = 'public, max-age=31536000, immutable',
): Promise<void> => {
  const safeKey = normalizeR2ObjectKey(objectKey);
  const normalizedBody = typeof body === 'string' ? Buffer.from(body, 'utf8') : body;
  if (!safeKey) {
    throw new Error('objectKey is required.');
  }

  const nativeBucket = resolveNativeR2Bucket();
  if (nativeBucket) {
    await nativeBucket.put(safeKey, normalizedBody, {
      httpMetadata: {
        contentType,
        cacheControl,
      },
    });
    return;
  }

  if (!isR2Configured) {
    throw new Error('Cloudflare R2 is not configured.');
  }

  await r2Client.send(new PutObjectCommand({
    Bucket: R2_BUCKET_NAME,
    Key: safeKey,
    Body: normalizedBody,
    ContentType: contentType,
    CacheControl: cacheControl,
  }));
};

export const readR2Object = async (
  objectKey: string,
): Promise<{ body: Buffer; contentType: string } | null> => {
  const safeKey = normalizeR2ObjectKey(objectKey);
  if (!safeKey) return null;

  const nativeBucket = resolveNativeR2Bucket();
  if (nativeBucket) {
    try {
      const response = await nativeBucket.get(safeKey);
      if (!response) return null;
      const body = await readBodyToBuffer(response.body ?? response);
      if (!body) return null;
      return {
        body,
        contentType: response.httpMetadata?.contentType || response.contentType || 'application/octet-stream',
      };
    } catch {
      return null;
    }
  }

  if (!isR2Configured) return null;

  try {
    const response = await r2Client.send(new GetObjectCommand({
      Bucket: R2_BUCKET_NAME,
      Key: safeKey,
    }));
    if (!response.Body) return null;
    const body = await readBodyToBuffer(response.Body);
    if (!body) return null;
    return {
      body,
      contentType: response.ContentType || 'application/octet-stream',
    };
  } catch {
    return null;
  }
};

export const getR2SignedObjectUrl = async (
  objectKey: string,
  expiresInSeconds: number = 10_800,
): Promise<string> => {
  const safeKey = normalizeR2ObjectKey(objectKey);
  if (!safeKey) {
    throw new Error('objectKey is required.');
  }

  if (!isR2Configured) {
    if (!resolveNativeR2Bucket()) {
      warnIfR2NotConfigured('Signed R2 URL generation');
    }
    return getR2PublicObjectUrl(safeKey);
  }

  return signS3Request(
    r2Client,
    new GetObjectCommand({
      Bucket: R2_BUCKET_NAME,
      Key: safeKey,
    }),
    { expiresIn: Math.max(60, Math.floor(expiresInSeconds)) },
  );
};
