import { ChapterMemorySummary, ChapterVersionSnapshot, NovelChapter, ProjectMemoryLedger } from '../types';

const NOVEL_FS_DB_NAME = 'vf_novel_fs';
const NOVEL_FS_STORE = 'handles';
const NOVEL_FS_ROOT_KEY = 'root';

const getIndexedDb = (): IDBFactory | null => {
  if (typeof window === 'undefined') return null;
  return window.indexedDB || null;
};

const openDb = async (): Promise<IDBDatabase> => {
  const indexedDb = getIndexedDb();
  if (!indexedDb) throw new Error('IndexedDB is not available in this environment.');
  return await new Promise((resolve, reject) => {
    const req = indexedDb.open(NOVEL_FS_DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(NOVEL_FS_STORE)) db.createObjectStore(NOVEL_FS_STORE);
    };
    req.onerror = () => reject(req.error || new Error('Failed to open IndexedDB.'));
    req.onsuccess = () => resolve(req.result);
  });
};

const storeHandle = async (key: string, handle: FileSystemHandle): Promise<void> => {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(NOVEL_FS_STORE, 'readwrite');
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error('Failed to store file-system handle.'));
    tx.objectStore(NOVEL_FS_STORE).put(handle, key);
  });
  db.close();
};

const readHandle = async <T extends FileSystemHandle>(key: string): Promise<T | null> => {
  const db = await openDb();
  const handle = await new Promise<T | null>((resolve, reject) => {
    const tx = db.transaction(NOVEL_FS_STORE, 'readonly');
    tx.onerror = () => reject(tx.error || new Error('Failed to read file-system handle.'));
    const request = tx.objectStore(NOVEL_FS_STORE).get(key);
    request.onerror = () => reject(request.error || new Error('Failed to read file-system handle.'));
    request.onsuccess = () => resolve((request.result as T) || null);
  });
  db.close();
  return handle;
};

const deleteHandle = async (key: string): Promise<void> => {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(NOVEL_FS_STORE, 'readwrite');
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error('Failed to delete file-system handle.'));
    tx.objectStore(NOVEL_FS_STORE).delete(key);
  });
  db.close();
};

const ensureWritePermission = async (handle: FileSystemHandle): Promise<boolean> => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fsHandle = handle as any;
  if (typeof fsHandle.queryPermission !== 'function') return true;
  const current = await fsHandle.queryPermission({ mode: 'readwrite' });
  if (current === 'granted') return true;
  if (typeof fsHandle.requestPermission !== 'function') return false;
  const next = await fsHandle.requestPermission({ mode: 'readwrite' });
  return next === 'granted';
};

const getFileHandleWriter = async (directory: FileSystemDirectoryHandle, fileName: string): Promise<FileSystemWritableFileStream> => {
  const fileHandle = await directory.getFileHandle(fileName, { create: true });
  return await fileHandle.createWritable();
};

const writeTextFile = async (directory: FileSystemDirectoryHandle, fileName: string, content: string): Promise<void> => {
  const writer = await getFileHandleWriter(directory, fileName);
  await writer.write(content);
  await writer.close();
};

const slugify = (input: string): string => {
  const token = String(input || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return token || 'untitled-novel';
};

export const isNovelLocalFsSupported = (): boolean =>
  typeof window !== 'undefined' && typeof (window as any).showDirectoryPicker === 'function';

export const pickNovelRootFolder = async (): Promise<FileSystemDirectoryHandle> => {
  if (!isNovelLocalFsSupported()) throw new Error('File System Access API is not supported in this browser.');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handle = (await (window as any).showDirectoryPicker({ mode: 'readwrite' })) as FileSystemDirectoryHandle;
  const ok = await ensureWritePermission(handle);
  if (!ok) throw new Error('Folder permission was denied.');
  await storeHandle(NOVEL_FS_ROOT_KEY, handle);
  return handle;
};

export const getNovelRootFolder = async (): Promise<FileSystemDirectoryHandle | null> => {
  if (!isNovelLocalFsSupported()) return null;
  const handle = await readHandle<FileSystemDirectoryHandle>(NOVEL_FS_ROOT_KEY);
  if (!handle) return null;
  const ok = await ensureWritePermission(handle);
  if (!ok) return null;
  return handle;
};

export const clearNovelRootFolder = async (): Promise<void> => {
  await deleteHandle(NOVEL_FS_ROOT_KEY);
};

export interface NovelFsSyncPayload {
  projectName: string;
  chapters: Array<Pick<NovelChapter, 'id' | 'index' | 'title'> & { text: string; adaptedText?: string }>;
  ledger: ProjectMemoryLedger;
  chapterSummaries: ChapterMemorySummary[];
  chapterVersions: Record<string, ChapterVersionSnapshot[]>;
}

const ensureDir = async (root: FileSystemDirectoryHandle, name: string): Promise<FileSystemDirectoryHandle> =>
  await root.getDirectoryHandle(name, { create: true });

export const syncNovelProjectToFolder = async (
  rootHandle: FileSystemDirectoryHandle,
  payload: NovelFsSyncPayload
): Promise<void> => {
  const permission = await ensureWritePermission(rootHandle);
  if (!permission) throw new Error('Folder permission was denied.');
  const projectDir = await ensureDir(rootHandle, slugify(payload.projectName));
  const chaptersDir = await ensureDir(projectDir, 'chapters');
  const versionsDir = await ensureDir(projectDir, 'versions');

  const sortedChapters = [...payload.chapters].sort((a, b) => a.index - b.index);
  for (const chapter of sortedChapters) {
    const chapterLabel = String(chapter.index).padStart(3, '0');
    await writeTextFile(chaptersDir, `chapter-${chapterLabel}.txt`, String(chapter.text || ''));
    await writeTextFile(chaptersDir, `chapter-${chapterLabel}.adapted.txt`, String(chapter.adaptedText || ''));
  }

  await writeTextFile(projectDir, 'memory-ledger.json', JSON.stringify(payload.ledger, null, 2));
  await writeTextFile(projectDir, 'chapter-summaries.json', JSON.stringify(payload.chapterSummaries, null, 2));

  const chapterVersionEntries = Object.entries(payload.chapterVersions || {});
  for (const [chapterId, versions] of chapterVersionEntries) {
    const chapterDir = await ensureDir(versionsDir, chapterId);
    for (const version of versions) {
      const safeTs = String(version.timestamp || '')
        .replace(/[^0-9TZ_\-:.]/g, '_')
        .replace(/:/g, '-');
      const fileName = `${safeTs || Date.now().toString()}.json`;
      await writeTextFile(chapterDir, fileName, JSON.stringify(version, null, 2));
    }
  }
};
