import { getFirebaseAdminAuth } from '../firebaseAdmin';
import { verifyFirebaseRequest as verifyAuthedStudioRequest } from '../auth/requestAuth.ts';
import {
  DEFAULT_TRANSLATION_MODEL,
  isVertexTextConfigured,
  translateTextWithVertex,
} from '../vertexTextService';
import {
  buildRuntimePolicyMeta,
  getRuntimeLabelForEngine,
} from '../tts/runtimePolicy';
import { readEnvBoolean } from '../../shared/runtime/env.ts';
import {
  buildUniversalTtsRateLimitResponse,
  consumeUniversalTtsRateLimit,
} from '../tts/userRateLimit';
import { buildSentenceAlignedCharWindows } from '../../../services/ttsLongTextService';
import {
  CLOUD_TTS_BIDI_TEXT_BYTE_CAP,
  MAX_TEXT_LENGTH,
  buildBidirectionalTextChunks,
  isConfigured as isCloudTtsConfigured,
  streamBidirectionalSynthesize,
  synthesize,
  synthesizeBidirectionalToWav,
  type CloudTtsBidiInputChunk,
  type TtsEngine,
} from '../../../services/cloudTtsService';
import { synthesizeSpeakerIsolationWav } from './speakerIsolationSynth';
import {
  handleAudioNovelJobCreateRoute,
  handleAudioNovelJobStatusRoute,
} from '../audioNovel/service';
import type {
  ReaderModernizeRequest,
  ReaderModernizeResponse,
  ReaderStudioExportDriveRequest,
  ReaderStudioExportDriveResponse,
  ReaderStudioSynthesizeRequest,
} from './contracts';

const DEFAULT_READER_VOICE = 'Kore';
const DEFAULT_READER_LANGUAGE = 'en-US';
const DEFAULT_READER_STYLE = 'modern-audiobook';
const DEFAULT_TTS_MODEL = String(
  process.env.VF_READER_TTS_MODEL
  || process.env.VF_TTS_TEXTTOSPEECH_MODEL
  || 'gemini-2.5-flash-tts',
).trim() || 'gemini-2.5-flash-tts';
const DEFAULT_DEMO_QUOTA_BYPASS_UID = 'demo-generator';
const MODERNIZE_CHUNK_CHAR_CAP = 1_800;
const MAX_STUDIO_TEXT_LENGTH = 20_000;
const MAX_STUDIO_LONG_TEXT_LENGTH = 50_000;
const DRIVE_UPLOAD_BASE = 'https://www.googleapis.com/upload/drive/v3/files';
const STUDIO_CHUNK_TARGET = 2_400;
const SENTENCE_ENDINGS = /(?<=[.!?।॥\u3002\uff01\uff1f])\s+/;
const VALID_ENGINES: ReadonlySet<TtsEngine> = new Set(['VECTOR', 'PRIME']);
const STUDIO_BIDI_STREAM_PROMPT = 'Read the following in a clean, natural audiobook style with steady pacing.';

type StudioTtsTransportMode = 'bidi-single-voice' | 'sync-fallback' | 'speaker-isolation';
type StudioTtsTransportReason =
  | 'single-voice'
  | 'multi-speaker-isolation'
  | 'payload-limit'
  | 'bidi-error'
  | 'unsupported';

interface StudioTtsTransportPlan {
  mode: StudioTtsTransportMode;
  reason: StudioTtsTransportReason;
  canUseBidi: boolean;
  chunkCount: number;
  textBytes: number;
  inputChunks: CloudTtsBidiInputChunk[];
}

const normalizeStudioEngine = (value: unknown): TtsEngine => {
  const token = String(value || 'VECTOR').trim().toUpperCase();
  return token === 'PRIME' ? 'PRIME' : 'VECTOR';
};

const parseStudioEngine = (value: unknown): TtsEngine | null => {
  const token = String(value || '').trim().toUpperCase();
  if (token === 'VECTOR' || token === 'PRIME') {
    return token;
  }
  return null;
};

const sanitizeText = (value: string): string => (
  String(value || '')
    .replace(/\r/g, '\n')
    .trim()
);

const nowIso = (): string => new Date().toISOString();

const sanitizeInput = (value: string): string => (
  String(value || '').replace(/["`${}]/g, '').trim()
);

const sanitizeHeaderBearerToken = (value: string | null): string => {
  const safe = String(value || '').trim();
  if (!safe.toLowerCase().startsWith('bearer ')) {
    return '';
  }
  return safe.slice(7).trim();
};

const sanitizeFileName = (value: string, fallback: string): string => {
  const safe = String(value || '')
    .replace(/[\\/:*?"<>|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return safe || fallback;
};

const splitUidList = (value: string): string[] => (
  String(value || '')
    .split(/[\s,;|]+/)
    .map((token) => token.trim())
    .filter(Boolean)
);

const shouldBypassStudioQuotaLimit = (uid: string): boolean => {
  const userKey = String(uid || '').trim();
  if (!userKey) return false;

  const devUidHeadersEnabled = readEnvBoolean(
    process.env.VF_DEV_UID_HEADER_ENABLED,
    process.env.NEXT_PUBLIC_ENABLE_DEV_UID_HEADER,
  ) === true;

  if (!devUidHeadersEnabled) return false;

  const bypassUids = new Set<string>([
    DEFAULT_DEMO_QUOTA_BYPASS_UID,
    ...splitUidList(process.env.VF_DEMO_DEV_UID || ''),
    ...splitUidList(process.env.VF_STUDIO_TTS_QUOTA_BYPASS_UIDS || ''),
  ]);

  return bypassUids.has(userKey);
};

const toSpeakerConfigs = (value: unknown): Array<{ speaker: string; voice: string }> => {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (!item || typeof item !== 'object') return null;
      const speaker = String((item as Record<string, unknown>).speaker || '').trim();
      const voice = String((item as Record<string, unknown>).voice || '').trim();
      if (!speaker || !voice) return null;
      return { speaker, voice };
    })
    .filter((item): item is { speaker: string; voice: string } => Boolean(item));
};

const json = (payload: unknown, init?: ResponseInit): Response => {
  return Response.json(payload, init);
};

const errorResponse = (status: number, error: string): Response => {
  return json({ error }, { status });
};

const buildNativeStudioEngineHealthUrl = (request: Request, engine: string): string => {
  try {
    const url = new URL(request.url);
    url.pathname = '/api/v1/studio/tts/engines/status';
    url.search = `?engine=${encodeURIComponent(engine)}`;
    return url.toString();
  } catch {
    return `/api/v1/studio/tts/engines/status?engine=${encodeURIComponent(engine)}`;
  }
};

const buildNativeStudioEngineRuntimeUrl = (request: Request): string => {
  try {
    const url = new URL(request.url);
    url.pathname = '/api/v1/studio/tts/stream';
    url.search = '';
    return url.toString();
  } catch {
    return '/api/v1/studio/tts/stream';
  }
};

const buildNativeStudioEngineStatus = (
  request: Request,
  engine: 'PRIME' | 'VECTOR',
): Record<string, unknown> => {
  const configured = isCloudTtsConfigured();
  const runtimeMeta = buildRuntimePolicyMeta(engine, 'ephemeral');
  const detail = configured
    ? 'Native studio TTS is ready. Engine warmup is not required.'
    : 'Cloud TTS service is not configured.';
  const state = configured ? 'online' : 'not_configured';
  return {
    engine,
    runtimeLabel: runtimeMeta.runtimeLabel,
    storagePolicy: runtimeMeta.storagePolicy,
    preferredModel: runtimeMeta.model,
    state,
    detail,
    ready: configured,
    healthUrl: buildNativeStudioEngineHealthUrl(request, engine),
    runtimeUrl: buildNativeStudioEngineRuntimeUrl(request),
  };
};

const parseJsonBody = async <T>(request: Request): Promise<T | null> => {
  try {
    return await request.json() as T;
  } catch {
    return null;
  }
};

const parseModernizeRequest = (body: ReaderModernizeRequest | null): ReaderModernizeRequest | null => {
  if (!body || typeof body !== 'object') return null;
  const text = sanitizeText(body.text);
  const targetLanguage = sanitizeText(body.targetLanguage);
  if (!text || !targetLanguage) return null;
  return { text, targetLanguage };
};

const normalizeStudioRequest = (body: ReaderStudioSynthesizeRequest | null): ReaderStudioSynthesizeRequest | null => {
  if (!body || typeof body !== 'object') return null;
  const text = sanitizeText(body.text);
  if (!text) return null;
  return {
    mode: 'studio',
    text,
    requestId: String(body.requestId || '').trim() || undefined,
    language: String(body.language || DEFAULT_READER_LANGUAGE).trim() || DEFAULT_READER_LANGUAGE,
    voice: String(body.voice || DEFAULT_READER_VOICE).trim() || DEFAULT_READER_VOICE,
    engine: String(body.engine || 'VECTOR').trim() || 'VECTOR',
    speed: Number.isFinite(Number(body.speed)) ? Number(body.speed) : 1,
    pitch: Number.isFinite(Number(body.pitch)) ? Number(body.pitch) : 0,
    speakerConfigs: toSpeakerConfigs(body.speakerConfigs),
  };
};

const normalizeStudioLongTextRequest = (body: ReaderStudioSynthesizeRequest | null): ReaderStudioSynthesizeRequest | null => {
  const normalized = normalizeStudioRequest(body);
  if (!normalized) return null;
  if (normalized.text.length > MAX_STUDIO_LONG_TEXT_LENGTH) {
    return {
      ...normalized,
      text: normalized.text.slice(0, MAX_STUDIO_LONG_TEXT_LENGTH),
    };
  }
  return normalized;
};

const buildModernizeChunkWindows = (text: string) => {
  return buildSentenceAlignedCharWindows(text, MODERNIZE_CHUNK_CHAR_CAP, false);
};

const chunkStudioText = (text: string, hardCap: number = MAX_TEXT_LENGTH): string[] => {
  if (text.length <= STUDIO_CHUNK_TARGET) return [text];

  const sentences = text.split(SENTENCE_ENDINGS).filter(Boolean);
  const chunks: string[] = [];
  let current = '';

  for (const sentence of sentences) {
    if (sentence.length > hardCap) {
      if (current.trim()) {
        chunks.push(current.trim());
        current = '';
      }
      const words = sentence.split(/\s+/);
      let part = '';
      for (const word of words) {
        if ((part + ' ' + word).trim().length > STUDIO_CHUNK_TARGET && part.trim()) {
          chunks.push(part.trim());
          part = word;
        } else {
          part = part ? `${part} ${word}` : word;
        }
      }
      if (part.trim()) current = part.trim();
      continue;
    }

    if ((current + ' ' + sentence).trim().length > STUDIO_CHUNK_TARGET && current.trim()) {
      chunks.push(current.trim());
      current = sentence;
    } else {
      current = current ? `${current} ${sentence}` : sentence;
    }
  }

  if (current.trim()) chunks.push(current.trim());
  return chunks.length > 0 ? chunks : [text.slice(0, hardCap)];
};

const getTextByteLength = (value: string): number => (
  new TextEncoder().encode(String(value || '')).length
);

const planStudioTransport = (request: ReaderStudioSynthesizeRequest): StudioTtsTransportPlan => {
  const speakerConfigs = toSpeakerConfigs(request.speakerConfigs);
  const textBytes = getTextByteLength(request.text);
  if (speakerConfigs.length > 0) {
    return {
      mode: 'speaker-isolation',
      reason: 'multi-speaker-isolation',
      canUseBidi: false,
      chunkCount: 0,
      textBytes,
      inputChunks: [],
    };
  }

  try {
    const inputChunks = buildBidirectionalTextChunks(request.text, {
      maxBytesPerChunk: CLOUD_TTS_BIDI_TEXT_BYTE_CAP,
    });
    if (inputChunks.length <= 0) {
      return {
        mode: 'sync-fallback',
        reason: 'unsupported',
        canUseBidi: false,
        chunkCount: 0,
        textBytes,
        inputChunks: [],
      };
    }

    return {
      mode: 'bidi-single-voice',
      reason: 'single-voice',
      canUseBidi: true,
      chunkCount: inputChunks.length,
      textBytes,
      inputChunks,
    };
  } catch {
    return {
      mode: 'sync-fallback',
      reason: 'payload-limit',
      canUseBidi: false,
      chunkCount: 0,
      textBytes,
      inputChunks: [],
    };
  }
};

const buildStudioTransportHeaders = (
  plan: StudioTtsTransportPlan,
  extras?: Record<string, string | number | undefined>,
): HeadersInit => {
  const transport = plan.mode === 'speaker-isolation'
    ? 'speaker-isolation'
    : (plan.canUseBidi ? 'bidi' : 'sync-fallback');
  const headers: Record<string, string> = {
    'Cache-Control': 'no-store',
    'x-vf-tts-transport': transport,
    'x-vf-tts-fallback-reason': plan.reason,
  };
  if (plan.canUseBidi) {
    headers['x-vf-tts-bidi-chunks'] = String(plan.chunkCount);
  }
  Object.entries(extras || {}).forEach(([key, value]) => {
    if (typeof value === 'undefined') return;
    headers[key] = String(value);
  });
  return headers;
};

const logStudioTransportPlan = (
  phase: 'plan' | 'result',
  plan: StudioTtsTransportPlan,
  engine: TtsEngine,
  details?: Record<string, unknown>,
): void => {
  const transport = plan.mode === 'speaker-isolation'
    ? 'speaker-isolation'
    : (plan.canUseBidi ? 'bidi' : 'sync-fallback');
  const payload = {
    phase,
    transport,
    reason: plan.reason,
    engine,
    textBytes: plan.textBytes,
    chunkCount: plan.chunkCount,
    ...(details || {}),
  };
  console.info(`[studio-tts] ${JSON.stringify(payload)}`);
};

const modernizeReaderText = async (request: ReaderModernizeRequest): Promise<ReaderModernizeResponse> => {
  if (!isVertexTextConfigured()) {
    throw new Error('Vertex text service is not configured.');
  }

  const sourceText = sanitizeText(request.text);
  const targetLanguage = sanitizeText(request.targetLanguage);
  const windows = buildModernizeChunkWindows(sourceText);
  const translatedParts: string[] = [];

  for (const window of windows) {
    const translated = await translateTextWithVertex({
      text: window.text,
      targetLanguage,
    });
    translatedParts.push(translated.trim());
  }

  return {
    translatedText: translatedParts.join('\n\n').trim(),
    model: DEFAULT_TRANSLATION_MODEL,
    style: 'modern-audiobook',
  };
};

const synthesizeStudioAudioFallback = async (
  request: ReaderStudioSynthesizeRequest,
  outputFormat: 'mp3' | 'wav' | 'ogg' = 'mp3',
  plan?: StudioTtsTransportPlan,
): Promise<Response> => {
  if (!isCloudTtsConfigured()) {
    return errorResponse(503, 'Cloud TTS service is not configured.');
  }
  if (request.text.length > MAX_STUDIO_TEXT_LENGTH) {
    return errorResponse(400, `text exceeds ${MAX_STUDIO_TEXT_LENGTH} character limit.`);
  }

  const engine = normalizeStudioEngine(request.engine);
  const result = await synthesize({
    text: request.text,
    requestId: request.requestId,
    voice: request.voice,
    language: request.language,
    engine,
    speed: request.speed,
    pitch: request.pitch,
    multiSpeaker: toSpeakerConfigs(request.speakerConfigs),
    outputFormat,
  });

  return new Response(result.audioContent, {
    headers: {
      'Content-Type': result.contentType,
      'Content-Length': String(result.audioContent.length),
      ...buildStudioTransportHeaders(plan || {
        mode: 'sync-fallback',
        reason: 'unsupported',
        canUseBidi: false,
        chunkCount: 0,
        textBytes: getTextByteLength(request.text),
        inputChunks: [],
      }),
    },
  });
};

const synthesizeStudioAudioSpeakerIsolation = async (
  request: ReaderStudioSynthesizeRequest,
  plan: StudioTtsTransportPlan,
  maxTextLength: number,
): Promise<Response> => {
  if (!isCloudTtsConfigured()) {
    return errorResponse(503, 'Cloud TTS service is not configured.');
  }
  if (request.text.length > maxTextLength) {
    return errorResponse(400, `text exceeds ${maxTextLength} character limit.`);
  }

  const speakerConfigs = toSpeakerConfigs(request.speakerConfigs);
  if (speakerConfigs.length <= 0) {
    return errorResponse(400, 'speakerConfigs are required for speaker isolation synthesis.');
  }

  const engine = normalizeStudioEngine(request.engine);
  const result = await synthesizeSpeakerIsolationWav({
    text: request.text,
    requestId: request.requestId,
    language: request.language,
    voice: request.voice,
    engine,
    speed: request.speed,
    pitch: request.pitch,
    speakerConfigs,
  });

  logStudioTransportPlan('result', plan, engine, {
    speakerCount: result.speakerCount,
    lineCount: result.lineCount,
    providerCalls: result.diagnostics.providerCalls,
    providerRetries: result.diagnostics.providerRetries,
    segmentFallbacks: result.diagnostics.segmentFallbacks,
    silenceCutCount: result.diagnostics.silenceCutCount,
  });

  return new Response(result.audioContent, {
    headers: {
      'Content-Type': result.contentType,
      'Content-Length': String(result.audioContent.length),
      ...buildStudioTransportHeaders(plan, {
        'x-vf-tts-speaker-count': result.speakerCount,
        'x-vf-tts-line-count': result.lineCount,
        'x-vf-tts-provider-calls': result.diagnostics.providerCalls,
      }),
    },
  });
};

const synthesizeStudioAudioBidi = async (
  request: ReaderStudioSynthesizeRequest,
  plan: StudioTtsTransportPlan,
): Promise<Response> => {
  const engine = normalizeStudioEngine(request.engine);
  const result = await synthesizeBidirectionalToWav({
    text: request.text,
    requestId: request.requestId,
    voice: request.voice,
    language: request.language,
    engine,
    speed: request.speed,
    prompt: STUDIO_BIDI_STREAM_PROMPT,
    inputChunks: plan.inputChunks,
  });

  logStudioTransportPlan('result', plan, engine, {
    timeToFirstAudioMs: result.timeToFirstAudioMs,
    responseChunkCount: result.responseChunkCount,
    totalBytes: result.totalBytes,
  });

  return new Response(result.audioContent, {
    headers: {
      'Content-Type': result.contentType,
      'Content-Length': String(result.audioContent.length),
      ...buildStudioTransportHeaders(plan, {
        'x-vf-tts-bidi-response-chunks': result.responseChunkCount,
      }),
    },
  });
};

const verifyFirebaseRequest = async (request: Request): Promise<string> => {
  const decoded = await verifyAuthedStudioRequest(request);
  return String(decoded.uid || '').trim();
};

const isUnauthorizedStudioRequestError = (error: unknown): boolean => {
  const lowered = String(error instanceof Error ? error.message : error || '').trim().toLowerCase();
  return (
    lowered.includes('missing authorization')
    || lowered.includes('missing firebase bearer token')
    || lowered.includes('auth/id-token-expired')
    || lowered.includes('auth/argument-error')
    || lowered.includes('id token')
    || lowered.includes('jwt')
  );
};

const uploadStudioAudioToDrive = async (
  payload: ReaderStudioExportDriveRequest,
): Promise<ReaderStudioExportDriveResponse> => {
  const boundary = `voiceflow_drive_${Math.random().toString(36).slice(2)}`;
  const mimeType = String(payload.mimeType || 'audio/mpeg').trim() || 'audio/mpeg';
  const fileName = sanitizeFileName(payload.fileName || `voiceflow-studio-${Date.now()}.mp3`, 'voiceflow-studio.mp3');
  const audioBytes = Buffer.from(payload.audioBase64, 'base64');

  const body = new Blob(
    [
      `--${boundary}\r\n`,
      'Content-Type: application/json; charset=UTF-8\r\n\r\n',
      JSON.stringify({ name: fileName }),
      '\r\n',
      `--${boundary}\r\n`,
      `Content-Type: ${mimeType}\r\n\r\n`,
      audioBytes,
      '\r\n',
      `--${boundary}--`,
    ],
    { type: `multipart/related; boundary=${boundary}` },
  );

  const response = await fetch(`${DRIVE_UPLOAD_BASE}?uploadType=multipart&fields=id,name,webViewLink`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${payload.googleAccessToken}`,
      'Content-Type': `multipart/related; boundary=${boundary}`,
    },
    body,
  });

  if (!response.ok) {
    const message = await response.text().catch(() => `${response.status} ${response.statusText}`);
    throw new Error(message || 'Drive upload failed.');
  }

  const data = await response.json() as { id?: string; name?: string; webViewLink?: string };
  if (!data.id || !data.name) {
    throw new Error('Drive upload returned an incomplete response.');
  }

  return {
    fileId: data.id,
    fileName: data.name,
    ...(data.webViewLink ? { webViewLink: data.webViewLink } : {}),
  };
};

const buildWavHeader = (dataLength: number): Buffer => {
  const header = Buffer.alloc(44);
  const blockAlign = 1 * (16 / 8);
  const byteRate = 24000 * blockAlign;

  header.write('RIFF', 0);
  header.writeUInt32LE(36 + dataLength, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(24000, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(dataLength, 40);

  return header;
};

const stripWavHeader = (buf: Buffer): Buffer => {
  for (let i = 0; i < Math.min(buf.length - 8, 200); i += 1) {
    if (
      buf[i] === 0x64 &&
      buf[i + 1] === 0x61 &&
      buf[i + 2] === 0x74 &&
      buf[i + 3] === 0x61
    ) {
      return buf.subarray(i + 8);
    }
  }
  return buf.subarray(44);
};

const concatenateWavBuffers = (buffers: Buffer[]): Buffer => {
  const pcmChunks = buffers.map(stripWavHeader);
  const totalPcmLength = pcmChunks.reduce((acc, chunk) => acc + chunk.length, 0);
  const header = buildWavHeader(totalPcmLength);
  return Buffer.concat([header, ...pcmChunks]);
};

const synthesizeStudioChunk = async (
  chunk: string,
  request: ReaderStudioSynthesizeRequest,
  chunkIndex: number = 0,
): Promise<Buffer> => {
  const engine = parseStudioEngine(request.engine);
  if (!engine || !VALID_ENGINES.has(engine)) {
    throw new Error('Invalid engine. Use VECTOR or PRIME.');
  }
  const result = await synthesize({
    text: chunk,
    requestId: request.requestId ? `${request.requestId}:chunk:${chunkIndex}` : undefined,
    voice: request.voice,
    engine,
    language: request.language,
    speed: request.speed,
    pitch: request.pitch,
    multiSpeaker: toSpeakerConfigs(request.speakerConfigs),
  });
  return result.audioContent;
};

const streamStudioFallbackSse = async (
  body: ReaderStudioSynthesizeRequest,
  controller: ReadableStreamDefaultController<Uint8Array>,
  encoder: TextEncoder,
  plan: StudioTtsTransportPlan,
): Promise<void> => {
  const chunks = chunkStudioText(sanitizeInput(body.text));
  const requestId = String(body.requestId || '').trim() || undefined;

  for (let index = 0; index < chunks.length; index += 1) {
    const chunk = chunks[index];
    if (!chunk) continue;

    try {
      const audio = await synthesizeStudioChunk(chunk, body, index);
      controller.enqueue(encoder.encode(`data: ${JSON.stringify({
        type: 'chunk',
        index,
        total: chunks.length,
        audioBase64: audio.toString('base64'),
        contentType: 'audio/wav',
        engine: normalizeStudioEngine(body.engine),
        charCount: chunk.length,
        ...(requestId ? { requestId } : {}),
      })}\n\n`));
    } catch (chunkError) {
      const message = chunkError instanceof Error ? chunkError.message : 'Chunk synthesis failed.';
      controller.enqueue(encoder.encode(`data: ${JSON.stringify({
        type: 'error',
        message,
        chunkIndex: index,
        ...(requestId ? { requestId } : {}),
      })}\n\n`));
      logStudioTransportPlan('result', plan, normalizeStudioEngine(body.engine), {
        fallbackReason: 'chunk-error',
        error: message,
      });
      return;
    }
  }

  controller.enqueue(encoder.encode(`data: ${JSON.stringify({
    type: 'done',
    totalChunks: chunks.length,
    engine: normalizeStudioEngine(body.engine),
    ...(requestId ? { requestId } : {}),
  })}\n\n`));
};

const streamStudioBidiSse = async (
  body: ReaderStudioSynthesizeRequest,
  controller: ReadableStreamDefaultController<Uint8Array>,
  encoder: TextEncoder,
  plan: StudioTtsTransportPlan,
): Promise<void> => {
  const engine = normalizeStudioEngine(body.engine);
  const requestId = String(body.requestId || '').trim() || undefined;
  let emittedChunkCount = 0;

  try {
    const result = await streamBidirectionalSynthesize({
      text: body.text,
      requestId,
      voice: body.voice,
      language: body.language,
      engine,
      speed: body.speed,
      prompt: STUDIO_BIDI_STREAM_PROMPT,
      inputChunks: plan.inputChunks,
      onChunk: async (chunk) => {
        emittedChunkCount += 1;
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({
          type: 'chunk',
          index: chunk.index,
          audioBase64: chunk.wavBuffer.toString('base64'),
          contentType: 'audio/wav',
          engine,
          charCount: plan.inputChunks[Math.min(chunk.index, Math.max(0, plan.inputChunks.length - 1))]?.charCount || 0,
          ...(requestId ? { requestId } : {}),
        })}\n\n`));
      },
    });

    controller.enqueue(encoder.encode(`data: ${JSON.stringify({
      type: 'done',
      totalChunks: result.responseChunkCount,
      engine,
      ...(requestId ? { requestId } : {}),
    })}\n\n`));
    logStudioTransportPlan('result', plan, engine, {
      timeToFirstAudioMs: result.timeToFirstAudioMs,
      responseChunkCount: result.responseChunkCount,
      totalBytes: result.totalBytes,
    });
    return;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Bidi stream failed.';
    if (emittedChunkCount <= 0) {
      const fallbackPlan: StudioTtsTransportPlan = {
        ...plan,
        mode: 'sync-fallback',
        reason: 'bidi-error',
        canUseBidi: false,
      };
      logStudioTransportPlan('result', fallbackPlan, engine, {
        fallbackReason: 'bidi-error',
        error: message,
      });
      await streamStudioFallbackSse(body, controller, encoder, fallbackPlan);
      return;
    }

    controller.enqueue(encoder.encode(`data: ${JSON.stringify({
      type: 'error',
      message,
      ...(requestId ? { requestId } : {}),
    })}\n\n`));
  }
};

const streamStudioSpeakerIsolationSse = async (
  body: ReaderStudioSynthesizeRequest,
  controller: ReadableStreamDefaultController<Uint8Array>,
  encoder: TextEncoder,
  plan: StudioTtsTransportPlan,
): Promise<void> => {
  const requestId = String(body.requestId || '').trim() || undefined;
  const engine = normalizeStudioEngine(body.engine);
  const speakerConfigs = toSpeakerConfigs(body.speakerConfigs);

  if (speakerConfigs.length <= 0) {
    controller.enqueue(encoder.encode(`data: ${JSON.stringify({
      type: 'error',
      message: 'speakerConfigs are required for speaker-isolation stream requests.',
      ...(requestId ? { requestId } : {}),
    })}\n\n`));
    return;
  }

  const result = await synthesizeSpeakerIsolationWav({
    text: body.text,
    requestId,
    voice: body.voice,
    language: body.language,
    engine,
    speed: body.speed,
    pitch: body.pitch,
    speakerConfigs,
  });

  controller.enqueue(encoder.encode(`data: ${JSON.stringify({
    type: 'chunk',
    index: 0,
    total: 1,
    audioBase64: result.audioContent.toString('base64'),
    contentType: result.contentType,
    engine,
    lineCount: result.lineCount,
    speakerCount: result.speakerCount,
    ...(requestId ? { requestId } : {}),
  })}\n\n`));

  controller.enqueue(encoder.encode(`data: ${JSON.stringify({
    type: 'done',
    totalChunks: 1,
    engine,
    ...(requestId ? { requestId } : {}),
  })}\n\n`));

  logStudioTransportPlan('result', plan, engine, {
    speakerCount: result.speakerCount,
    lineCount: result.lineCount,
    providerCalls: result.diagnostics.providerCalls,
    providerRetries: result.diagnostics.providerRetries,
    segmentFallbacks: result.diagnostics.segmentFallbacks,
    silenceCutCount: result.diagnostics.silenceCutCount,
  });
};

export const handleModernizeRoute = async (request: Request): Promise<Response> => {
  try {
    const body = parseModernizeRequest(await parseJsonBody<ReaderModernizeRequest>(request));
    if (!body) {
      return errorResponse(400, 'text and targetLanguage are required.');
    }
    const result = await modernizeReaderText(body);
    return json({ translatedText: result.translatedText });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Translation failed.';
    return errorResponse(500, message);
  }
};

export const handleStudioSynthesizeRoute = async (request: Request): Promise<Response> => {
  try {
    const uid = await verifyFirebaseRequest(request);
    const body = normalizeStudioRequest(await parseJsonBody<ReaderStudioSynthesizeRequest>(request));
    if (!body) {
      return errorResponse(400, 'text is required.');
    }
    if (!shouldBypassStudioQuotaLimit(uid)) {
      const limit = consumeUniversalTtsRateLimit(uid);
      if (!limit.allowed) {
        return buildUniversalTtsRateLimitResponse(limit.retryAfterSeconds);
      }
    }
    const engine = normalizeStudioEngine(body.engine);
    const plan = planStudioTransport(body);
    logStudioTransportPlan('plan', plan, engine);
    if (plan.mode === 'speaker-isolation') {
      return await synthesizeStudioAudioSpeakerIsolation(body, plan, MAX_STUDIO_TEXT_LENGTH);
    }
    if (!plan.canUseBidi) {
      return await synthesizeStudioAudioFallback(body, 'mp3', plan);
    }

    try {
      return await synthesizeStudioAudioBidi(body, plan);
    } catch (error) {
      const fallbackPlan: StudioTtsTransportPlan = {
        ...plan,
        mode: 'sync-fallback',
        reason: 'bidi-error',
        canUseBidi: false,
      };
      logStudioTransportPlan('result', fallbackPlan, engine, {
        fallbackReason: 'bidi-error',
        error: error instanceof Error ? error.message : String(error),
      });
      return await synthesizeStudioAudioFallback(body, 'mp3', fallbackPlan);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Studio synthesis failed.';
    return errorResponse(isUnauthorizedStudioRequestError(error) ? 401 : 500, message);
  }
};

export const handleStudioLongTextRoute = async (request: Request): Promise<Response> => {
  try {
    const uid = await verifyFirebaseRequest(request);
    if (!isCloudTtsConfigured()) {
      return errorResponse(503, 'Cloud TTS service is not configured.');
    }
    const body = normalizeStudioLongTextRequest(await parseJsonBody<ReaderStudioSynthesizeRequest>(request));
    if (!body) {
      return errorResponse(400, 'text is required.');
    }
    if (body.text.length > MAX_STUDIO_LONG_TEXT_LENGTH) {
      return errorResponse(400, `text exceeds ${MAX_STUDIO_LONG_TEXT_LENGTH} character limit.`);
    }
    if (!shouldBypassStudioQuotaLimit(uid)) {
      const limit = consumeUniversalTtsRateLimit(uid);
      if (!limit.allowed) {
        return buildUniversalTtsRateLimitResponse(limit.retryAfterSeconds);
      }
    }
    const engine = normalizeStudioEngine(body.engine);
    const plan = planStudioTransport(body);
    logStudioTransportPlan('plan', plan, engine);

    if (plan.mode === 'speaker-isolation') {
      return await synthesizeStudioAudioSpeakerIsolation(body, plan, MAX_STUDIO_LONG_TEXT_LENGTH);
    }

    if (plan.canUseBidi) {
      try {
        const result = await synthesizeBidirectionalToWav({
          text: body.text,
          requestId: body.requestId,
          voice: body.voice,
          language: body.language,
          engine,
          speed: body.speed,
          prompt: STUDIO_BIDI_STREAM_PROMPT,
          inputChunks: plan.inputChunks,
        });
        logStudioTransportPlan('result', plan, engine, {
          timeToFirstAudioMs: result.timeToFirstAudioMs,
          responseChunkCount: result.responseChunkCount,
          totalBytes: result.totalBytes,
        });
        return new Response(result.audioContent, {
          headers: {
            'Content-Type': 'audio/wav',
            'Content-Length': String(result.audioContent.length),
            ...buildStudioTransportHeaders(plan, {
              'x-vf-tts-bidi-response-chunks': result.responseChunkCount,
            }),
          },
        });
      } catch (error) {
        const fallbackPlan: StudioTtsTransportPlan = {
          ...plan,
          mode: 'sync-fallback',
          reason: 'bidi-error',
          canUseBidi: false,
        };
        logStudioTransportPlan('result', fallbackPlan, engine, {
          fallbackReason: 'bidi-error',
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    const fallbackPlan: StudioTtsTransportPlan = plan.canUseBidi
      ? { ...plan, mode: 'sync-fallback', reason: 'bidi-error', canUseBidi: false }
      : plan;
    const chunks = chunkStudioText(sanitizeInput(body.text));
    const audioBuffers: Buffer[] = [];

    for (const chunk of chunks) {
      const response = await synthesizeStudioAudioFallback({ ...body, text: chunk }, 'wav', fallbackPlan);
      if (!response.ok) {
        const payload = await response.json().catch(() => ({ error: 'Long-text synthesis failed.' }));
        return errorResponse(response.status, String((payload as { error?: string }).error || 'Long-text synthesis failed.'));
      }
      const bytes = Buffer.from(await response.arrayBuffer());
      audioBuffers.push(bytes);
    }

    if (audioBuffers.length <= 0) {
      return errorResponse(500, 'No audio generated.');
    }

    const concatenated = audioBuffers.length === 1
      ? audioBuffers[0]!
      : concatenateWavBuffers(audioBuffers);

    return new Response(concatenated, {
      headers: {
        'Content-Type': 'audio/wav',
        'Content-Length': String(concatenated.length),
        ...buildStudioTransportHeaders(fallbackPlan),
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Long-text TTS failed.';
    const status = message.includes('exhausted') ? 429 : 500;
    return errorResponse(status, message);
  }
};

export const handleStudioStreamRoute = async (request: Request): Promise<Response> => {
  try {
    const uid = await verifyFirebaseRequest(request);
    if (!isCloudTtsConfigured()) {
      return errorResponse(503, 'Cloud TTS service is not configured.');
    }
    const body = normalizeStudioLongTextRequest(await parseJsonBody<ReaderStudioSynthesizeRequest>(request));
    if (!body) {
      return errorResponse(400, 'text is required.');
    }
    if (!shouldBypassStudioQuotaLimit(uid)) {
      const limit = consumeUniversalTtsRateLimit(uid);
      if (!limit.allowed) {
        return buildUniversalTtsRateLimitResponse(limit.retryAfterSeconds);
      }
    }

    const engine = parseStudioEngine(body.engine);
    if (!engine || !VALID_ENGINES.has(engine)) {
      return errorResponse(400, 'Invalid engine. Use VECTOR or PRIME.');
    }
    const plan = planStudioTransport(body);
    logStudioTransportPlan('plan', plan, engine);
    const encoder = new TextEncoder();

    const stream = new ReadableStream({
      async start(controller) {
        try {
          if (plan.mode === 'speaker-isolation') {
            await streamStudioSpeakerIsolationSse(body, controller, encoder, plan);
          } else if (plan.canUseBidi) {
            await streamStudioBidiSse(body, controller, encoder, plan);
          } else {
            await streamStudioFallbackSse(body, controller, encoder, plan);
          }
          controller.close();
        } catch (streamError) {
          const message = streamError instanceof Error ? streamError.message : 'Stream failed.';
          const requestId = String(body.requestId || '').trim() || undefined;
          try {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({
              type: 'error',
              message,
              ...(requestId ? { requestId } : {}),
            })}\n\n`));
            controller.close();
          } catch {
            // Ignore double-close failures.
          }
        }
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        ...buildStudioTransportHeaders(plan),
        'Cache-Control': 'no-cache, no-store',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'TTS stream failed.';
    return errorResponse(isUnauthorizedStudioRequestError(error) ? 401 : 500, message);
  }
};

export const handleStudioEngineStatusRoute = async (request: Request): Promise<Response> => {
  try {
    await verifyAuthedStudioRequest(request);
    const requestUrl = new URL(request.url);
    const requestedEngine = String(requestUrl.searchParams.get('engine') || 'all').trim().toUpperCase();
    const engines: Record<string, unknown> = {
      VECTOR: buildNativeStudioEngineStatus(request, 'VECTOR'),
      PRIME: buildNativeStudioEngineStatus(request, 'PRIME'),
    };
    if (requestedEngine === 'VECTOR' || requestedEngine === 'PRIME') {
      return json({
        ok: true,
        requestedEngine,
        engines: { [requestedEngine]: engines[requestedEngine] },
        fetchedAt: nowIso(),
        generatedAtMs: Date.now(),
      });
    }
    return json({
      ok: true,
      requestedEngine: 'all',
      engines,
      fetchedAt: nowIso(),
      generatedAtMs: Date.now(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Runtime status unavailable.';
    const status = message.toLowerCase().includes('missing authorization') ? 401 : 500;
    return errorResponse(status, message);
  }
};

export const handleStudioEngineActivateRoute = async (request: Request): Promise<Response> => {
  try {
    await verifyAuthedStudioRequest(request);
    const body = await parseJsonBody<{ engine?: string }>(request);
    const engine = normalizeStudioEngine(body?.engine);
    const configured = isCloudTtsConfigured();
    return json({
      ok: true,
      engine,
      runtimeLabel: getRuntimeLabelForEngine(engine),
      storagePolicy: 'ephemeral',
      state: configured ? 'online' : 'not_configured',
      detail: configured
        ? 'Native studio TTS is active without a separate runtime warmup.'
        : 'Cloud TTS service is not configured.',
      healthUrl: buildNativeStudioEngineHealthUrl(request, engine),
      gpuMode: false,
      commandOutput: configured ? 'native_studio_noop' : 'native_studio_unconfigured',
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Runtime activation failed.';
    const status = message.toLowerCase().includes('missing authorization') ? 401 : 500;
    return errorResponse(status, message);
  }
};

export const handleNovelJobCreateRoute = handleAudioNovelJobCreateRoute;

export const handleNovelJobStatusRoute = handleAudioNovelJobStatusRoute;

export const handleStudioExportDriveRoute = async (request: Request): Promise<Response> => {
  try {
    await verifyFirebaseRequest(request);

    let payload: ReaderStudioExportDriveRequest | null = null;
    const contentType = String(request.headers.get('content-type') || '').toLowerCase();
    if (contentType.includes('multipart/form-data')) {
      const formData = await request.formData();
      const file = formData.get('file');
      const googleAccessToken = String(formData.get('googleAccessToken') || '').trim();
      const fileName = String(formData.get('fileName') || '').trim();
      if (!(file instanceof File) || !googleAccessToken) {
        return errorResponse(400, 'file and googleAccessToken are required.');
      }
      const bytes = Buffer.from(await file.arrayBuffer());
      payload = {
        fileName: fileName || file.name,
        mimeType: file.type || 'audio/mpeg',
        googleAccessToken,
        audioBase64: bytes.toString('base64'),
      };
    } else {
      const body = await parseJsonBody<ReaderStudioExportDriveRequest>(request);
      if (!body) {
        return errorResponse(400, 'Invalid request body.');
      }
      payload = {
        fileName: body.fileName,
        mimeType: body.mimeType,
        googleAccessToken: String(body.googleAccessToken || '').trim(),
        audioBase64: String(body.audioBase64 || '').trim(),
      };
    }

    if (!payload.googleAccessToken || !payload.audioBase64) {
      return errorResponse(400, 'googleAccessToken and audio are required.');
    }

    const result = await uploadStudioAudioToDrive(payload);
    return json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Drive export failed.';
    const status = message.toLowerCase().includes('missing firebase bearer token') ? 401 : 500;
    return errorResponse(status, message);
  }
};

export const studioInternals = {
  DEFAULT_TTS_MODEL,
  DEFAULT_READER_STYLE,
  buildModernizeChunkWindows,
  chunkStudioText,
  modernizeReaderText,
};
