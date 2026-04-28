import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const originalRuntimeBindings = (globalThis as Record<string, unknown>).__vfRuntimeBindings;
const originalR2Env = {
  R2_ACCOUNT_ID: process.env.R2_ACCOUNT_ID,
  R2_ACCESS_KEY_ID: process.env.R2_ACCESS_KEY_ID,
  R2_SECRET_ACCESS_KEY: process.env.R2_SECRET_ACCESS_KEY,
  R2_BUCKET_NAME: process.env.R2_BUCKET_NAME,
  R2_PUBLIC_BASE_URL: process.env.R2_PUBLIC_BASE_URL,
  NEXT_PUBLIC_R2_AUDIO_URL: process.env.NEXT_PUBLIC_R2_AUDIO_URL,
};

const awsSendMock = vi.hoisted(() => vi.fn(async (command: { constructor?: { name?: string } }) => {
  switch (command?.constructor?.name) {
    case 'GetObjectCommand':
      return {
        Body: Buffer.from('legacy-r2-body', 'utf8'),
        ContentType: 'audio/mpeg',
      };
    case 'HeadObjectCommand':
      return {};
    case 'PutObjectCommand':
      return {};
    default:
      return {};
  }
}));

const getSignedUrlMock = vi.hoisted(() => vi.fn(async (_client: unknown, command: { input?: { Key?: string } }) => (
  `https://signed.example/${String(command?.input?.Key || 'object')}`
)));

vi.mock('@aws-sdk/client-s3', () => ({
  GetObjectCommand: class GetObjectCommand {
    input: unknown;

    constructor(input: unknown) {
      this.input = input;
    }
  },
  HeadObjectCommand: class HeadObjectCommand {
    input: unknown;

    constructor(input: unknown) {
      this.input = input;
    }
  },
  PutObjectCommand: class PutObjectCommand {
    input: unknown;

    constructor(input: unknown) {
      this.input = input;
    }
  },
  S3Client: class S3Client {
    send = awsSendMock;
  },
}));

vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: getSignedUrlMock,
}));

const restoreR2Env = () => {
  const keys = Object.keys(originalR2Env) as Array<keyof typeof originalR2Env>;
  for (const key of keys) {
    const value = originalR2Env[key];
    if (typeof value === 'undefined') {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
};

describe('audio novel storage and job adapters', () => {
  beforeEach(() => {
    awsSendMock.mockClear();
    getSignedUrlMock.mockClear();
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
    restoreR2Env();
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

  it('falls back to the legacy R2 client and memory job store when native hooks fail', async () => {
    process.env.R2_ACCOUNT_ID = 'acct-1';
    process.env.R2_ACCESS_KEY_ID = 'access-1';
    process.env.R2_SECRET_ACCESS_KEY = 'secret-1';
    process.env.R2_BUCKET_NAME = 'vf-novel-storage';
    process.env.R2_PUBLIC_BASE_URL = 'https://pub-vf-novel-storage.r2.dev';

    (globalThis as Record<string, unknown>).__vfRuntimeBindings = {
      r2Bucket: {
        head: vi.fn(async () => {
          throw new Error('native head unavailable');
        }),
        get: vi.fn(async () => {
          throw new Error('native read unavailable');
        }),
        put: vi.fn(async () => {
          throw new Error('native write unavailable');
        }),
      },
      domainJobStore: {
        getRecord: vi.fn(async () => {
          throw new Error('native job get unavailable');
        }),
        saveRecord: vi.fn(async () => {
          throw new Error('native job save unavailable');
        }),
        createRecordIfAbsent: vi.fn(async () => {
          throw new Error('native job create unavailable');
        }),
      },
    };

    const { writeAudioNovelObject, headAudioNovelObject, readAudioNovelObject, getAudioNovelSignedUrl } = await import('../src/server/audioNovel/storage');
    const { createDomainJobRecord, createDomainJobRecordIfAbsent, getDomainJobRecord, saveDomainJobRecord } = await import('../src/server/jobs/domainJobStore');

    await expect(writeAudioNovelObject('audio/book-1/ch-1/hash.mp3', Buffer.from('fallback-body'), 'audio/mpeg')).resolves.toBeUndefined();
    expect(awsSendMock).toHaveBeenCalled();
    expect(awsSendMock.mock.calls[0]?.[0]?.constructor?.name).toBe('PutObjectCommand');

    await expect(headAudioNovelObject('audio/book-1/ch-1/hash.mp3')).resolves.toBe(true);

    const object = await readAudioNovelObject('audio/book-1/ch-1/hash.mp3');
    expect(object).toMatchObject({
      contentType: 'audio/mpeg',
    });
    expect(object?.body.toString('utf8')).toBe('legacy-r2-body');

    await expect(getAudioNovelSignedUrl('audio/book-1/ch-1/hash.mp3')).resolves.toBe(
      'https://signed.example/audio/book-1/ch-1/hash.mp3',
    );

    const record = createDomainJobRecord({
      id: 'job-fallback-1',
      domain: 'audioNovel',
      payload: { bookId: 'book-1' },
    });

    await expect(createDomainJobRecordIfAbsent(record)).resolves.toMatchObject({
      created: true,
      record: {
        id: 'job-fallback-1',
        domain: 'audioNovel',
        status: 'queued',
      },
    });

    await expect(saveDomainJobRecord({
      ...record,
      status: 'running',
    })).resolves.toMatchObject({
      id: 'job-fallback-1',
      status: 'running',
    });

    await expect(getDomainJobRecord('job-fallback-1')).resolves.toMatchObject({
      id: 'job-fallback-1',
      status: 'running',
      domain: 'audioNovel',
    });
  });
});
