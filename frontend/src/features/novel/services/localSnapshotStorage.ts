import { STORAGE_KEYS } from '../../../shared/storage/keys';
import { readStorageJson, writeStorageJson } from '../../../shared/storage/localStore';

const NOVEL_DB_NAME = 'voiceflow-novel';
const NOVEL_DB_VERSION = 1;
const NOVEL_SNAPSHOT_STORE = 'workspace-snapshots';
const NOVEL_SNAPSHOT_KEY = 'snapshot-v1';

export interface NovelWorkspaceMeta {
  selectedProjectId?: string;
  selectedChapterId?: string;
  persistedAt?: string;
}

interface ReadNovelWorkspaceSnapshotOptions<T> {
  legacyKeys: string[];
  parseLegacy: (raw: string | null) => T | null;
  createEmpty: () => T;
}

const getBrowserWindow = (): Window | null => (
  typeof window !== 'undefined' ? window : null
);

const openDb = async (): Promise<IDBDatabase | null> => {
  if (!getBrowserWindow() || typeof indexedDB === 'undefined') return null;
  return new Promise((resolve) => {
    const request = indexedDB.open(NOVEL_DB_NAME, NOVEL_DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(NOVEL_SNAPSHOT_STORE)) {
        db.createObjectStore(NOVEL_SNAPSHOT_STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
  });
};

const withStore = async <T>(
  mode: IDBTransactionMode,
  callback: (store: IDBObjectStore) => Promise<T> | T
): Promise<T | null> => {
  const db = await openDb();
  if (!db) return null;

  return new Promise((resolve) => {
    const tx = db.transaction(NOVEL_SNAPSHOT_STORE, mode);
    const store = tx.objectStore(NOVEL_SNAPSHOT_STORE);
    Promise.resolve(callback(store))
      .then((value) => {
        tx.oncomplete = () => {
          db.close();
          resolve(value);
        };
      })
      .catch(() => {
        db.close();
        resolve(null);
      });
    tx.onerror = () => {
      db.close();
      resolve(null);
    };
  });
};

export const readNovelWorkspaceMeta = (): NovelWorkspaceMeta | null => (
  readStorageJson<NovelWorkspaceMeta>(STORAGE_KEYS.novelWorkspaceMeta)
);

export const persistNovelWorkspaceMeta = (meta: NovelWorkspaceMeta): void => {
  writeStorageJson(STORAGE_KEYS.novelWorkspaceMeta, {
    ...(meta.selectedProjectId ? { selectedProjectId: meta.selectedProjectId } : {}),
    ...(meta.selectedChapterId ? { selectedChapterId: meta.selectedChapterId } : {}),
    persistedAt: meta.persistedAt || new Date().toISOString(),
  });
};

const recordMigration = (legacyKey: string): void => {
  writeStorageJson(STORAGE_KEYS.novelWorkspaceMigration, {
    sourceKey: legacyKey,
    migratedAt: new Date().toISOString(),
  });
};

export const readLegacyNovelWorkspaceSnapshot = <T>(
  legacyKeys: string[],
  parseLegacy: (raw: string | null) => T | null
): { snapshot: T | null; sourceKey: string } => {
  const browserWindow = getBrowserWindow();
  if (!browserWindow) return { snapshot: null, sourceKey: '' };
  for (const key of legacyKeys) {
    const parsed = parseLegacy(browserWindow.localStorage.getItem(key));
    if (parsed) {
      return { snapshot: parsed, sourceKey: key };
    }
  }
  return { snapshot: null, sourceKey: '' };
};

export const readNovelWorkspaceSnapshot = async <T>(
  options: ReadNovelWorkspaceSnapshotOptions<T>
): Promise<T> => {
  const stored = await withStore('readonly', async (store) => new Promise<T | null>((resolve) => {
    const request = store.get(NOVEL_SNAPSHOT_KEY);
    request.onsuccess = () => resolve((request.result as T | undefined) || null);
    request.onerror = () => resolve(null);
  }));
  if (stored) return stored;

  const legacy = readLegacyNovelWorkspaceSnapshot(options.legacyKeys, options.parseLegacy);
  if (legacy.snapshot) {
    await writeNovelWorkspaceSnapshot(legacy.snapshot);
    if (legacy.sourceKey) recordMigration(legacy.sourceKey);
    return legacy.snapshot;
  }

  return options.createEmpty();
};

export const writeNovelWorkspaceSnapshot = async <T>(snapshot: T): Promise<void> => {
  await withStore('readwrite', async (store) => {
    store.put(snapshot, NOVEL_SNAPSHOT_KEY);
  });
};
