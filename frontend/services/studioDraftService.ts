const DB_NAME = 'vf_studio_drafts';
const DB_VERSION = 1;
const STORE_NAME = 'drafts';
const AUTO_SAVE_KEY = 'studio_script';
const AUTO_SAVE_INTERVAL_MS = 30_000;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function saveStudioDraft(text: string, meta?: Record<string, unknown>): Promise<void> {
  try {
    const db = await openDb();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    store.put({ text, meta, savedAt: Date.now() }, AUTO_SAVE_KEY);
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {}
}

export async function loadStudioDraft(): Promise<{ text: string; meta?: Record<string, unknown>; savedAt: number } | null> {
  try {
    const db = await openDb();
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const request = store.get(AUTO_SAVE_KEY);
    return await new Promise((resolve) => {
      request.onsuccess = () => {
        const result = request.result;
        if (result && typeof result === 'object' && 'text' in result) {
          resolve(result as { text: string; meta?: Record<string, unknown>; savedAt: number });
        } else {
          resolve(null);
        }
      };
      request.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

export async function clearStudioDraft(): Promise<void> {
  try {
    const db = await openDb();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).delete(AUTO_SAVE_KEY);
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {}
}

export function startAutoSave(getText: () => string, getMeta?: () => Record<string, unknown>): () => void {
  let timer: ReturnType<typeof setInterval> | null = null;
  let lastSavedText = '';
  timer = setInterval(() => {
    const text = getText();
    if (text === lastSavedText) return;
    lastSavedText = text;
    void saveStudioDraft(text, getMeta?.());
  }, AUTO_SAVE_INTERVAL_MS);
  return () => {
    if (timer !== null) clearInterval(timer);
  };
}
