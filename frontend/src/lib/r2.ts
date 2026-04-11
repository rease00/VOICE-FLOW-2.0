import { S3Client } from '@aws-sdk/client-s3';

// Cloudflare R2 configuration
const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID;
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID;
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY;
const R2_BUCKET = process.env.R2_BUCKET_NAME || 'vf-novel-storage';

const isDev = process.env.NODE_ENV === 'development';

if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY) {
  if (isDev) {
    console.warn(
      'Cloudflare R2 environment variables are missing. Using mock configurations for development. ' +
      'Check R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, and R2_SECRET_ACCESS_KEY.'
    );
  } else {
    console.error(
      'CRITICAL: Cloudflare R2 environment variables are missing in production! ' +
      'R2 storage operations will fail.'
    );
  }
}

export const R2_BUCKET_NAME = R2_BUCKET;

export const r2Client = new S3Client({
  region: 'auto',
  endpoint: `https://${R2_ACCOUNT_ID || 'mock-id'}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: R2_ACCESS_KEY_ID || 'mock-key',
    secretAccessKey: R2_SECRET_ACCESS_KEY || 'mock-secret',
  },
});
