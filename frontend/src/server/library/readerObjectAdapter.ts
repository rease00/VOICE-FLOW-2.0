import { GetObjectCommand } from '@aws-sdk/client-s3';

import { R2_BUCKET_NAME, isR2Configured, r2Client } from '../../lib/r2';

const streamToBuffer = async (body: AsyncIterable<Uint8Array>): Promise<Buffer> => {
  const chunks: Uint8Array[] = [];
  for await (const chunk of body) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
};

export const readLegacyReaderObject = async (
  objectKey: string,
): Promise<{ body: Buffer; contentType: string } | null> => {
  const safeKey = String(objectKey || '').trim();
  if (!safeKey || !isR2Configured) {
    return null;
  }

  try {
    const response = await r2Client.send(new GetObjectCommand({
      Bucket: R2_BUCKET_NAME,
      Key: safeKey,
    }));
    if (!response.Body) {
      return null;
    }
    return {
      body: await streamToBuffer(response.Body as AsyncIterable<Uint8Array>),
      contentType: response.ContentType || 'application/octet-stream',
    };
  } catch {
    return null;
  }
};
