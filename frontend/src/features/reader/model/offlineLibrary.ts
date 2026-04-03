import { STORAGE_KEYS } from '../../../shared/storage/keys';
import { readStorageJson, writeStorageJson } from '../../../shared/storage/localStore';

const READER_OFFLINE_DB_NAME = 'vf_reader_offline_audio_v2';
const READER_OFFLINE_DB_VERSION = 1;
const READER_OFFLINE_AUDIO_STORE = 'audio';
const READER_OFFLINE_ID_PREFIX = 'reader-audio';
const READER_OFFLINE_CRYPTO_KEY_STORAGE_KEY = 'vf_reader_offline_audio_crypto_key_v1';
const READER_OFFLINE_CRYPTO_KEY_VERSION = 1;

export const READER_OFFLINE_LIBRARY_UPDATED_EVENT = 'vf:reader-offline-library-updated';
export const READER_USAGE_UPDATED_EVENT = 'vf:reader-usage-updated';

export type ReaderSpeakerModeTag = 'single-speaker' | 'multi-speaker';
export type ReaderOfflineSaveScope = 'chapter' | 'book';

export interface ReaderOfflineWatermarkMetadata {
  [key: string]: string | number | boolean | null | undefined;
}

export interface ReaderOfflineChapterSnapshot {
  sessionId: string;
  bookId: string;
  bookTitle: string;
  chapterIndex: number;
  chapterCount: number;
  unitId: string;
  unitTitle: string;
  unitLabel: string;
  chapterTextSnapshot: string;
  sourceJobId: string;
  saveScope: ReaderOfflineSaveScope;
  createdAtMs: number;
}

export interface ReaderOfflineAudioEntry {
  id: string;
  title: string;
  unitLabel: string;
  sessionId: string;
  unitId: string;
  sourceJobId: string;
  speakerMode: ReaderSpeakerModeTag;
  mediaType: string;
  sizeBytes: number;
  createdAtMs: number;
  watermark: {
    mode: 'invisible';
    enforced: true;
    id?: string;
    metadata?: ReaderOfflineWatermarkMetadata;
  };
  saveScope?: ReaderOfflineSaveScope;
  bookId?: string;
  bookTitle?: string;
  chapterIndex?: number;
  chapterCount?: number;
  chapterTextSnapshot?: string;
  contentSnapshot?: ReaderOfflineChapterSnapshot;
}

interface ReaderOfflineAudioEnvelope {
  version: 2;
  entries: ReaderOfflineAudioEntry[];
}

interface ReaderOfflineCryptoKeyEnvelope {
  version: number;
  jwk: JsonWebKey;
}

interface ReaderOfflineEncryptedPayload {
  version: 1;
  kind: 'encrypted';
  mediaType: string;
  sizeBytes: number;
  iv: number[];
  ciphertext: ArrayBuffer;
  createdAtMs: number;
}

export interface ReaderUsageRecord {
  version: 1;
  readerEstimatedTotalVf: number;
  updatedAtMs: number;
}

type OfflineAudioRecord = ReaderOfflineEncryptedPayload | Blob | null;

const getBrowserWindow = (): Window | null => (
  typeof window !== 'undefined' ? window : null
);

const getSubtleCrypto = (): SubtleCrypto => {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    throw new Error('WebCrypto is unavailable for Reader offline saves.');
  }
  return subtle;
};

const readLocalStorageJson = <T>(storageKey: string): T | null => {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw || !raw.trim()) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
};

const writeLocalStorageJson = (storageKey: string, value: unknown): void => {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(storageKey, JSON.stringify(value));
  } catch {
    // no-op
  }
};

const readCryptoKeyEnvelope = (): ReaderOfflineCryptoKeyEnvelope | null => (
  readLocalStorageJson<ReaderOfflineCryptoKeyEnvelope>(READER_OFFLINE_CRYPTO_KEY_STORAGE_KEY)
);

const persistCryptoKeyEnvelope = (jwk: JsonWebKey): void => {
  writeLocalStorageJson(READER_OFFLINE_CRYPTO_KEY_STORAGE_KEY, {
    version: READER_OFFLINE_CRYPTO_KEY_VERSION,
    jwk,
  } satisfies ReaderOfflineCryptoKeyEnvelope);
};

let offlineCryptoKeyPromise: Promise<CryptoKey> | null = null;

const ensureOfflineCryptoKey = async (): Promise<CryptoKey> => {
  if (offlineCryptoKeyPromise) return offlineCryptoKeyPromise;
  offlineCryptoKeyPromise = (async () => {
    const subtle = getSubtleCrypto();
    const stored = readCryptoKeyEnvelope();
    if (stored?.jwk) {
      return subtle.importKey(
        'jwk',
        stored.jwk,
        { name: 'AES-GCM' },
        true,
        ['encrypt', 'decrypt']
      );
    }

    const key = await subtle.generateKey(
      { name: 'AES-GCM', length: 256 },
      true,
      ['encrypt', 'decrypt']
    );
    const jwk = await subtle.exportKey('jwk', key);
    persistCryptoKeyEnvelope(jwk);
    return key;
  })();

  try {
    return await offlineCryptoKeyPromise;
  } finally {
    offlineCryptoKeyPromise = null;
  }
};

const toArrayBuffer = async (blob: Blob): Promise<ArrayBuffer> => blob.arrayBuffer();

const toUint8Array = (value: ArrayBuffer | ArrayBufferView | number[]): Uint8Array => {
  if (Array.isArray(value)) return new Uint8Array(value);
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  return new Uint8Array(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength));
};

const cloneWatermarkMetadata = (value: unknown): ReaderOfflineWatermarkMetadata | null => {
  if (!value || typeof value !== 'object') return null;
  const entries = Object.entries(value as Record<string, unknown>)
    .reduce<ReaderOfflineWatermarkMetadata>((accumulator, [key, candidate]) => {
      const safeKey = String(key || '').trim();
      if (!safeKey) return accumulator;
      if (
        typeof candidate === 'string'
        || typeof candidate === 'number'
        || typeof candidate === 'boolean'
        || candidate === null
        || typeof candidate === 'undefined'
      ) {
        accumulator[safeKey] = candidate;
      } else {
        try {
          accumulator[safeKey] = JSON.parse(JSON.stringify(candidate)) as unknown as string | number | boolean | null;
        } catch {
          accumulator[safeKey] = String(candidate);
        }
      }
      return accumulator;
    }, {});
  return Object.keys(entries).length > 0 ? entries : null;
};

const normalizeSpeakerMode = (value: unknown): ReaderSpeakerModeTag => (
  String(value || '').trim().toLowerCase() === 'multi-speaker' ? 'multi-speaker' : 'single-speaker'
);

const normalizeSaveScope = (value: unknown): ReaderOfflineSaveScope => (
  String(value || '').trim().toLowerCase() === 'book' ? 'book' : 'chapter'
);

const normalizeEntry = (value: unknown): ReaderOfflineAudioEntry | null => {
  if (!value || typeof value !== 'object') return null;
  const input = value as Record<string, unknown>;
  const id = String(input.id || '').trim();
  const title = String(input.title || '').trim();
  if (!id || !title) return null;

  const watermarkMetadata = cloneWatermarkMetadata(
    input.watermark && typeof input.watermark === 'object'
      ? (input.watermark as { metadata?: unknown }).metadata
      : input.watermarkMetadata || input.watermarkHeaders
  ) || undefined;
  const watermarkId = String(
    (input.watermark && typeof input.watermark === 'object' ? (input.watermark as { id?: unknown }).id : undefined)
    || input.watermarkId
    || watermarkMetadata?.id
    || watermarkMetadata?.watermarkId
    || watermarkMetadata?.['x-vf-watermark-id']
    || ''
  ).trim();

  const saveScope = normalizeSaveScope(input.saveScope || input.scope);
  const sessionId = String(input.sessionId || '').trim();
  const unitId = String(input.unitId || '').trim();
  const bookId = String(input.bookId || '').trim();
  const bookTitle = String(input.bookTitle || '').trim();
  const unitLabel = String(input.unitLabel || '').trim() || 'Unit';
  const chapterTextSnapshot = String(
    input.chapterTextSnapshot
    || input.contentSnapshotText
    || (typeof input.contentSnapshot === 'string' ? input.contentSnapshot : '')
    || ''
  ).trim();
  const chapterIndex = Math.max(0, Number(input.chapterIndex || 0));
  const chapterCount = Math.max(0, Number(input.chapterCount || 0));
  const sourceJobId = String(input.sourceJobId || '').trim();
  const createdAtMs = Math.max(0, Number(input.createdAtMs || 0) || Date.now());
  const sizeBytes = Math.max(0, Number(input.sizeBytes || 0));

  return {
    id,
    title,
    unitLabel,
    sessionId,
    unitId,
    sourceJobId,
    speakerMode: normalizeSpeakerMode(input.speakerMode),
    mediaType: String(input.mediaType || 'audio/wav').trim() || 'audio/wav',
    sizeBytes,
    createdAtMs,
    watermark: {
      mode: 'invisible',
      enforced: true,
      ...(watermarkId ? { id: watermarkId } : {}),
      ...(watermarkMetadata ? { metadata: watermarkMetadata } : {}),
    },
    ...(saveScope ? { saveScope } : {}),
    ...(bookId ? { bookId } : {}),
    ...(bookTitle ? { bookTitle } : {}),
    ...(typeof input.chapterIndex !== 'undefined' ? { chapterIndex } : {}),
    ...(chapterCount > 0 ? { chapterCount } : {}),
    ...(chapterTextSnapshot ? { chapterTextSnapshot } : {}),
    ...(chapterTextSnapshot
      ? {
          contentSnapshot: {
            sessionId,
            bookId: bookId || sessionId,
            bookTitle: bookTitle || title,
            chapterIndex,
            chapterCount,
            unitId,
            unitTitle: title,
            unitLabel,
            chapterTextSnapshot,
            sourceJobId,
            saveScope,
            createdAtMs,
          } satisfies ReaderOfflineChapterSnapshot,
        }
      : {}),
  };
};

const readOfflineEnvelope = (): ReaderOfflineAudioEnvelope => {
  const raw = readStorageJson<ReaderOfflineAudioEnvelope | { entries?: unknown } | ReaderOfflineAudioEntry[]>(STORAGE_KEYS.readerOfflineAudioIndex);
  if (!raw || typeof raw !== 'object') {
    return { version: 2, entries: [] };
  }

  const rawEntries = Array.isArray(raw)
    ? raw
    : Array.isArray((raw as ReaderOfflineAudioEnvelope).entries)
      ? (raw as ReaderOfflineAudioEnvelope).entries
      : [];
  const entries = rawEntries
    .map(normalizeEntry)
    .filter(Boolean) as ReaderOfflineAudioEntry[];

  return {
    version: 2,
    entries: entries.sort((left, right) => right.createdAtMs - left.createdAtMs),
  };
};

const writeOfflineEnvelope = (entries: ReaderOfflineAudioEntry[]): void => {
  writeStorageJson(STORAGE_KEYS.readerOfflineAudioIndex, {
    version: 2,
    entries: [...entries].sort((left, right) => right.createdAtMs - left.createdAtMs),
  } satisfies ReaderOfflineAudioEnvelope);
  const readerWindow = getBrowserWindow();
  if (readerWindow) {
    readerWindow.dispatchEvent(new CustomEvent(READER_OFFLINE_LIBRARY_UPDATED_EVENT));
  }
};

const openOfflineDb = async (dbName: string): Promise<IDBDatabase> => {
  const indexedDb = typeof window !== 'undefined' ? window.indexedDB || null : null;
  if (!indexedDb) throw new Error('IndexedDB is unavailable for Reader offline audio.');

  return await new Promise((resolve, reject) => {
    const request = indexedDb.open(dbName, READER_OFFLINE_DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(READER_OFFLINE_AUDIO_STORE)) {
        db.createObjectStore(READER_OFFLINE_AUDIO_STORE);
      }
    };
    request.onerror = () => reject(request.error || new Error(`Failed to open Reader offline audio database (${dbName}).`));
    request.onsuccess = () => resolve(request.result);
  });
};

const putOfflineRecord = async (dbName: string, id: string, record: OfflineAudioRecord): Promise<void> => {
  const db = await openOfflineDb(dbName);
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(READER_OFFLINE_AUDIO_STORE, 'readwrite');
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error('Failed to persist offline audio.'));
    tx.objectStore(READER_OFFLINE_AUDIO_STORE).put(record, id);
  });
  db.close();
};

const getOfflineRecord = async (dbName: string, id: string): Promise<OfflineAudioRecord> => {
  const db = await openOfflineDb(dbName);
  const record = await new Promise<OfflineAudioRecord>((resolve, reject) => {
    const tx = db.transaction(READER_OFFLINE_AUDIO_STORE, 'readonly');
    tx.onerror = () => reject(tx.error || new Error('Failed to read offline audio.'));
    const request = tx.objectStore(READER_OFFLINE_AUDIO_STORE).get(id);
    request.onerror = () => reject(request.error || new Error('Failed to read offline audio.'));
    request.onsuccess = () => resolve((request.result as OfflineAudioRecord) || null);
  });
  db.close();
  return record;
};

const deleteOfflineRecord = async (dbName: string, id: string): Promise<void> => {
  const db = await openOfflineDb(dbName);
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(READER_OFFLINE_AUDIO_STORE, 'readwrite');
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error('Failed to delete offline audio.'));
    tx.objectStore(READER_OFFLINE_AUDIO_STORE).delete(id);
  });
  db.close();
};

const encryptReaderOfflineBlob = async (blob: Blob): Promise<ReaderOfflineEncryptedPayload> => {
  const subtle = getSubtleCrypto();
  const key = await ensureOfflineCryptoKey();
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const bytes = await toArrayBuffer(blob);
  const ciphertext = await subtle.encrypt({ name: 'AES-GCM', iv }, key, bytes);
  return {
    version: 1,
    kind: 'encrypted',
    mediaType: String(blob.type || 'audio/wav').trim() || 'audio/wav',
    sizeBytes: Math.max(0, Number(blob.size || bytes.byteLength || 0)),
    iv: Array.from(iv),
    ciphertext,
    createdAtMs: Date.now(),
  };
};

const decryptReaderOfflinePayload = async (payload: ReaderOfflineEncryptedPayload): Promise<Blob> => {
  const subtle = getSubtleCrypto();
  const key = await ensureOfflineCryptoKey();
  const iv = toUint8Array(payload.iv);
  const plainBuffer = await subtle.decrypt({ name: 'AES-GCM', iv }, key, payload.ciphertext);
  return new Blob([plainBuffer], { type: payload.mediaType || 'audio/wav' });
};

const ensureWatermarkPrecondition = (input: {
  watermark?: { id?: string; metadata?: ReaderOfflineWatermarkMetadata | Record<string, unknown> };
  watermarkId?: string;
  watermarkMetadata?: ReaderOfflineWatermarkMetadata | Record<string, unknown>;
  watermarkHeaders?: ReaderOfflineWatermarkMetadata | Record<string, unknown>;
}): { id: string; metadata: ReaderOfflineWatermarkMetadata } => {
  const watermarkId = String(
    input.watermark?.id
    || input.watermarkId
    || input.watermarkMetadata?.id
    || input.watermarkMetadata?.watermarkId
    || input.watermarkHeaders?.['x-vf-watermark-id']
    || ''
  ).trim();
  const metadata = cloneWatermarkMetadata(
    input.watermark?.metadata || input.watermarkMetadata || input.watermarkHeaders || null
  );

  if (!watermarkId) {
    throw new Error('Reader offline saves require a watermark id before storing audio locally.');
  }
  if (!metadata || Object.keys(metadata).length === 0) {
    throw new Error('Reader offline saves require watermark metadata before storing audio locally.');
  }
  return { id: watermarkId, metadata };
};

const upsertOfflineEntry = (entry: ReaderOfflineAudioEntry): ReaderOfflineAudioEntry => {
  const envelope = readOfflineEnvelope();
  const nextEntries = [entry, ...envelope.entries.filter((current) => current.id !== entry.id)];
  writeOfflineEnvelope(nextEntries);
  return entry;
};

const findEntryByUnit = (sessionId: string, unitId: string): ReaderOfflineAudioEntry | null => {
  const safeSessionId = String(sessionId || '').trim();
  const safeUnitId = String(unitId || '').trim();
  if (!safeSessionId || !safeUnitId) return null;
  const entries = readOfflineEnvelope().entries.filter((entry) => (
    String(entry.sessionId || '').trim() === safeSessionId
    && String(entry.unitId || '').trim() === safeUnitId
  ));
  return entries.sort((left, right) => right.createdAtMs - left.createdAtMs)[0] || null;
};

export const listReaderOfflineAudio = (): ReaderOfflineAudioEntry[] => (
  readOfflineEnvelope().entries
);

export const getReaderOfflineSavedUnitIds = (sessionId?: string): string[] => {
  const safeSessionId = String(sessionId || '').trim();
  if (!safeSessionId) return [];
  return Array.from(new Set(
    readOfflineEnvelope().entries
      .filter((entry) => String(entry.sessionId || '').trim() === safeSessionId)
      .map((entry) => String(entry.unitId || '').trim())
      .filter((unitId) => Boolean(unitId))
  ));
};

export const findReaderOfflineAudioEntryByUnitId = (
  sessionId: string,
  unitId: string
): ReaderOfflineAudioEntry | null => findEntryByUnit(sessionId, unitId);

export const loadReaderOfflineAudioBlob = async (id: string): Promise<Blob | null> => {
  const safeId = String(id || '').trim();
  if (!safeId) return null;

  const encryptedRecord = await getOfflineRecord(READER_OFFLINE_DB_NAME, safeId).catch(() => null);
  if (encryptedRecord && typeof encryptedRecord === 'object' && 'kind' in encryptedRecord && encryptedRecord.kind === 'encrypted') {
    return decryptReaderOfflinePayload(encryptedRecord);
  }
  if (encryptedRecord instanceof Blob) {
    return encryptedRecord;
  }

  const legacyRecord = await getOfflineRecord('vf_reader_offline_audio_v1', safeId).catch(() => null);
  if (legacyRecord instanceof Blob) {
    return legacyRecord;
  }

  return null;
};

export const loadReaderOfflineAudioBlobForUnit = async (
  sessionId: string,
  unitId: string
): Promise<Blob | null> => {
  const entry = findEntryByUnit(sessionId, unitId);
  if (!entry) return null;
  return loadReaderOfflineAudioBlob(entry.id);
};

export const saveReaderOfflineAudio = async (input: {
  blob: Blob;
  title: string;
  unitLabel: string;
  sessionId?: string;
  bookId?: string;
  bookTitle?: string;
  unitId?: string;
  sourceJobId?: string;
  speakerMode: ReaderSpeakerModeTag;
  saveScope?: ReaderOfflineSaveScope;
  chapterIndex?: number;
  chapterCount?: number;
  chapterTextSnapshot?: string;
  watermark?: { id?: string; metadata?: ReaderOfflineWatermarkMetadata | Record<string, unknown> };
  watermarkId?: string;
  watermarkMetadata?: ReaderOfflineWatermarkMetadata | Record<string, unknown>;
  watermarkHeaders?: ReaderOfflineWatermarkMetadata | Record<string, unknown>;
}): Promise<ReaderOfflineAudioEntry> => {
  const safeTitle = String(input.title || '').trim() || 'Reader audio';
  const watermark = ensureWatermarkPrecondition(input);
  const encryptedPayload = await encryptReaderOfflineBlob(input.blob);
  const id = `${READER_OFFLINE_ID_PREFIX}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const saveScope = normalizeSaveScope(input.saveScope);
  const chapterIndex = Math.max(0, Math.trunc(Number(input.chapterIndex || 0)));
  const chapterCount = Math.max(0, Math.trunc(Number(input.chapterCount || 0)));
  const createdAtMs = Date.now();
  const unitId = String(input.unitId || '').trim();
  const sessionId = String(input.sessionId || '').trim();
  const bookId = String(input.bookId || sessionId || '').trim();
  const bookTitle = String(input.bookTitle || safeTitle).trim() || safeTitle;
  const chapterTextSnapshot = String(input.chapterTextSnapshot || '').trim();
  const sourceJobId = String(input.sourceJobId || '').trim();

  await putOfflineRecord(READER_OFFLINE_DB_NAME, id, encryptedPayload);

  const entry: ReaderOfflineAudioEntry = upsertOfflineEntry({
    id,
    title: safeTitle,
    unitLabel: String(input.unitLabel || '').trim() || 'Unit',
    sessionId,
    unitId,
    sourceJobId,
    speakerMode: input.speakerMode,
    mediaType: String(input.blob.type || encryptedPayload.mediaType || 'audio/wav').trim() || 'audio/wav',
    sizeBytes: Math.max(0, Number(input.blob.size || encryptedPayload.sizeBytes || 0)),
    createdAtMs,
    watermark: {
      mode: 'invisible',
      enforced: true,
      id: watermark.id,
      metadata: watermark.metadata,
    },
    ...(saveScope ? { saveScope } : {}),
    ...(bookId ? { bookId } : {}),
    ...(bookTitle ? { bookTitle } : {}),
    ...(Object.prototype.hasOwnProperty.call(input, 'chapterIndex') || saveScope === 'book' ? { chapterIndex } : {}),
    ...(Object.prototype.hasOwnProperty.call(input, 'chapterCount') ? { chapterCount } : {}),
    ...(chapterTextSnapshot ? { chapterTextSnapshot } : {}),
    ...(chapterTextSnapshot
      ? {
          contentSnapshot: {
            sessionId,
            bookId,
            bookTitle,
            chapterIndex,
            chapterCount,
            unitId,
            unitTitle: safeTitle,
            unitLabel: String(input.unitLabel || '').trim() || 'Unit',
            chapterTextSnapshot,
            sourceJobId,
            saveScope,
            createdAtMs,
          },
        }
      : {}),
  });

  return entry;
};

export const saveReaderOfflineBook = async (input: {
  title: string;
  sessionId?: string;
  bookId?: string;
  speakerMode: ReaderSpeakerModeTag;
  watermark?: { id?: string; metadata?: ReaderOfflineWatermarkMetadata | Record<string, unknown> };
  watermarkId?: string;
  watermarkMetadata?: ReaderOfflineWatermarkMetadata | Record<string, unknown>;
  watermarkHeaders?: ReaderOfflineWatermarkMetadata | Record<string, unknown>;
  chapters: Array<{
    blob: Blob;
    title: string;
    unitLabel: string;
    unitId: string;
    sourceJobId?: string;
    chapterIndex: number;
    chapterCount?: number;
    chapterTextSnapshot?: string;
    mediaType?: string;
  }>;
}): Promise<ReaderOfflineAudioEntry[]> => {
  const safeChapters = input.chapters.filter((chapter) => chapter && chapter.blob instanceof Blob);
  if (safeChapters.length === 0) {
    return [];
  }

  const watermark = ensureWatermarkPrecondition(input);
  const sessionId = String(input.sessionId || '').trim();
  const bookId = String(input.bookId || sessionId || '').trim();
  const bookTitle = String(input.title || 'Reader book').trim() || 'Reader book';
  const chapterCount = Math.max(0, Math.trunc(Number(safeChapters[0]?.chapterCount || safeChapters.length)));
  const savedEntries: ReaderOfflineAudioEntry[] = [];

  for (const chapter of safeChapters) {
    const saveInput = {
      blob: chapter.blob,
      title: chapter.title,
      unitLabel: chapter.unitLabel,
      sessionId,
      bookId,
      bookTitle,
      unitId: chapter.unitId,
      speakerMode: input.speakerMode,
      saveScope: 'book' as const,
      chapterIndex: Math.max(0, Math.trunc(Number(chapter.chapterIndex || 0))),
      chapterCount: Math.max(0, Math.trunc(Number(chapter.chapterCount || chapterCount || safeChapters.length))),
      chapterTextSnapshot: String(chapter.chapterTextSnapshot || '').trim(),
      watermark: {
        id: watermark.id,
        metadata: watermark.metadata,
      },
      ...(chapter.sourceJobId ? { sourceJobId: chapter.sourceJobId } : {}),
    };
    const saved = await saveReaderOfflineAudio(saveInput);
    savedEntries.push(saved);
  }

  return savedEntries;
};

export const removeReaderOfflineAudio = async (id: string): Promise<void> => {
  const safeId = String(id || '').trim();
  if (!safeId) return;
  await deleteOfflineRecord(READER_OFFLINE_DB_NAME, safeId).catch(() => undefined);
  await deleteOfflineRecord('vf_reader_offline_audio_v1', safeId).catch(() => undefined);
  const envelope = readOfflineEnvelope();
  writeOfflineEnvelope(envelope.entries.filter((entry) => entry.id !== safeId));
};

export const readReaderUsageRecord = (): ReaderUsageRecord => {
  const raw = readStorageJson<ReaderUsageRecord>(STORAGE_KEYS.readerUsageRecord);
  return {
    version: 1,
    readerEstimatedTotalVf: Math.max(0, Number(raw?.readerEstimatedTotalVf || 0)),
    updatedAtMs: Math.max(0, Number(raw?.updatedAtMs || 0)),
  };
};

export const recordReaderEstimatedUsage = (readerEstimatedTotalVf: number): ReaderUsageRecord => {
  const next: ReaderUsageRecord = {
    version: 1,
    readerEstimatedTotalVf: Math.max(0, Number(readerEstimatedTotalVf || 0)),
    updatedAtMs: Date.now(),
  };
  writeStorageJson(STORAGE_KEYS.readerUsageRecord, next);
  const readerWindow = getBrowserWindow();
  if (readerWindow) {
    readerWindow.dispatchEvent(new CustomEvent(READER_USAGE_UPDATED_EVENT));
  }
  return next;
};
