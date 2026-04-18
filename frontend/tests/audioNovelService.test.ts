import { afterEach, describe, expect, it, vi } from 'vitest';

const getDomainJobRecordMock = vi.hoisted(() => vi.fn());
const getFirebaseAdminFirestoreMock = vi.hoisted(() => vi.fn());
const headAudioNovelObjectMock = vi.hoisted(() => vi.fn());
const getAudioNovelSignedUrlMock = vi.hoisted(() => vi.fn(async (key: string) => `https://signed.example/${key}`));
const readAudioNovelObjectMock = vi.hoisted(() => vi.fn());
const streamAudioNovelBidiMock = vi.hoisted(() => vi.fn());
const synthesizeAudioNovelRunMock = vi.hoisted(() => vi.fn(async () => Buffer.alloc(960, 7)));
const verifyFirebaseRequestMock = vi.hoisted(() => vi.fn(async () => ({ uid: 'user-1' })));

vi.mock('../src/server/jobs/domainJobStore.ts', () => ({
  createDomainJobRecord: vi.fn(),
  createDomainJobRecordIfAbsent: vi.fn(async (record: unknown) => ({ record, created: true })),
  getDomainJobRecord: (...args: unknown[]) => getDomainJobRecordMock(...args),
  saveDomainJobRecord: vi.fn(),
}));

vi.mock('../src/server/firebaseAdmin.ts', () => ({
  getFirebaseAdminFirestore: (...args: unknown[]) => getFirebaseAdminFirestoreMock(...args),
}));

vi.mock('../src/server/auth/requestAuth.ts', () => ({
  verifyFirebaseRequest: (...args: unknown[]) => verifyFirebaseRequestMock(...args),
}));

vi.mock('../src/server/audioNovel/storage.ts', () => ({
  getAudioNovelSignedUrl: (...args: unknown[]) => getAudioNovelSignedUrlMock(...args),
  headAudioNovelObject: (...args: unknown[]) => headAudioNovelObjectMock(...args),
  readAudioNovelObject: (...args: unknown[]) => readAudioNovelObjectMock(...args),
  writeAudioNovelObject: vi.fn(),
}));

vi.mock('../src/server/audioNovel/synthesizer.ts', () => ({
  getAudioNovelSilenceBuffer: () => Buffer.alloc(480),
  streamAudioNovelBidi: (...args: unknown[]) => streamAudioNovelBidiMock(...args),
  synthesizeAudioNovelRun: (...args: unknown[]) => synthesizeAudioNovelRunMock(...args),
}));

describe('audio novel backend contracts', () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    verifyFirebaseRequestMock.mockResolvedValue({ uid: 'user-1' });
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
