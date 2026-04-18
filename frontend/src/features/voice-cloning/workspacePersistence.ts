import type {
  VoiceCloneRenderResponse,
  VoiceCloneJobKind,
} from './api';

const VOICE_CLONE_WORKSPACE_STORAGE_PREFIX = 'vf_voice_clone_workspace_v1';
const VOICE_CLONE_WORKSPACE_DB = 'vf_voice_clone_workspace';
const VOICE_CLONE_WORKSPACE_FILE_STORE = 'files';

export interface PersistedVoiceCloneFileRef {
  blobKey: string;
  name: string;
  type: string;
  size: number;
  lastModified: number;
}

export interface PersistedVoiceCloneResult {
  previewUrl: string;
  downloadUrl: string;
  fileName: string;
  response: VoiceCloneRenderResponse;
  cloneMode: 'seed_vc' | 'modal_vc';
}

export interface PersistedVoiceCloneActiveJob {
  requestId: string;
  jobId?: string;
  kind: VoiceCloneJobKind;
  status: string;
}

export interface PersistedVoiceCloneDraft {
  version: 1;
  scopeKey: string;
  referenceAudio?: PersistedVoiceCloneFileRef | null;
  targetAudio?: PersistedVoiceCloneFileRef | null;
  result?: PersistedVoiceCloneResult | null;
  activeJob?: PersistedVoiceCloneActiveJob | null;
  errorMessage?: string;
  updatedAtMs: number;
}

const getStorageKey = (scopeKey: string): string =>
  `${VOICE_CLONE_WORKSPACE_STORAGE_PREFIX}::${String(scopeKey || '').trim()}`;

const getBlobKey = (scopeKey: string, slot: 'reference' | 'target'): string =>
  `${String(scopeKey || '').trim()}::${slot}`;

const getIndexedDb = (): IDBFactory | null => {
  if (typeof window === 'undefined') return null;
  return window.indexedDB || null;
};

const openDb = async (): Promise<IDBDatabase> => {
  const indexedDb = getIndexedDb();
  if (!indexedDb) throw new Error('IndexedDB is not available in this environment.');
  return await new Promise((resolve, reject) => {
    const request = indexedDb.open(VOICE_CLONE_WORKSPACE_DB, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(VOICE_CLONE_WORKSPACE_FILE_STORE)) {
        db.createObjectStore(VOICE_CLONE_WORKSPACE_FILE_STORE);
      }
    };
    request.onerror = () => reject(request.error || new Error('Failed to open voice-clone workspace cache.'));
    request.onsuccess = () => resolve(request.result);
  });
};

const normalizePersistedFileRef = (value: unknown): PersistedVoiceCloneFileRef | null => {
  if (!value || typeof value !== 'object') return null;
  const source = value as Record<string, unknown>;
  const blobKey = String(source.blobKey || '').trim();
  const name = String(source.name || '').trim();
  if (!blobKey || !name) return null;
  return {
    blobKey,
    name,
    type: String(source.type || 'audio/wav').trim() || 'audio/wav',
    size: Math.max(0, Number(source.size || 0) || 0),
    lastModified: Math.max(0, Number(source.lastModified || 0) || 0),
  };
};

const normalizePersistedActiveJob = (value: unknown): PersistedVoiceCloneActiveJob | null => {
  if (!value || typeof value !== 'object') return null;
  const source = value as Record<string, unknown>;
  const requestId = String(source.requestId || '').trim();
  const rawKind = String(source.kind || '').trim().toLowerCase();
  const kind = rawKind === 'openvoice' ? 'voice_clone' : rawKind;
  if (!requestId || kind !== 'voice_clone') return null;
  return {
    requestId,
    ...(String(source.jobId || '').trim() ? { jobId: String(source.jobId || '').trim() } : {}),
    kind,
    status: String(source.status || '').trim() || 'starting',
  };
};

const normalizePersistedResult = (value: unknown): PersistedVoiceCloneResult | null => {
  if (!value || typeof value !== 'object') return null;
  const source = value as Record<string, unknown>;
  const cloneMode = String(source.cloneMode || '').trim();
  if (cloneMode !== 'modal_vc' && cloneMode !== 'seed_vc') return null;
  return {
    previewUrl: String(source.previewUrl || '').trim(),
    downloadUrl: String(source.downloadUrl || '').trim(),
    fileName: String(source.fileName || '').trim() || 'voice-clone.wav',
    response: ((source.response && typeof source.response === 'object') ? source.response : {}) as VoiceCloneRenderResponse,
    cloneMode,
  };
};

export const readVoiceCloneWorkspaceDraft = (scopeKey: string): PersistedVoiceCloneDraft | null => {
  if (typeof window === 'undefined') return null;
  try {
    const raw = String(window.localStorage.getItem(getStorageKey(scopeKey)) || '').trim();
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const normalizedScopeKey = String(parsed.scopeKey || '').trim();
    if (!normalizedScopeKey || normalizedScopeKey !== String(scopeKey || '').trim()) return null;
    return {
      version: 1,
      scopeKey: normalizedScopeKey,
      referenceAudio: normalizePersistedFileRef(parsed.referenceAudio),
      targetAudio: normalizePersistedFileRef(parsed.targetAudio),
      result: normalizePersistedResult(parsed.result),
      activeJob: normalizePersistedActiveJob(parsed.activeJob),
      errorMessage: String(parsed.errorMessage || '').trim(),
      updatedAtMs: Math.max(0, Number(parsed.updatedAtMs || 0) || 0),
    };
  } catch {
    return null;
  }
};

export const writeVoiceCloneWorkspaceDraft = (scopeKey: string, draft: Omit<PersistedVoiceCloneDraft, 'version' | 'scopeKey' | 'updatedAtMs'>): void => {
  if (typeof window === 'undefined') return;
  const safeScopeKey = String(scopeKey || '').trim();
  if (!safeScopeKey) return;
  try {
    window.localStorage.setItem(getStorageKey(safeScopeKey), JSON.stringify({
      version: 1,
      scopeKey: safeScopeKey,
      referenceAudio: draft.referenceAudio || null,
      targetAudio: draft.targetAudio || null,
      result: draft.result || null,
      activeJob: draft.activeJob || null,
      errorMessage: String(draft.errorMessage || '').trim(),
      updatedAtMs: Date.now(),
    }));
  } catch {
    // Best effort only.
  }
};

export const clearVoiceCloneWorkspaceDraft = (scopeKey: string): void => {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(getStorageKey(scopeKey));
  } catch {
    // Best effort only.
  }
};

export const storeVoiceCloneWorkspaceFile = async (
  scopeKey: string,
  slot: 'reference' | 'target',
  file: File
): Promise<PersistedVoiceCloneFileRef> => {
  const blobKey = getBlobKey(scopeKey, slot);
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(VOICE_CLONE_WORKSPACE_FILE_STORE, 'readwrite');
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error('Failed to store voice-clone workspace file.'));
      tx.objectStore(VOICE_CLONE_WORKSPACE_FILE_STORE).put(file, blobKey);
    });
  } finally {
    db.close();
  }
  return {
    blobKey,
    name: String(file.name || `${slot}.wav`).trim() || `${slot}.wav`,
    type: String(file.type || 'audio/wav').trim() || 'audio/wav',
    size: Math.max(0, Number(file.size || 0)),
    lastModified: Math.max(0, Number(file.lastModified || Date.now())),
  };
};

export const readVoiceCloneWorkspaceFile = async (fileRef: PersistedVoiceCloneFileRef | null | undefined): Promise<File | null> => {
  const safeRef = normalizePersistedFileRef(fileRef);
  if (!safeRef) return null;
  const db = await openDb();
  const blob = await (async () => {
    try {
      return await new Promise<Blob | null>((resolve, reject) => {
        const tx = db.transaction(VOICE_CLONE_WORKSPACE_FILE_STORE, 'readonly');
        tx.onerror = () => reject(tx.error || new Error('Failed to read voice-clone workspace file.'));
        const request = tx.objectStore(VOICE_CLONE_WORKSPACE_FILE_STORE).get(safeRef.blobKey);
        request.onerror = () => reject(request.error || new Error('Failed to read voice-clone workspace file.'));
        request.onsuccess = () => resolve((request.result as Blob) || null);
      });
    } finally {
      db.close();
    }
  })();
  if (!blob) return null;
  return new File([blob], safeRef.name, {
    type: safeRef.type || blob.type || 'audio/wav',
    lastModified: safeRef.lastModified || Date.now(),
  });
};

export const deleteVoiceCloneWorkspaceFile = async (fileRef: PersistedVoiceCloneFileRef | null | undefined): Promise<void> => {
  const safeRef = normalizePersistedFileRef(fileRef);
  if (!safeRef) return;
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(VOICE_CLONE_WORKSPACE_FILE_STORE, 'readwrite');
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error('Failed to delete voice-clone workspace file.'));
      tx.objectStore(VOICE_CLONE_WORKSPACE_FILE_STORE).delete(safeRef.blobKey);
    });
  } finally {
    db.close();
  }
};

export const persistVoiceCloneWorkspaceFiles = async (
  scopeKey: string,
  referenceAudio: File | null,
  targetAudio: File | null
): Promise<{
  referenceAudio: PersistedVoiceCloneFileRef | null;
  targetAudio: PersistedVoiceCloneFileRef | null;
}> => ({
  referenceAudio: referenceAudio ? await storeVoiceCloneWorkspaceFile(scopeKey, 'reference', referenceAudio) : null,
  targetAudio: targetAudio ? await storeVoiceCloneWorkspaceFile(scopeKey, 'target', targetAudio) : null,
});
