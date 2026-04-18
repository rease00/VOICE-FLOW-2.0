import { createHash } from 'node:crypto';

import { verifyFirebaseRequest } from '../auth/requestAuth.ts';
import { getFirebaseAdminFirestore } from '../firebaseAdmin.ts';
import {
  createDomainJobRecord,
  createDomainJobRecordIfAbsent,
  getDomainJobRecord,
  saveDomainJobRecord,
  type DomainJobRecord,
} from '../jobs/domainJobStore.ts';
import { compressToRuns } from './compress.ts';
import type {
  AudioNovelChapterAudioResponse,
  AudioNovelDialogueLine,
  AudioNovelJobRequest,
  AudioNovelJobResponse,
  AudioNovelRunSyncEntry,
  AudioNovelSpeakerRun,
} from './contracts.ts';
import { parseDialogue, sanitizeText, validateInput } from './input.ts';
import { getAudioNovelSignedUrl, headAudioNovelObject, readAudioNovelObject, writeAudioNovelObject } from './storage.ts';
import { getAudioNovelSilenceBuffer, streamAudioNovelBidi, synthesizeAudioNovelRun } from './synthesizer.ts';
import {
  buildUniversalTtsRateLimitResponse,
  consumeUniversalTtsRateLimit,
} from '../tts/userRateLimit.ts';
import { resolveVoice, resolveVoiceSync } from './voice.ts';
import { getRuntimeLabelForEngine } from '../tts/runtimePolicy.ts';

const AUDIO_NOVEL_DOMAIN = 'audioNovel';
const AUDIO_NOVEL_JOB_PREFIX = 'audio-novel';
const AUDIO_NOVEL_SIGNED_URL_TTL_SECONDS = 10_800;
const AUDIO_NOVEL_ENGINE = 'VECTOR' as const;
const AUDIO_NOVEL_RUNTIME_LABEL = getRuntimeLabelForEngine(AUDIO_NOVEL_ENGINE);
const AUDIO_NOVEL_HTTP_ONLY_ERROR = {
  error: 'Use a WebSocket upgrade for live audio novel playback.',
  code: 'UPGRADE_REQUIRED',
};

const AUDIO_NOVEL_UNAUTHORIZED_ERROR = {
  error: 'Unauthorized',
  code: 'UNAUTHORIZED',
};

const activeJobPromises = new Map<string, Promise<void>>();

const getDb = () => {
  try {
    return getFirebaseAdminFirestore();
  } catch {
    return null;
  }
};

const sanitizeOptional = (value: unknown): string | undefined => {
  const safe = String(value || '').trim();
  return safe || undefined;
};

const authorizeAudioNovelRequest = async (request: Request): Promise<{ uid: string } | Response> => {
  try {
    const decoded = await verifyFirebaseRequest(request);
    return { uid: String(decoded.uid || '').trim() };
  } catch {
    return Response.json(AUDIO_NOVEL_UNAUTHORIZED_ERROR, { status: 401 });
  }
};

const normalizeJobRequest = (body: unknown): AudioNovelJobRequest | null => {
  if (!body || typeof body !== 'object') return null;
  const payload = body as Record<string, unknown>;
  const bookId = String(payload.bookId || '').trim();
  const text = String(payload.text || '').trim();
  if (!bookId || !text) {
    return null;
  }

  return {
    mode: 'novel',
    bookId,
    ...(sanitizeOptional(payload.chapterId) ? { chapterId: sanitizeOptional(payload.chapterId) } : {}),
    text,
    ...(sanitizeOptional(payload.language) ? { language: sanitizeOptional(payload.language) } : {}),
    ...(sanitizeOptional(payload.targetLanguage) ? { targetLanguage: sanitizeOptional(payload.targetLanguage) } : {}),
    ...(sanitizeOptional(payload.voice) ? { voice: sanitizeOptional(payload.voice) } : {}),
    ...(sanitizeOptional(payload.engine) ? { engine: sanitizeOptional(payload.engine) } : {}),
    ...(sanitizeOptional(payload.style) ? { style: sanitizeOptional(payload.style) } : {}),
    ...(Number.isFinite(Number(payload.speed)) ? { speed: Number(payload.speed) } : {}),
    ...(Number.isFinite(Number(payload.pitch)) ? { pitch: Number(payload.pitch) } : {}),
    ...(Array.isArray(payload.speakerConfigs)
      ? {
          speakerConfigs: payload.speakerConfigs
            .map((item) => {
              if (!item || typeof item !== 'object') return null;
              const speaker = String((item as Record<string, unknown>).speaker || '').trim();
              const voice = String((item as Record<string, unknown>).voice || '').trim();
              if (!speaker || !voice) return null;
              return { speaker, voice };
            })
            .filter((item): item is { speaker: string; voice: string } => Boolean(item)),
        }
      : {}),
  };
};

const buildContentHash = (text: string): string => {
  return createHash('md5').update(String(text || '')).digest('hex');
};

const buildJobId = (request: AudioNovelJobRequest): string => {
  const fingerprint = createHash('sha256')
    .update([
      request.bookId,
      request.chapterId || '',
      request.targetLanguage || '',
      request.voice || '',
      request.text,
    ].join('|'))
    .digest('hex');
  return `${AUDIO_NOVEL_JOB_PREFIX}_${fingerprint.slice(0, 24)}`;
};

const buildAudioKey = (bookId: string, chapterId: string, hash: string): string => `audio/${bookId}/${chapterId}/${hash}.mp3`;
const buildSyncKey = (bookId: string, chapterId: string, hash: string): string => `audio/${bookId}/${chapterId}/${hash}.sync.json`;

const buildSyncMap = (runs: AudioNovelSpeakerRun[], buffers: Buffer[]): AudioNovelRunSyncEntry[] => {
  const syncEntries: AudioNovelRunSyncEntry[] = [];
  let byteOffset = 0;
  for (let index = 0; index < runs.length; index += 1) {
    const run = runs[index];
    const buffer = buffers[index];
    if (!run || !buffer || buffer.length <= 0) continue;
    syncEntries.push({
      runIndex: index,
      speaker: run.speaker,
      voice: run.voice,
      emotion: run.emotion,
      lines: [...run.rawLines],
      firstLine: run.firstLine,
      lastLine: run.lastLine,
      startByte: byteOffset,
      endByte: byteOffset + buffer.length,
    });
    byteOffset += buffer.length;
  }
  return syncEntries;
};

const getLegacyChapterRef = (chapterId: string) => {
  const db = getDb();
  return db ? db.collection('publishedChapters').doc(chapterId) : null;
};

const getCanonicalChapterRef = (bookId: string, chapterId: string) => {
  const db = getDb();
  return db ? db.collection('publishedBooks').doc(bookId).collection('chapters').doc(chapterId) : null;
};

const readChapterRecord = async (
  bookId: string,
  chapterId: string,
): Promise<Record<string, unknown> | null> => {
  const canonical = getCanonicalChapterRef(bookId, chapterId);
  if (canonical) {
    const snapshot = await canonical.get();
    if (snapshot.exists) {
      return snapshot.data() as Record<string, unknown>;
    }
  }

  const legacy = getLegacyChapterRef(chapterId);
  if (legacy) {
    const snapshot = await legacy.get();
    if (snapshot.exists) {
      return snapshot.data() as Record<string, unknown>;
    }
  }

  return null;
};

const updateChapterAudioMetadata = async (
  bookId: string,
  chapterId: string,
  payload: {
    audioKey: string;
    syncKey: string;
    audioHash: string;
    generatedAt: string;
  },
): Promise<void> => {
  const canonical = getCanonicalChapterRef(bookId, chapterId);
  const legacy = getLegacyChapterRef(chapterId);
  await Promise.all([
    canonical?.set(payload, { merge: true }),
    legacy?.set(payload, { merge: true }),
  ]);
};

const resolveChapterLines = async (
  bookId: string,
  text: string,
): Promise<AudioNovelDialogueLine[]> => {
  const clean = sanitizeText(text);
  const validation = validateInput(clean);
  if (!validation.ok) {
    throw new Error(validation.code || 'INVALID_INPUT');
  }

  const parsed = parseDialogue(clean);
  if (parsed.length === 0) {
    throw new Error('EMPTY');
  }

  // Warm the cast cache before compression.
  const uniqueSpeakers = [...new Set(parsed.map((line) => line.speaker))];
  await Promise.all(uniqueSpeakers.map((speaker) => resolveVoice(speaker, bookId).catch(() => resolveVoiceSync(speaker))));
  return parsed;
};

const generatePublishedChapterAudio = async (
  request: AudioNovelJobRequest,
): Promise<AudioNovelChapterAudioResponse> => {
  if (!request.chapterId) {
    throw new Error('chapterId is required for published chapter generation.');
  }

  const hash = buildContentHash(request.text);
  const audioKey = buildAudioKey(request.bookId, request.chapterId, hash);
  const syncKey = buildSyncKey(request.bookId, request.chapterId, hash);
  const existing = await headAudioNovelObject(audioKey);
  if (existing) {
    const syncEntries = await resolveSyncEntries(syncKey);
    return {
      generated: true,
      audioUrl: await getAudioNovelSignedUrl(audioKey, AUDIO_NOVEL_SIGNED_URL_TTL_SECONDS),
      syncUrl: await getAudioNovelSignedUrl(syncKey, AUDIO_NOVEL_SIGNED_URL_TTL_SECONDS),
      source: 'r2',
      cacheStatus: 'hit',
      storage: 'r2',
      engine: AUDIO_NOVEL_ENGINE,
      runtimeLabel: AUDIO_NOVEL_RUNTIME_LABEL,
      persisted: true,
      hash,
      totalRuns: syncEntries.length,
      speakers: [...new Set(syncEntries.map((entry) => entry.speaker))],
    };
  }

  const lines = await resolveChapterLines(request.bookId, request.text);
  const runs = await Promise.all(
    compressToRuns(lines, (speaker) => resolveVoiceSync(speaker)).map(async (run) => ({
      ...run,
      voice: await resolveVoice(run.speaker, request.bookId),
    })),
  );

  const buffers: Buffer[] = [];
  for (const run of runs) {
    const audio = await synthesizeAudioNovelRun(run, 'MP3', 5);
    buffers.push(audio);
  }

  const stitched = Buffer.concat(buffers.filter((buffer) => buffer.length > 0));
  if (stitched.length < 1_000) {
    throw new Error('GENERATION_FAILED');
  }

  const syncEntries = buildSyncMap(runs, buffers);
  const generatedAt = new Date().toISOString();
  await writeAudioNovelObject(audioKey, stitched, 'audio/mpeg');
  await writeAudioNovelObject(syncKey, JSON.stringify(syncEntries), 'application/json; charset=utf-8');
  await updateChapterAudioMetadata(request.bookId, request.chapterId, {
    audioKey,
    syncKey,
    audioHash: hash,
    generatedAt,
  });

  return {
    generated: true,
    audioUrl: await getAudioNovelSignedUrl(audioKey, AUDIO_NOVEL_SIGNED_URL_TTL_SECONDS),
    syncUrl: await getAudioNovelSignedUrl(syncKey, AUDIO_NOVEL_SIGNED_URL_TTL_SECONDS),
    source: 'generated',
    cacheStatus: 'generated',
    storage: 'r2',
    engine: AUDIO_NOVEL_ENGINE,
    runtimeLabel: AUDIO_NOVEL_RUNTIME_LABEL,
    persisted: true,
    hash,
    totalRuns: syncEntries.length,
    speakers: [...new Set(syncEntries.map((entry) => entry.speaker))],
  };
};

const resolveSyncEntries = async (syncKey: string): Promise<AudioNovelRunSyncEntry[]> => {
  const record = await readAudioNovelObject(syncKey);
  if (!record?.body) return [];
  try {
    const payload = JSON.parse(record.body.toString('utf8')) as AudioNovelRunSyncEntry[];
    return Array.isArray(payload) ? payload : [];
  } catch {
    return [];
  }
};

const processJob = async (jobId: string, request: AudioNovelJobRequest): Promise<void> => {
  const existing = await getDomainJobRecord(jobId);
  const baseRecord = existing || createDomainJobRecord<Record<string, unknown>>({
    id: jobId,
    domain: AUDIO_NOVEL_DOMAIN,
    payload: request as unknown as Record<string, unknown>,
  });

  await saveDomainJobRecord({
    ...baseRecord,
    status: 'running',
    startedAt: baseRecord.startedAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    error: undefined,
  });

  try {
    const result = await generatePublishedChapterAudio(request);
    await saveDomainJobRecord({
      ...baseRecord,
      status: 'completed',
      result: result as unknown as Record<string, unknown>,
      completedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      error: undefined,
    });
  } catch (error) {
    await saveDomainJobRecord({
      ...baseRecord,
      status: 'failed',
      error: error instanceof Error ? error.message : String(error),
      updatedAt: new Date().toISOString(),
    });
  }
};

const kickOffJob = (jobId: string, request: AudioNovelJobRequest): void => {
  if (activeJobPromises.has(jobId)) return;
  const promise = processJob(jobId, request).finally(() => {
    activeJobPromises.delete(jobId);
  });
  activeJobPromises.set(jobId, promise);
};

const toJobResponse = (record: DomainJobRecord | null, jobId: string): AudioNovelJobResponse => {
  const result = record?.result as unknown as AudioNovelChapterAudioResponse | undefined;
  return {
    jobId,
    status: record?.status || 'queued',
    cacheHit: result?.generated === true && result.source === 'r2',
    ...(result ? { result } : {}),
    ...(record?.error ? { error: record.error } : {}),
  };
};

export const getPublishedChapterAudioResponse = async (
  bookId: string,
  chapterId: string,
  inputText?: string,
): Promise<AudioNovelChapterAudioResponse> => {
  const chapter = await readChapterRecord(bookId, chapterId);
  if (!chapter) {
    throw new Error('Chapter not found');
  }

  const text = String(inputText || chapter.text || '').trim();
  if (!text) {
    throw new Error('Chapter text is required to retrieve audio.');
  }

  const hash = buildContentHash(text);
  const audioKey = String(chapter.audioKey || buildAudioKey(bookId, chapterId, hash)).trim();
  const syncKey = String(chapter.syncKey || buildSyncKey(bookId, chapterId, hash)).trim();
  const exists = await headAudioNovelObject(audioKey);
  if (!exists) {
    return {
      generated: false,
      source: 'missing',
      cacheStatus: 'missing',
      storage: 'r2',
      engine: AUDIO_NOVEL_ENGINE,
      runtimeLabel: AUDIO_NOVEL_RUNTIME_LABEL,
      persisted: false,
      hash,
      reason: 'not-generated',
    };
  }

  const syncEntries = await resolveSyncEntries(syncKey);
  return {
    generated: true,
    audioUrl: await getAudioNovelSignedUrl(audioKey, AUDIO_NOVEL_SIGNED_URL_TTL_SECONDS),
    syncUrl: await getAudioNovelSignedUrl(syncKey, AUDIO_NOVEL_SIGNED_URL_TTL_SECONDS),
    source: 'r2',
    cacheStatus: 'hit',
    storage: 'r2',
    engine: AUDIO_NOVEL_ENGINE,
    runtimeLabel: AUDIO_NOVEL_RUNTIME_LABEL,
    persisted: true,
    hash,
    totalRuns: syncEntries.length,
    speakers: [...new Set(syncEntries.map((entry) => entry.speaker))],
  };
};

export const handleAudioNovelJobCreateRoute = async (request: Request): Promise<Response> => {
  const auth = await authorizeAudioNovelRequest(request);
  if (auth instanceof Response) return auth;

  const body = await request.json().catch(() => null);
  const normalized = normalizeJobRequest(body);
  if (!normalized) {
    return Response.json({ error: 'Invalid audio novel request.' }, { status: 400 });
  }
  const limit = consumeUniversalTtsRateLimit(auth.uid);
  if (!limit.allowed) {
    return buildUniversalTtsRateLimitResponse(limit.retryAfterSeconds);
  }

  const jobId = buildJobId(normalized);
  const initialRecord = createDomainJobRecord<Record<string, unknown>>({
    id: jobId,
    domain: AUDIO_NOVEL_DOMAIN,
    ownerUid: auth.uid,
    payload: normalized as unknown as Record<string, unknown>,
  });
  const { record, created } = await createDomainJobRecordIfAbsent(initialRecord);
  if (!created) {
    if (record.status === 'queued' || record.status === 'running') {
      kickOffJob(jobId, normalized);
    }
    return Response.json(toJobResponse(record, jobId));
  }

  kickOffJob(jobId, normalized);
  return Response.json({
    jobId,
    status: 'queued',
    cacheHit: false,
  } satisfies AudioNovelJobResponse);
};

export const handleAudioNovelJobStatusRoute = async (request: Request, jobId: string): Promise<Response> => {
  const auth = await authorizeAudioNovelRequest(request);
  if (auth instanceof Response) return auth;

  const record = await getDomainJobRecord(jobId);
  if (!record || record.domain !== AUDIO_NOVEL_DOMAIN) {
    return Response.json({ error: 'Audio novel job not found.' }, { status: 404 });
  }
  return Response.json(toJobResponse(record, jobId));
};

export const handleLibraryBookChapterAudioRoute = async (
  request: Request,
  bookId: string,
  chapterId: string,
): Promise<Response> => {
  const auth = await authorizeAudioNovelRequest(request);
  if (auth instanceof Response) return auth;

  try {
    const result = await getPublishedChapterAudioResponse(bookId, chapterId);
    return Response.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to load chapter audio.';
    const status = message === 'Chapter not found' ? 404 : 500;
    return Response.json({ error: message }, { status });
  }
};

export const handleAudioNovelWebSocketHttpRequest = async (): Promise<Response> => {
  return Response.json(AUDIO_NOVEL_HTTP_ONLY_ERROR, { status: 426 });
};

export const streamAudioNovelLive = async (
  uid: string,
  text: string,
  bookId: string | undefined,
  bookSource: string | undefined,
  send: (payload: Buffer | Record<string, unknown>) => void,
): Promise<void> => {
  const clean = sanitizeText(text);
  const validation = validateInput(clean);
  if (!validation.ok) {
    send({ error: validation.code || 'INVALID_INPUT' });
    return;
  }
  const limit = consumeUniversalTtsRateLimit(uid);
  if (!limit.allowed) {
    send({
      error: 'TTS is limited to 10 requests per minute per user.',
      code: 'TTS_RPM_LIMIT',
      retryAfterSeconds: limit.retryAfterSeconds,
      limit: limit.limit,
    });
    return;
  }

  const lines = parseDialogue(clean);
  const shouldUseBookCast = String(bookSource || '').trim().toLowerCase() === 'published';
  const baseRuns = compressToRuns(lines, (speaker) => resolveVoiceSync(speaker));
  const runs = shouldUseBookCast
    ? await Promise.all(
        baseRuns.map(async (run) => ({
          ...run,
          voice: await resolveVoice(run.speaker, bookId),
        })),
      )
    : baseRuns;

  const uniqueVoices = [...new Set(runs.map((run) => run.voice).filter(Boolean))];
  const canUseBidi = uniqueVoices.length === 1 && runs.length > 0;

  send({
    status: 'start',
    totalRuns: canUseBidi ? 1 : runs.length,
    totalLines: lines.length,
    mode: lines.some((line) => line.speaker !== 'Narrator') ? 'multi' : 'single',
    transport: canUseBidi ? 'bidi' : 'run',
  });

  const startedAt = Date.now();
  if (canUseBidi) {
    let emittedBidiAudio = false;
    try {
      await streamAudioNovelBidi(runs, (buffer) => {
        if (buffer.length > getAudioNovelSilenceBuffer().length) {
          emittedBidiAudio = true;
          send(buffer);
        }
      });

      send({
        done: true,
        totalRuns: 1,
        durationMs: Date.now() - startedAt,
      });
      return;
    } catch (error) {
      if (emittedBidiAudio) {
        send({
          error: 'Live audio stream was interrupted before completion. Please retry.',
          code: 'BIDI_STREAM_INTERRUPTED',
          partial: true,
          durationMs: Date.now() - startedAt,
        });
        return;
      }
      send({
        status: 'buffering',
        waitMs: 0,
        reason: error instanceof Error ? error.message : 'Bidi stream unavailable, retrying with run fallback.',
      } as Record<string, unknown>);
    }
  }

  for (const run of runs) {
    const audio = await synthesizeAudioNovelRun(run, 'LINEAR16', 4);
    send({
      type: 'run-meta',
      runIndex: run.runIndex,
      total: runs.length,
      speaker: run.speaker,
      voice: run.voice,
      emotion: run.emotion,
      lines: run.rawLines,
      firstLine: run.firstLine,
      lastLine: run.lastLine,
    });
    if (audio.length > getAudioNovelSilenceBuffer().length) {
      send(audio);
    }
  }

  send({
    done: true,
    totalRuns: runs.length,
    durationMs: Date.now() - startedAt,
  });
};
