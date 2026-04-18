import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import fs from 'node:fs';
import path from 'node:path';
import { resetUniversalTtsRateLimitState } from '../src/server/tts/userRateLimit';

const synthesizeMock = vi.hoisted(() => vi.fn(async () => ({
  audioContent: Buffer.alloc(256, 1),
  contentType: 'audio/wav',
  model: 'gemini-2.5-flash-tts',
  projectId: 'test-project',
  provider: 'gemini-tts' as const,
})));
const buildBidirectionalTextChunksMock = vi.hoisted(() => vi.fn());
const streamBidirectionalSynthesizeMock = vi.hoisted(() => vi.fn());
const synthesizeBidirectionalToWavMock = vi.hoisted(() => vi.fn(async () => ({
  audioContent: Buffer.alloc(512, 2),
  contentType: 'audio/wav',
  pcmChunks: [Buffer.alloc(256, 2)],
  wavChunks: [Buffer.alloc(300, 3)],
  inputChunks: [{ index: 0, text: 'hello world', charCount: 11, byteCount: 11 }],
  responseChunkCount: 1,
  totalBytes: 256,
  timeToFirstAudioMs: 15,
  model: 'gemini-2.5-flash-tts',
  projectId: 'test-project',
  provider: 'gemini-tts' as const,
})));

vi.mock('../services/cloudTtsService', () => ({
  CLOUD_TTS_BIDI_TEXT_BYTE_CAP: 3_500,
  MAX_TEXT_LENGTH: 3_000,
  buildBidirectionalTextChunks: (...args: unknown[]) => buildBidirectionalTextChunksMock(...args),
  isConfigured: () => true,
  streamBidirectionalSynthesize: (...args: unknown[]) => streamBidirectionalSynthesizeMock(...args),
  synthesize: (...args: unknown[]) => synthesizeMock(...args),
  synthesizeBidirectionalToWav: (...args: unknown[]) => synthesizeBidirectionalToWavMock(...args),
}));

const originalDevUid = process.env.VF_DEV_UID_HEADER_ENABLED;
const originalDemoDevUid = process.env.VF_DEMO_DEV_UID;
const originalQuotaBypassUids = process.env.VF_STUDIO_TTS_QUOTA_BYPASS_UIDS;
const originalSpeakerIsolationGap = process.env.VF_SPEAKER_ISOLATION_MIN_CALL_GAP_MS;
const hindiStoryText = fs.readFileSync(
  path.resolve(process.cwd(), 'public', 'hindi_story.txt'),
  'utf8',
);

const buildRequest = (
  path: string,
  init: RequestInit & { headers?: HeadersInit } = {},
): NextRequest => new NextRequest(`http://127.0.0.1:3000${path}`, init);

describe('studio synth and stream routes', () => {
  beforeEach(() => {
    process.env.VF_DEV_UID_HEADER_ENABLED = '1';
    process.env.VF_DEMO_DEV_UID = 'demo-generator';
    process.env.VF_SPEAKER_ISOLATION_MIN_CALL_GAP_MS = '0';
    delete process.env.VF_STUDIO_TTS_QUOTA_BYPASS_UIDS;
    vi.clearAllMocks();
    resetUniversalTtsRateLimitState();
    buildBidirectionalTextChunksMock.mockImplementation((text: string) => {
      const safe = String(text || '').trim();
      if (!safe) return [];
      return [{ index: 0, text: safe, charCount: safe.length, byteCount: Buffer.byteLength(safe, 'utf8') }];
    });
    streamBidirectionalSynthesizeMock.mockImplementation(async (params: {
      onChunk?: ((chunk: {
        index: number;
        pcmBuffer: Buffer;
        wavBuffer: Buffer;
      }) => void | Promise<void>) | undefined;
    }) => {
      await params.onChunk?.({
        index: 0,
        pcmBuffer: Buffer.alloc(128, 4),
        wavBuffer: Buffer.alloc(172, 5),
      });
      return {
        pcmChunks: [Buffer.alloc(128, 4)],
        wavChunks: [Buffer.alloc(172, 5)],
        inputChunks: [{ index: 0, text: 'hello world', charCount: 11, byteCount: 11 }],
        responseChunkCount: 1,
        totalBytes: 128,
        timeToFirstAudioMs: 7,
        model: 'gemini-2.5-flash-tts',
        projectId: 'test-project',
        provider: 'gemini-tts' as const,
      };
    });
  });

  afterEach(() => {
    if (originalDevUid === undefined) delete process.env.VF_DEV_UID_HEADER_ENABLED;
    else process.env.VF_DEV_UID_HEADER_ENABLED = originalDevUid;

    if (originalDemoDevUid === undefined) delete process.env.VF_DEMO_DEV_UID;
    else process.env.VF_DEMO_DEV_UID = originalDemoDevUid;

    if (originalQuotaBypassUids === undefined) delete process.env.VF_STUDIO_TTS_QUOTA_BYPASS_UIDS;
    else process.env.VF_STUDIO_TTS_QUOTA_BYPASS_UIDS = originalQuotaBypassUids;

    if (originalSpeakerIsolationGap === undefined) delete process.env.VF_SPEAKER_ISOLATION_MIN_CALL_GAP_MS;
    else process.env.VF_SPEAKER_ISOLATION_MIN_CALL_GAP_MS = originalSpeakerIsolationGap;

    resetUniversalTtsRateLimitState();
    vi.resetModules();
  });

  it('returns 401 when synth auth is missing', async () => {
    const { handleStudioSynthesizeRoute } = await import('../src/server/studio/service');
    const response = await handleStudioSynthesizeRoute(
      buildRequest('/api/v1/studio/tts/synthesize', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: 'hello world' }),
      }),
    );

    expect(response.status).toBe(401);
    expect(synthesizeMock).not.toHaveBeenCalled();
  });

  it('uses bidi synthesis for authenticated single-voice requests', async () => {
    const { handleStudioSynthesizeRoute } = await import('../src/server/studio/service');
    const response = await handleStudioSynthesizeRoute(
      buildRequest('/api/v1/studio/tts/synthesize', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-dev-uid': 'admin_uid_1',
        },
        body: JSON.stringify({
          text: 'hello world',
          requestId: 'req-123',
          engine: 'PRIME',
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('x-vf-tts-transport')).toBe('bidi');
    expect(synthesizeBidirectionalToWavMock).toHaveBeenCalledWith(expect.objectContaining({
      text: 'hello world',
      requestId: 'req-123',
      engine: 'PRIME',
    }));
    expect(synthesizeMock).not.toHaveBeenCalled();
  });

  it('returns 401 when stream auth is missing', async () => {
    const { handleStudioStreamRoute } = await import('../src/server/studio/service');
    const response = await handleStudioStreamRoute(
      buildRequest('/api/v1/studio/tts/stream', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: 'hello world' }),
      }),
    );

    expect(response.status).toBe(401);
    expect(synthesizeMock).not.toHaveBeenCalled();
  });

  it('streams bidi chunk payloads and preserves requestId metadata', async () => {
    const { handleStudioStreamRoute } = await import('../src/server/studio/service');
    const response = await handleStudioStreamRoute(
      buildRequest('/api/v1/studio/tts/stream', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-dev-uid': 'admin_uid_1',
        },
        body: JSON.stringify({
          text: 'hello world',
          requestId: 'req-stream',
          engine: 'VECTOR',
        }),
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toContain('"requestId":"req-stream"');
    expect(response.headers.get('content-type')).toContain('text/event-stream');
    expect(response.headers.get('x-vf-tts-transport')).toBe('bidi');
    expect(streamBidirectionalSynthesizeMock).toHaveBeenCalledWith(expect.objectContaining({
      text: 'hello world',
      requestId: 'req-stream',
      engine: 'VECTOR',
    }));
    expect(synthesizeMock).not.toHaveBeenCalled();
  });

  it('uses speaker-isolation synthesis for multi-speaker requests', async () => {
    const { handleStudioSynthesizeRoute } = await import('../src/server/studio/service');
    const response = await handleStudioSynthesizeRoute(
      buildRequest('/api/v1/studio/tts/synthesize', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-dev-uid': 'multi-speaker-1',
        },
        body: JSON.stringify({
          text: 'Narrator: Hello.\nHero: Hi.',
          requestId: 'req-multi',
          engine: 'VECTOR',
          speakerConfigs: [
            { speaker: 'Narrator', voice: 'Kore' },
            { speaker: 'Hero', voice: 'Fenrir' },
          ],
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('audio/wav');
    expect(response.headers.get('x-vf-tts-transport')).toBe('speaker-isolation');
    expect(response.headers.get('x-vf-tts-fallback-reason')).toBe('multi-speaker-isolation');
    expect(response.headers.get('x-vf-tts-speaker-count')).toBe('2');
    expect(synthesizeMock).toHaveBeenCalledTimes(2);
    const callVoices = synthesizeMock.mock.calls.map((call) => String((call[0] as { voice?: string })?.voice || ''));
    expect(callVoices).toEqual(expect.arrayContaining(['Kore', 'Fenrir']));
    expect(synthesizeMock.mock.calls.every((call) => {
      const payload = call[0] as { multiSpeaker?: unknown; outputFormat?: string };
      return typeof payload.multiSpeaker === 'undefined' && payload.outputFormat === 'wav';
    })).toBe(true);
    expect(synthesizeBidirectionalToWavMock).not.toHaveBeenCalled();
  });

  it('converts break tags into pause events while stitching speaker-isolation output', async () => {
    const { handleStudioSynthesizeRoute } = await import('../src/server/studio/service');
    const response = await handleStudioSynthesizeRoute(
      buildRequest('/api/v1/studio/tts/synthesize', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-dev-uid': 'multi-speaker-break-1',
        },
        body: JSON.stringify({
          text: 'Narrator: Hello there.\n<break time="300ms"/>\nHero: Hi back.',
          requestId: 'req-break',
          engine: 'VECTOR',
          speakerConfigs: [
            { speaker: 'Narrator', voice: 'Kore' },
            { speaker: 'Hero', voice: 'Fenrir' },
          ],
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('x-vf-tts-transport')).toBe('speaker-isolation');
    expect(response.headers.get('x-vf-tts-line-count')).toBe('2');
    expect(response.headers.get('x-vf-tts-speaker-count')).toBe('2');
    expect(synthesizeMock).toHaveBeenCalledTimes(2);
  });

  it('streams speaker-isolation chunks for multi-speaker stream requests', async () => {
    const { handleStudioStreamRoute } = await import('../src/server/studio/service');
    const response = await handleStudioStreamRoute(
      buildRequest('/api/v1/studio/tts/stream', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-dev-uid': 'stream-multi-1',
        },
        body: JSON.stringify({
          text: 'Narrator: Hello stream.\nHero: Hi stream.',
          requestId: 'req-stream-multi',
          engine: 'VECTOR',
          speakerConfigs: [
            { speaker: 'Narrator', voice: 'Kore' },
            { speaker: 'Hero', voice: 'Fenrir' },
          ],
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/event-stream');
    expect(response.headers.get('x-vf-tts-transport')).toBe('speaker-isolation');
    expect(response.headers.get('x-vf-tts-fallback-reason')).toBe('multi-speaker-isolation');

    const payload = await response.text();
    expect(payload).toContain('"type":"chunk"');
    expect(payload).toContain('"total":1');
    expect(payload).toContain('"speakerCount":2');
    expect(payload).toContain('"requestId":"req-stream-multi"');
    expect(payload).toContain('"type":"done"');

    expect(synthesizeMock).toHaveBeenCalledTimes(2);
    expect(synthesizeBidirectionalToWavMock).not.toHaveBeenCalled();
    expect(streamBidirectionalSynthesizeMock).not.toHaveBeenCalled();
  });

  it('falls back to sync synthesis if bidi aggregation fails before audio is returned', async () => {
    synthesizeBidirectionalToWavMock.mockRejectedValueOnce(new Error('bidi unavailable'));
    const { handleStudioSynthesizeRoute } = await import('../src/server/studio/service');
    const response = await handleStudioSynthesizeRoute(
      buildRequest('/api/v1/studio/tts/synthesize', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-dev-uid': 'bidi-fallback-1',
        },
        body: JSON.stringify({
          text: 'hello world',
          requestId: 'req-bidi-fallback',
          engine: 'VECTOR',
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('x-vf-tts-transport')).toBe('sync-fallback');
    expect(response.headers.get('x-vf-tts-fallback-reason')).toBe('bidi-error');
    expect(synthesizeMock).toHaveBeenCalledWith(expect.objectContaining({
      text: 'hello world',
      requestId: 'req-bidi-fallback',
    }));
  });

  it('uses one bidi synthesis per long-text request and counts each request once against RPM', async () => {
    buildBidirectionalTextChunksMock.mockImplementation((text: string) => {
      const safe = String(text || '').trim();
      return [
        { index: 0, text: safe.slice(0, 20), charCount: Math.min(safe.length, 20), byteCount: Buffer.byteLength(safe.slice(0, 20), 'utf8') },
        { index: 1, text: safe.slice(20, 40), charCount: Math.max(0, Math.min(safe.length - 20, 20)), byteCount: Buffer.byteLength(safe.slice(20, 40), 'utf8') },
        { index: 2, text: safe.slice(40), charCount: Math.max(0, safe.length - 40), byteCount: Buffer.byteLength(safe.slice(40), 'utf8') },
      ].filter((item) => item.text.length > 0);
    });
    const { handleStudioSynthesizeRoute } = await import('../src/server/studio/service');
    const { handleStudioLongTextRoute } = await import('../src/server/studio/service');

    for (let index = 0; index < 10; index += 1) {
      const response = await handleStudioLongTextRoute(
        buildRequest('/api/v1/studio/tts/long-text', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-dev-uid': 'rpm-user-1',
          },
          body: JSON.stringify({
            text: `hello world ${index} and some additional text to force chunk planning across the bidi session`,
            requestId: `req-${index}`,
            engine: 'VECTOR',
          }),
        }),
      );
      expect(response.status).toBe(200);
    }

    expect(synthesizeBidirectionalToWavMock).toHaveBeenCalledTimes(10);
    expect(synthesizeMock).not.toHaveBeenCalled();

    const limitedResponse = await handleStudioLongTextRoute(
      buildRequest('/api/v1/studio/tts/long-text', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-dev-uid': 'rpm-user-1',
        },
        body: JSON.stringify({
          text: 'this one should be rate limited',
          requestId: 'req-limited',
          engine: 'VECTOR',
        }),
      }),
    );

    expect(limitedResponse.status).toBe(429);
    await expect(limitedResponse.json()).resolves.toMatchObject({
      error: 'RATE_LIMITED',
      code: 'TTS_RPM_LIMIT',
      limit: 10,
    });
  });

  it('bypasses RPM limits for demo-generation uid in dev mode', async () => {
    const { handleStudioSynthesizeRoute } = await import('../src/server/studio/service');

    for (let index = 0; index < 15; index += 1) {
      const response = await handleStudioSynthesizeRoute(
        buildRequest('/api/v1/studio/tts/synthesize', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-dev-uid': 'demo-generator',
          },
          body: JSON.stringify({
            text: `demo generation pass ${index}`,
            requestId: `demo-pass-${index}`,
            engine: 'VECTOR',
          }),
        }),
      );

      expect(response.status).toBe(200);
    }

    expect(synthesizeBidirectionalToWavMock).toHaveBeenCalledTimes(15);
  });

  it('does not consume RPM budget for invalid synth payloads', async () => {
    const { handleStudioSynthesizeRoute } = await import('../src/server/studio/service');

    for (let index = 0; index < 15; index += 1) {
      const response = await handleStudioSynthesizeRoute(
        buildRequest('/api/v1/studio/tts/synthesize', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-dev-uid': 'invalid-payload-user',
          },
          body: JSON.stringify({
            text: '',
            requestId: `invalid-${index}`,
            engine: 'VECTOR',
          }),
        }),
      );

      expect(response.status).toBe(400);
    }

    const validResponse = await handleStudioSynthesizeRoute(
      buildRequest('/api/v1/studio/tts/synthesize', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-dev-uid': 'invalid-payload-user',
        },
        body: JSON.stringify({
          text: 'valid request after invalid attempts',
          requestId: 'valid-after-invalid',
          engine: 'VECTOR',
        }),
      }),
    );

    expect(validResponse.status).toBe(200);
    expect(synthesizeBidirectionalToWavMock).toHaveBeenCalledTimes(1);
  });

  it('keeps the Hindi multi-speaker story on speaker-isolation synthesis with one call per cast voice', async () => {
    const { handleStudioLongTextRoute } = await import('../src/server/studio/service');
    const response = await handleStudioLongTextRoute(
      buildRequest('/api/v1/studio/tts/long-text', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-dev-uid': 'hindi-story-1',
        },
        body: JSON.stringify({
          text: hindiStoryText,
          requestId: 'req-hindi-story',
          engine: 'VECTOR',
          language: 'hi-IN',
          speakerConfigs: [
            { speaker: 'Narrator', voice: 'Kore' },
            { speaker: 'Mohan', voice: 'Fenrir' },
            { speaker: 'Maa', voice: 'Aoede' },
            { speaker: 'Aunty', voice: 'Leda' },
            { speaker: 'Sabziwala', voice: 'Orus' },
          ],
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('x-vf-tts-transport')).toBe('speaker-isolation');
    expect(response.headers.get('x-vf-tts-fallback-reason')).toBe('multi-speaker-isolation');
    expect(response.headers.get('x-vf-tts-speaker-count')).toBe('5');
    expect(synthesizeMock).toHaveBeenCalledTimes(5);
    expect(synthesizeMock.mock.calls.every((call) => {
      const payload = call[0] as { requestId?: string; language?: string; multiSpeaker?: unknown; outputFormat?: string };
      return String(payload.requestId || '').startsWith('req-hindi-story:speaker:')
        && payload.language === 'hi-IN'
        && typeof payload.multiSpeaker === 'undefined'
        && payload.outputFormat === 'wav';
    })).toBe(true);
    expect(synthesizeBidirectionalToWavMock).not.toHaveBeenCalled();
  });
});
