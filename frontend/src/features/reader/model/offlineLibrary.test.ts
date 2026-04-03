import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getReaderOfflineSavedUnitIds,
  listReaderOfflineAudio,
  loadReaderOfflineAudioBlob,
  saveReaderOfflineAudio,
  saveReaderOfflineBook,
} from './offlineLibrary';

class FakeIdbRequest<T = unknown> {
  result: T | undefined;
  error: Error | null = null;
  onupgradeneeded: ((event: unknown) => void) | null = null;
  onsuccess: ((event: unknown) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
}

class FakeObjectStore {
  constructor(
    private readonly records: Map<string, unknown>,
    private readonly transaction: { oncomplete: ((event: unknown) => void) | null; onerror: ((event: unknown) => void) | null; error: Error | null },
  ) {}

  put(value: unknown, key: string): FakeIdbRequest<string> {
    const request = new FakeIdbRequest<string>();
    queueMicrotask(() => {
      this.records.set(String(key), value);
      request.result = String(key);
      request.onsuccess?.({});
      this.transaction.oncomplete?.({});
    });
    return request;
  }

  get(key: string): FakeIdbRequest<unknown> {
    const request = new FakeIdbRequest<unknown>();
    queueMicrotask(() => {
      request.result = this.records.get(String(key));
      request.onsuccess?.({});
      this.transaction.oncomplete?.({});
    });
    return request;
  }

  delete(key: string): FakeIdbRequest<void> {
    const request = new FakeIdbRequest<void>();
    queueMicrotask(() => {
      this.records.delete(String(key));
      request.onsuccess?.({});
      this.transaction.oncomplete?.({});
    });
    return request;
  }
}

class FakeTransaction {
  oncomplete: ((event: unknown) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  error: Error | null = null;

  constructor(private readonly records: Map<string, unknown>) {}

  objectStore(): FakeObjectStore {
    return new FakeObjectStore(this.records, this);
  }
}

class FakeDatabase {
  private readonly stores = new Map<string, Map<string, unknown>>();
  objectStoreNames = {
    contains: (name: string) => this.stores.has(name),
  };

  createObjectStore(name: string): void {
    if (!this.stores.has(name)) {
      this.stores.set(name, new Map());
    }
  }

  transaction(name: string): FakeTransaction {
    if (!this.stores.has(name)) {
      this.stores.set(name, new Map());
    }
    return new FakeTransaction(this.stores.get(name) as Map<string, unknown>);
  }

  close(): void {
    // no-op
  }
}

class FakeIndexedDb {
  private readonly databases = new Map<string, FakeDatabase>();

  open(name: string): FakeIdbRequest<FakeDatabase> {
    const request = new FakeIdbRequest<FakeDatabase>();
    queueMicrotask(() => {
      const isNew = !this.databases.has(name);
      const database = this.databases.get(name) || new FakeDatabase();
      this.databases.set(name, database);
      request.result = database;
      if (isNew) {
        request.onupgradeneeded?.({});
      }
      request.onsuccess?.({});
    });
    return request;
  }
}

const flushMicrotasks = async (): Promise<void> => {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
};

describe('offlineLibrary', () => {
  beforeEach(() => {
    const indexedDb = new FakeIndexedDb();
    const storage = new Map<string, string>();
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        indexedDB: indexedDb,
        dispatchEvent: vi.fn(),
      },
    });
    Object.defineProperty(globalThis, 'indexedDB', {
      configurable: true,
      value: indexedDb,
    });
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => {
          storage.set(key, value);
        },
        removeItem: (key: string) => {
          storage.delete(key);
        },
        clear: () => {
          storage.clear();
        },
      },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete (globalThis as { window?: Window }).window;
    delete (globalThis as { indexedDB?: IDBFactory }).indexedDB;
    delete (globalThis as { localStorage?: Storage }).localStorage;
  });

  it('encrypts chapter audio and decrypts it back on load', async () => {
    const sourceText = 'hello offline audio';
    const saved = await saveReaderOfflineAudio({
      blob: new Blob([sourceText], { type: 'audio/wav' }),
      title: 'Chapter 1',
      unitLabel: 'Chapter 1',
      sessionId: 'session-1',
      bookId: 'book-1',
      bookTitle: 'Test Book',
      unitId: 'unit-1',
      sourceJobId: 'job-1',
      speakerMode: 'single-speaker',
      saveScope: 'chapter',
      chapterIndex: 0,
      chapterCount: 3,
      chapterTextSnapshot: 'Chapter snapshot text',
      watermark: {
        id: 'wm-123',
        metadata: {
          watermarkId: 'wm-123',
          source: 'reader-export',
        },
      },
    });
    await flushMicrotasks();

    const entries = listReaderOfflineAudio();
    expect(entries).toHaveLength(1);
    const firstEntry = entries[0];
    expect(firstEntry).toBeDefined();
    if (!firstEntry) {
      throw new Error('Expected one offline entry after save');
    }
    expect(firstEntry.watermark.id).toBe('wm-123');
    expect(firstEntry.chapterTextSnapshot).toBe('Chapter snapshot text');

    const blob = await loadReaderOfflineAudioBlob(saved.id);
    expect(blob).toBeInstanceOf(Blob);
    expect(await blob?.text()).toBe(sourceText);
  });

  it('saves book chapters as grouped chapter records', async () => {
    await saveReaderOfflineBook({
      title: 'Novel A',
      sessionId: 'session-book',
      bookId: 'book-a',
      speakerMode: 'multi-speaker',
      watermark: {
        id: 'wm-book',
        metadata: {
          watermarkId: 'wm-book',
          source: 'reader-export',
        },
      },
      chapters: [
        {
          blob: new Blob(['chapter-1'], { type: 'audio/wav' }),
          title: 'Chapter 1',
          unitLabel: 'Chapter 1',
          unitId: 'chapter-1',
          sourceJobId: 'job-1',
          chapterIndex: 0,
          chapterCount: 2,
          chapterTextSnapshot: 'Alpha',
        },
        {
          blob: new Blob(['chapter-2'], { type: 'audio/wav' }),
          title: 'Chapter 2',
          unitLabel: 'Chapter 2',
          unitId: 'chapter-2',
          sourceJobId: 'job-2',
          chapterIndex: 1,
          chapterCount: 2,
          chapterTextSnapshot: 'Beta',
        },
      ],
    });
    await flushMicrotasks();

    const entries = listReaderOfflineAudio();
    expect(entries).toHaveLength(2);
    expect(entries.every((entry) => entry.saveScope === 'book')).toBe(true);
    const newestEntry = entries[0];
    expect(newestEntry).toBeDefined();
    if (!newestEntry) {
      throw new Error('Expected newest offline chapter entry');
    }
    expect(newestEntry.bookTitle).toBe('Novel A');
    expect(entries.map((entry) => entry.chapterTextSnapshot)).toEqual(['Beta', 'Alpha']);
    expect(getReaderOfflineSavedUnitIds('session-book')).toEqual(['chapter-2', 'chapter-1']);
  });

  it('rejects saves without a watermark id or metadata', async () => {
    await expect(saveReaderOfflineAudio({
      blob: new Blob(['chapter-1'], { type: 'audio/wav' }),
      title: 'Chapter 1',
      unitLabel: 'Chapter 1',
      speakerMode: 'single-speaker',
    })).rejects.toThrow(/watermark/i);
  });
});
