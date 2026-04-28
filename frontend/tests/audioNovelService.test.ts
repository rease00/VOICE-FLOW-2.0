import { afterEach, describe, expect, it, vi } from 'vitest';

const jobRecordStore = vi.hoisted(() => new Map<string, any>());
const getDomainJobRecordMock = vi.hoisted(() => vi.fn());
const getFirebaseAdminFirestoreMock = vi.hoisted(() => vi.fn());
const headAudioNovelObjectMock = vi.hoisted(() => vi.fn());
const getAudioNovelSignedUrlMock = vi.hoisted(() => vi.fn(async (key: string) => `https://signed.example/${key}`));
const readAudioNovelObjectMock = vi.hoisted(() => vi.fn());
const streamAudioNovelBidiMock = vi.hoisted(() => vi.fn());
const synthesizeAudioNovelRunMock = vi.hoisted(() => vi.fn(async () => Buffer.alloc(1200, 7)));
const verifyFirebaseRequestMock = vi.hoisted(() => vi.fn(async () => ({ uid: 'user-1' })));
const saveDomainJobRecordMock = vi.hoisted(() => vi.fn(async (record: any) => {
  jobRecordStore.set(record.id, record);
  return record;
}));
const createDomainJobRecordIfAbsentMock = vi.hoisted(() => vi.fn(async (record: any) => {
  const existing = jobRecordStore.get(record.id);
  if (existing) {
    return { record: existing, created: false };
  }
  jobRecordStore.set(record.id, record);
  return { record, created: true };
}));

vi.mock('../src/server/jobs/domainJobStore.ts', () => ({
  createDomainJobRecord: vi.fn(),
  createDomainJobRecordIfAbsent: createDomainJobRecordIfAbsentMock,
  getDomainJobRecord: getDomainJobRecordMock,
  saveDomainJobRecord: saveDomainJobRecordMock,
}));

vi.mock('../src/server/firebaseAdmin.ts', () => ({
  getFirebaseAdminFirestore: getFirebaseAdminFirestoreMock,
}));

vi.mock('../src/server/auth/requestAuth.ts', () => ({
  verifyFirebaseRequest: verifyFirebaseRequestMock,
}));

vi.mock('../src/server/audioNovel/storage.ts', () => ({
  getAudioNovelSignedUrl: getAudioNovelSignedUrlMock,
  headAudioNovelObject: headAudioNovelObjectMock,
  readAudioNovelObject: readAudioNovelObjectMock,
  writeAudioNovelObject: vi.fn(),
}));

vi.mock('../src/server/audioNovel/compress.ts', () => ({
  compressToRuns: vi.fn((lines: Array<{ speaker: string; text: string; index: number }>) => lines.length > 0
    ? [{
        runIndex: 0,
        speaker: lines[0]?.speaker || 'Narrator',
        voice: 'Kore',
        emotion: 'narration',
        mergedText: lines.map((line) => line.text).join(' '),
        rawLines: lines.map((line) => line.text),
        lineIndices: lines.map((line) => line.index),
        firstLine: lines[0]?.index || 0,
        lastLine: lines[lines.length - 1]?.index || 0,
        charCount: lines.map((line) => line.text).join(' ').length,
      }]
    : []),
}));

vi.mock('../src/server/audioNovel/voice.ts', () => ({
  resolveVoice: vi.fn(async () => 'Kore'),
  resolveVoiceSync: vi.fn(() => 'Kore'),
}));

vi.mock('../src/server/audioNovel/synthesizer.ts', () => ({
  getAudioNovelSilenceBuffer: () => Buffer.alloc(480),
  streamAudioNovelBidi: streamAudioNovelBidiMock,
  synthesizeAudioNovelRun: synthesizeAudioNovelRunMock,
}));

describe('audio novel backend contracts', () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    verifyFirebaseRequestMock.mockResolvedValue({ uid: 'user-1' });
    jobRecordStore.clear();
  });

  it('only marks queued job cacheHit when the stored result came from R2 cache', async () => {
    getDomainJobRecordMock.mockResolvedValueOnce({
      id: 'job-generated',
      domain: 'audioNovel',
      status: 'completed',
      result: {
        generated: true,
        source: 'generated',
        cacheStatus: 'generated',
      },
    });

    const { handleAudioNovelJobStatusRoute } = await import('../src/server/audioNovel/service');
    const generatedResponse = await handleAudioNovelJobStatusRoute(new Request('http://localhost/audio-novel/jobs/job-generated'), 'job-generated');
    await expect(generatedResponse.json()).resolves.toMatchObject({
      jobId: 'job-generated',
      cacheHit: false,
      result: {
        source: 'generated',
      },
    });

    getDomainJobRecordMock.mockResolvedValueOnce({
      id: 'job-cached',
      domain: 'audioNovel',
      status: 'completed',
      result: {
        generated: true,
        source: 'r2',
        cacheStatus: 'hit',
      },
    });

    const cachedResponse = await handleAudioNovelJobStatusRoute(new Request('http://localhost/audio-novel/jobs/job-cached'), 'job-cached');
    await expect(cachedResponse.json()).resolves.toMatchObject({
      jobId: 'job-cached',
      cacheHit: true,
      result: {
        source: 'r2',
      },
    });
  });

  it('returns normalized published chapter cache metadata for R2 hits', async () => {
    const chapterData = {
      text: 'Narrator: Hello there.',
      audioKey: 'audio/book-1/ch-1/hash.mp3',
      syncKey: 'audio/book-1/ch-1/hash.sync.json',
    };
    const docSnapshot = {
      exists: true,
      data: () => chapterData,
    };
    const docRef = {
      get: vi.fn(async () => docSnapshot),
      collection: vi.fn(),
      doc: vi.fn(),
    };
    const firestore = {
      collection: vi.fn((name: string) => {
        if (name === 'publishedBooks') {
          return {
            doc: vi.fn(() => ({
              collection: vi.fn(() => ({
                doc: vi.fn(() => docRef),
              })),
            })),
          };
        }
        if (name === 'publishedChapters') {
          return {
            doc: vi.fn(() => ({ get: vi.fn(async () => ({ exists: false })) })),
          };
        }
        throw new Error(`Unexpected collection: ${name}`);
      }),
    };
    getFirebaseAdminFirestoreMock.mockReturnValue(firestore);
    headAudioNovelObjectMock.mockResolvedValue(true);
    readAudioNovelObjectMock.mockResolvedValue({
      body: Buffer.from(JSON.stringify([{ speaker: 'Narrator' }])),
      contentType: 'application/json',
    });

    const { getPublishedChapterAudioResponse } = await import('../src/server/audioNovel/service');
    await expect(getPublishedChapterAudioResponse('book-1', 'ch-1')).resolves.toMatchObject({
      generated: true,
      source: 'r2',
      cacheStatus: 'hit',
      storage: 'r2',
      engine: 'VECTOR',
      runtimeLabel: 'Vector Runtime',
      persisted: true,
      totalRuns: 1,
      speakers: ['Narrator'],
    });
  });

  it('rejects anonymous audio novel routes before returning chapter audio', async () => {
    verifyFirebaseRequestMock.mockRejectedValueOnce(new Error('Missing authorization'));

    const { handleLibraryBookChapterAudioRoute } = await import('../src/server/audioNovel/service');
    const response = await handleLibraryBookChapterAudioRoute(
      new Request('http://localhost/api/v1/library/books/book-1/chapters/ch-1/audio'),
      'book-1',
      'ch-1',
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      error: 'Unauthorized',
      code: 'UNAUTHORIZED',
    });
  });

  it('finishes a queued job on status polling when background processing has not caught up yet', async () => {
    const queuedRecord = {
      id: 'audio-novel_queued',
      domain: 'audioNovel',
      status: 'queued',
      ownerUid: 'user-1',
      payload: {
        mode: 'novel',
        bookId: 'book-1',
        chapterId: 'ch-1',
        text: 'Narrator: Hello there.',
      },
      createdAt: new Date('2026-04-28T00:00:00.000Z').toISOString(),
      updatedAt: new Date('2026-04-28T00:00:00.000Z').toISOString(),
    };
    jobRecordStore.set(queuedRecord.id, queuedRecord);
    getDomainJobRecordMock.mockImplementation(async (jobId: string) => jobRecordStore.get(jobId) || null);
    getFirebaseAdminFirestoreMock.mockImplementation(() => null);
    headAudioNovelObjectMock.mockResolvedValue(false);
    readAudioNovelObjectMock.mockResolvedValue(null);

    const { handleAudioNovelJobStatusRoute } = await import('../src/server/audioNovel/service');
    const response = await handleAudioNovelJobStatusRoute(
      new Request('http://localhost/audio-novel/jobs/audio-novel_queued'),
      'audio-novel_queued',
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      jobId: 'audio-novel_queued',
      status: 'completed',
      cacheHit: false,
      result: {
        generated: true,
        storage: 'r2',
        source: 'generated',
      },
    });
    expect(jobRecordStore.get('audio-novel_queued')?.status).toBe('completed');
  });

  it('avoids a duplicate run fallback after bidi audio has already started streaming', async () => {
    streamAudioNovelBidiMock.mockImplementationOnce(async (_runs, onChunk) => {
      await onChunk(Buffer.alloc(960, 3));
      throw new Error('socket closed mid-stream');
    });

    const { streamAudioNovelLive } = await import('../src/server/audioNovel/service');
    const payloads: Array<Buffer | Record<string, unknown>> = [];

    await streamAudioNovelLive(
      'user-1',
      'Narrator: Keep the launch smoke test concise.',
      undefined,
      undefined,
      (payload) => payloads.push(payload),
    );

    expect(streamAudioNovelBidiMock).toHaveBeenCalledTimes(1);
    expect(synthesizeAudioNovelRunMock).not.toHaveBeenCalled();
    expect(payloads.some((payload) => Buffer.isBuffer(payload))).toBe(true);
    expect(
      payloads.some(
        (payload) =>
          !Buffer.isBuffer(payload)
          && payload.code === 'BIDI_STREAM_INTERRUPTED'
          && payload.partial === true,
      ),
    ).toBe(true);
  });
});
