const STUDIO_QUEUE_DB_NAME = 'vf_studio_queue';
const STUDIO_QUEUE_AUDIO_STORE = 'audio';

const getIndexedDb = (): IDBFactory | null => {
  if (typeof window === 'undefined') return null;
  return window.indexedDB || null;
};

const openDb = async (): Promise<IDBDatabase> => {
  const indexedDb = getIndexedDb();
  if (!indexedDb) throw new Error('IndexedDB is not available in this environment.');
  return await new Promise((resolve, reject) => {
    const request = indexedDb.open(STUDIO_QUEUE_DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STUDIO_QUEUE_AUDIO_STORE)) {
        db.createObjectStore(STUDIO_QUEUE_AUDIO_STORE);
      }
    };
    request.onerror = () => reject(request.error || new Error('Failed to open Studio queue cache.'));
    request.onsuccess = () => resolve(request.result);
  });
};

export const storeStudioQueueAudioBlob = async (key: string, blob: Blob): Promise<void> => {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STUDIO_QUEUE_AUDIO_STORE, 'readwrite');
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error('Failed to store Studio queue audio.'));
    tx.objectStore(STUDIO_QUEUE_AUDIO_STORE).put(blob, key);
  });
  db.close();
};

export const readStudioQueueAudioBlob = async (key: string): Promise<Blob | null> => {
  const db = await openDb();
  const blob = await new Promise<Blob | null>((resolve, reject) => {
    const tx = db.transaction(STUDIO_QUEUE_AUDIO_STORE, 'readonly');
    tx.onerror = () => reject(tx.error || new Error('Failed to read Studio queue audio.'));
    const request = tx.objectStore(STUDIO_QUEUE_AUDIO_STORE).get(key);
    request.onerror = () => reject(request.error || new Error('Failed to read Studio queue audio.'));
    request.onsuccess = () => resolve((request.result as Blob) || null);
  });
  db.close();
  return blob;
};

export const deleteStudioQueueAudioBlob = async (key: string): Promise<void> => {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STUDIO_QUEUE_AUDIO_STORE, 'readwrite');
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error('Failed to delete Studio queue audio.'));
    tx.objectStore(STUDIO_QUEUE_AUDIO_STORE).delete(key);
  });
  db.close();
};

export const clearStudioQueueAudioCache = async (): Promise<void> => {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STUDIO_QUEUE_AUDIO_STORE, 'readwrite');
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error('Failed to clear Studio queue audio cache.'));
    tx.objectStore(STUDIO_QUEUE_AUDIO_STORE).clear();
  });
  db.close();
};
