import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const originalRuntimeBindings = (globalThis as Record<string, unknown>).__vfRuntimeBindings;

describe('audio novel storage and job adapters', () => {
  beforeEach(() => {
    const objectStore = new Map<string, { body: Buffer; contentType: string }>();
    const jobStore = new Map<string, any>();

    (globalThis as Record<string, unknown>).__vfRuntimeBindings = {
      r2Bucket: {
        head: vi.fn(async (key: string) => (objectStore.has(key) ? { key } : null)),
        get: vi.fn(async (key: string) => {
          const entry = objectStore.get(key);
          return entry
            ? {
                body: entry.body,
                httpMetadata: {
                  contentType: entry.contentType,
                },
              }
            : null;
        }),
        put: vi.fn(async (key: string, body: Buffer | ArrayBuffer | ArrayBufferView | string, options?: { httpMetadata?: { contentType?: string } }) => {
          const buffer = Buffer.isBuffer(body)
            ? body
            : typeof body === 'string'
              ? Buffer.from(body, 'utf8')
              : body instanceof Uint8Array
                ? Buffer.from(body)
                : body instanceof ArrayBuffer
                  ? Buffer.from(new Uint8Array(body))
                  : Buffer.from(body.buffer, body.byteOffset, body.byteLength);
          objectStore.set(key, {
            body: buffer,
            contentType: options?.httpMetadata?.contentType || 'application/octet-stream',
          });
        }),
      },
      domainJobStore: {
        getRecord: vi.fn(async (id: string) => jobStore.get(id) || null),
        saveRecord: vi.fn(async (record: any) => {
          jobStore.set(record.id, record);
          return record;
        }),
        createRecordIfAbsent: vi.fn(async (record: any) => {
          const existing = jobStore.get(record.id);
          if (existing) {
            return { record: existing, created: false };
          }
          jobStore.set(record.id, record);
          return { record, created: true };
        }),
      },
    };
  });

  afterEach(() => {
    if (typeof originalRuntimeBindings === 'undefined') {
      delete (globalThis as Record<string, unknown>).__vfRuntimeBindings;
    } else {
      (globalThis as Record<string, unknown>).__vfRuntimeBindings = originalRuntimeBindings;
    }
    vi.resetModules();
  });

  it('stores audio novel objects through a native R2 bucket binding when available', async () => {
    const { writeAudioNovelObject, headAudioNovelObject, readAudioNovelObject, getAudioNovelSignedUrl } = await import('../src/server/audioNovel/storage');

    await writeAudioNovelObject('audio/book-1/ch-1/hash.mp3', Buffer.from('hello-r2'), 'audio/mpeg');

    expect(await headAudioNovelObject('audio/book-1/ch-1/hash.mp3')).toBe(true);

    const object = await readAudioNovelObject('audio/book-1/ch-1/hash.mp3');
    expect(object).toMatchObject({
      contentType: 'audio/mpeg',
    });
    expect(object?.body.toString('utf8')).toBe('hello-r2');
    await expect(getAudioNovelSignedUrl('audio/book-1/ch-1/hash.mp3')).resolves.toContain('pub-vf-novel-storage.r2.dev/audio/book-1/ch-1/hash.mp3');
  });

  it('uses the native domain job store adapter without falling back to Firestore', async () => {
    const { createDomainJobRecord, createDomainJobRecordIfAbsent, getDomainJobRecord, saveDomainJobRecord } = await import('../src/server/jobs/domainJobStore');

    const record = createDomainJobRecord({
      id: 'job-native-1',
      domain: 'audioNovel',
      payload: {
        bookId: 'book-1',
      },
    });

    const claimed = await createDomainJobRecordIfAbsent(record);
    expect(claimed).toMatchObject({
      created: true,
      record: {
        id: 'job-native-1',
        domain: 'audioNovel',
        status: 'queued',
      },
    });

    const saved = await saveDomainJobRecord({
      ...claimed.record,
      status: 'running',
    });
    expect(saved.status).toBe('running');

    await expect(getDomainJobRecord('job-native-1')).resolves.toMatchObject({
      id: 'job-native-1',
      status: 'running',
      domain: 'audioNovel',
    });
  });
});
