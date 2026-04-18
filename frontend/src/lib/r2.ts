import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl as signS3Request } from '@aws-sdk/s3-request-presigner';

// Cloudflare R2 configuration
const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID;
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID;
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY;
const R2_BUCKET = process.env.R2_BUCKET_NAME || 'vf-novel-storage';
const R2_PUBLIC_BASE_URL = process.env.R2_PUBLIC_BASE_URL || process.env.NEXT_PUBLIC_R2_AUDIO_URL || `https://pub-${R2_BUCKET}.r2.dev`;

const isDev = process.env.NODE_ENV === 'development';
export const isR2Configured = Boolean(R2_ACCOUNT_ID && R2_ACCESS_KEY_ID && R2_SECRET_ACCESS_KEY);

let hasLoggedMissingR2Configuration = false;

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

export const getR2PublicObjectUrl = (objectKey: string): string => {
  const safeKey = String(objectKey || '').trim().replace(/^\/+/, '');
  return `${R2_PUBLIC_URL_BASE}/${safeKey}`;
};

export const getR2SignedObjectUrl = async (
  objectKey: string,
  expiresInSeconds: number = 10_800,
): Promise<string> => {
  const safeKey = String(objectKey || '').trim().replace(/^\/+/, '');
  if (!safeKey) {
    throw new Error('objectKey is required.');
  }

  if (!isR2Configured) {
    warnIfR2NotConfigured('Signed R2 URL generation');
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
