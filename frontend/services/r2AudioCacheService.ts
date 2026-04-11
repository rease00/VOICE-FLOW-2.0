/**
 * R2 Audio Cache Service
 *
 * Caches TTS audio in Cloudflare R2 to avoid re-generating identical audio.
 * Cached playback costs 50% VF compared to fresh generation.
 *
 * Key format: audio/{bookId}/{chapterId}/{settingsHash}.wav
 * settingsHash = SHA-256(text + voice + speed + engine)
 */

import { r2Client, R2_BUCKET_NAME } from '../src/lib/r2';
import {
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
} from '@aws-sdk/client-s3';
import { createHash } from 'crypto';

export interface AudioCacheKey {
  bookId: string;
  chapterId: string;
  text: string;
  voice: string;
  speed: number;
  engine: string;
}

export interface CachedAudio {
  audioContent: Buffer;
  contentType: string;
  cached: true;
}

function buildSettingsHash(key: AudioCacheKey): string {
  const payload = [key.text, key.voice, String(key.speed), key.engine].join('|');
  return createHash('sha256').update(payload).digest('hex');
}

function buildR2Key(key: AudioCacheKey): string {
  const hash = buildSettingsHash(key);
  const safeBookId = key.bookId.replace(/[^a-zA-Z0-9_-]/g, '');
  const safeChapterId = key.chapterId.replace(/[^a-zA-Z0-9_-]/g, '');
  return `audio/${safeBookId}/${safeChapterId}/${hash}.wav`;
}

/**
 * Check if cached audio exists in R2.
 */
export async function hasCachedAudio(key: AudioCacheKey): Promise<boolean> {
  try {
    await r2Client.send(
      new HeadObjectCommand({
        Bucket: R2_BUCKET_NAME,
        Key: buildR2Key(key),
      })
    );
    return true;
  } catch {
    return false;
  }
}

/**
 * Retrieve cached audio from R2.
 * Returns null if not found.
 */
export async function getCachedAudio(key: AudioCacheKey): Promise<CachedAudio | null> {
  try {
    const response = await r2Client.send(
      new GetObjectCommand({
        Bucket: R2_BUCKET_NAME,
        Key: buildR2Key(key),
      })
    );

    if (!response.Body) return null;

    const chunks: Uint8Array[] = [];
    const stream = response.Body as AsyncIterable<Uint8Array>;
    for await (const chunk of stream) {
      chunks.push(chunk);
    }

    return {
      audioContent: Buffer.concat(chunks),
      contentType: response.ContentType || 'audio/wav',
      cached: true,
    };
  } catch {
    return null;
  }
}

/**
 * Store generated audio in R2 for future reuse.
 */
export async function cacheAudio(
  key: AudioCacheKey,
  audioContent: Buffer,
  contentType: string = 'audio/wav'
): Promise<void> {
  try {
    await r2Client.send(
      new PutObjectCommand({
        Bucket: R2_BUCKET_NAME,
        Key: buildR2Key(key),
        Body: audioContent,
        ContentType: contentType,
        Metadata: {
          bookId: key.bookId,
          chapterId: key.chapterId,
          voice: key.voice,
          speed: String(key.speed),
          engine: key.engine,
          cachedAt: new Date().toISOString(),
        },
      })
    );
  } catch (err) {
    // Non-fatal — log and continue; the audio was already synthesized
    console.error('[r2AudioCache] Failed to cache audio:', err);
  }
}
