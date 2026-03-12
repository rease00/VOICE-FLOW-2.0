import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  persistNovelWorkspaceMeta,
  readLegacyNovelWorkspaceSnapshot,
  readNovelWorkspaceMeta,
  readNovelWorkspaceSnapshot,
} from '../src/features/novel/services/localSnapshotStorage';
import { STORAGE_KEYS } from '../src/shared/storage/keys';

const createFakeLocalStorage = (): Storage => {
  const store = new Map<string, string>();
  return {
    get length() {
      return store.size;
    },
    clear: () => {
      store.clear();
    },
    getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
    key: (index: number) => Array.from(store.keys())[index] ?? null,
    removeItem: (key: string) => {
      store.delete(key);
    },
    setItem: (key: string, value: string) => {
      store.set(key, String(value));
    },
  };
};

const createFakeIndexedDb = () => {
  const stores = new Map<string, Map<string, unknown>>();

  const createAsyncRequest = <T,>() => {
    const request: {
      result?: T;
      onsuccess?: (() => void) | null;
      onerror?: (() => void) | null;
    } = {};
    return request;
  };

  return {
    open: () => {
      const request: {
        result?: IDBDatabase;
        onupgradeneeded?: (() => void) | null;
        onsuccess?: (() => void) | null;
        onerror?: (() => void) | null;
      } = {};

      const db = {
        objectStoreNames: {
          contains: (name: string) => stores.has(name),
        },
        createObjectStore: (name: string) => {
          stores.set(name, new Map());
          return {};
        },
        transaction: (name: string) => {
          const store = stores.get(name) || new Map<string, unknown>();
          stores.set(name, store);
          const tx: {
            oncomplete?: (() => void) | null;
            onerror?: (() => void) | null;
            objectStore: (storeName: string) => {
              get: (key: string) => { result?: unknown; onsuccess?: (() => void) | null; onerror?: (() => void) | null };
              put: (value: unknown, key: string) => object;
            };
          } = {
            objectStore: (storeName: string) => ({
              get: (key: string) => {
                const getRequest = createAsyncRequest<unknown>();
                setTimeout(() => {
                  getRequest.result = stores.get(storeName)?.get(key) ?? null;
                  getRequest.onsuccess?.();
                  setTimeout(() => {
                    tx.oncomplete?.();
                  }, 0);
                }, 0);
                return getRequest;
              },
              put: (value: unknown, key: string) => {
                stores.get(storeName)?.set(key, value);
                setTimeout(() => {
                  tx.oncomplete?.();
                }, 0);
                return createAsyncRequest<unknown>();
              },
            }),
          };
          return tx;
        },
        close: () => undefined,
      } as unknown as IDBDatabase;

      setTimeout(() => {
        request.result = db;
        request.onupgradeneeded?.();
        request.onsuccess?.();
      }, 0);

      return request as IDBOpenDBRequest;
    },
  } as IDBFactory;
};

describe('novel local snapshot storage', () => {
  let fakeLocalStorage: Storage;

  beforeEach(() => {
    fakeLocalStorage = createFakeLocalStorage();
    vi.stubGlobal('localStorage', fakeLocalStorage);
    vi.stubGlobal('window', { localStorage: fakeLocalStorage });
    fakeLocalStorage.clear();
    vi.stubGlobal('indexedDB', createFakeIndexedDb());
  });

  afterEach(() => {
    fakeLocalStorage?.clear();
    vi.unstubAllGlobals();
  });

  it('migrates the legacy localStorage snapshot into IndexedDB', async () => {
    const legacySnapshot = {
      version: 4,
      projects: [{ id: 'project_1', name: 'Imported Novel' }],
      selectedProjectId: 'project_1',
      selectedChapterId: 'chapter_1',
    };
    localStorage.setItem('vf_novel_workspace_v3', JSON.stringify(legacySnapshot));

    const result = await readNovelWorkspaceSnapshot({
      legacyKeys: ['vf_novel_workspace_v3'],
      parseLegacy: (raw) => {
        if (!raw) return null;
        return JSON.parse(raw) as typeof legacySnapshot;
      },
      createEmpty: () => ({ version: 4, projects: [], selectedProjectId: '', selectedChapterId: '' }),
    });

    expect(result.selectedProjectId).toBe('project_1');

    const fromIndexedDb = await readNovelWorkspaceSnapshot({
      legacyKeys: [],
      parseLegacy: () => null,
      createEmpty: () => ({ version: 4, projects: [], selectedProjectId: '', selectedChapterId: '' }),
    });

    expect(fromIndexedDb.selectedChapterId).toBe('chapter_1');
    expect(localStorage.getItem(STORAGE_KEYS.novelWorkspaceMigration)).toContain('vf_novel_workspace_v3');
  });

  it('keeps selection metadata in localStorage', () => {
    persistNovelWorkspaceMeta({ selectedProjectId: 'project_2', selectedChapterId: 'chapter_9' });
    expect(readNovelWorkspaceMeta()).toMatchObject({
      selectedProjectId: 'project_2',
      selectedChapterId: 'chapter_9',
    });
  });

  it('can inspect the legacy snapshot source without touching IndexedDB', () => {
    localStorage.setItem('vf_novel_workspace_v2', JSON.stringify({ version: 4, selectedProjectId: 'legacy_project' }));
    const result = readLegacyNovelWorkspaceSnapshot(['vf_novel_workspace_v2'], (raw) => raw ? JSON.parse(raw) : null);
    expect(result.sourceKey).toBe('vf_novel_workspace_v2');
    expect((result.snapshot as { selectedProjectId?: string } | null)?.selectedProjectId).toBe('legacy_project');
  });
});
