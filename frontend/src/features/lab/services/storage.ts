import type {
  LabAsset,
  LabCapabilityProfile,
  LabClip,
  LabRailPanelId,
  LabRuntimeDefaults,
  LabSession,
  LabTool,
  LabTrack,
} from '../../../../types';
import { DEFAULT_LAB_RUNTIME_DEFAULTS } from '../model/orchestration';
import { DEFAULT_LAB_CANVAS_PRESET_ID, getLabCanvasPreset } from '../model/canvasPresets';
import { STORAGE_KEYS } from '../../../shared/storage/keys';
import { readStorageJson, writeStorageJson } from '../../../shared/storage/localStore';

const LAB_DB_NAME = 'voiceflow-lab';
const LAB_DB_VERSION = 1;
const LAB_ASSET_STORE = 'asset-blobs';
const LAB_SNAPSHOT_VERSION = 4;

export interface LabStoredAsset extends Omit<LabAsset, 'objectUrl' | 'posterUrl'> {
  posterBlobAssetId?: string;
}

export interface LabSessionSnapshot {
  version: number;
  session: {
    version: number;
    canvas: LabSession['canvas'];
    assets: LabStoredAsset[];
    tracks: LabTrack[];
    clips: LabClip[];
    transitions: LabSession['transitions'];
    transport: LabSession['transport'];
  };
  selectedAssetId?: string;
  selectedClipId?: string;
  selectedTool?: LabTool;
}

interface LabLegacySessionSnapshot {
  version?: number;
  session?: {
    version?: number;
    canvas?: LabSession['canvas'];
    assets?: LabStoredAsset[];
    tracks?: LabTrack[];
    clips?: LabClip[];
    transitions?: LabSession['transitions'];
    transport?: LabSession['transport'];
  };
  selectedAssetId?: string;
  selectedClipId?: string;
  selectedTool?: LabTool;
}

export interface LabPreferencesSnapshot {
  selectedTool: LabTool;
  selectedPanel?: LabRailPanelId;
}

const isBrowser = typeof window !== 'undefined';

const openDb = async (): Promise<IDBDatabase | null> => {
  if (!isBrowser || typeof indexedDB === 'undefined') return null;
  return new Promise((resolve) => {
    const request = indexedDB.open(LAB_DB_NAME, LAB_DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(LAB_ASSET_STORE)) {
        db.createObjectStore(LAB_ASSET_STORE);
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
    const tx = db.transaction(LAB_ASSET_STORE, mode);
    const store = tx.objectStore(LAB_ASSET_STORE);
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

export const persistLabAssetBlob = async (assetId: string, blob: Blob): Promise<void> => {
  await withStore('readwrite', async (store) => {
    store.put(blob, assetId);
  });
};

export const readLabAssetBlob = async (assetId: string): Promise<Blob | null> => {
  const result = await withStore('readonly', async (store) => new Promise<Blob | null>((resolve) => {
    const request = store.get(assetId);
    request.onsuccess = () => resolve((request.result as Blob | undefined) || null);
    request.onerror = () => resolve(null);
  }));
  return result || null;
};

export const removeLabAssetBlob = async (assetId: string): Promise<void> => {
  await withStore('readwrite', async (store) => {
    store.delete(assetId);
  });
};

export const persistLabSessionSnapshot = (
  session: LabSession,
  options?: { selectedAssetId?: string; selectedClipId?: string; selectedTool?: LabTool }
): void => {
  const snapshot: LabSessionSnapshot = {
    version: LAB_SNAPSHOT_VERSION,
    session: {
      version: session.version,
      canvas: session.canvas,
      assets: session.assets.map((asset) => {
        const { objectUrl: _objectUrl, posterUrl: _posterUrl, ...rest } = asset;
        return rest;
      }),
      tracks: session.tracks,
      clips: session.clips,
      transitions: session.transitions,
      transport: session.transport,
    },
    ...(options?.selectedAssetId ? { selectedAssetId: options.selectedAssetId } : {}),
    ...(options?.selectedClipId ? { selectedClipId: options.selectedClipId } : {}),
    ...(options?.selectedTool ? { selectedTool: options.selectedTool } : {}),
  };
  writeStorageJson(STORAGE_KEYS.labSession, snapshot);
};

const resolveTransitionKind = (value: unknown): LabSession['transitions'][number]['kind'] => {
  const token = String(value || '').trim().toLowerCase();
  if (token === 'cut') return 'cut';
  if (token === 'fade') return 'fade';
  if (token === 'wipe') return 'wipe';
  if (token === 'slide') return 'slide';
  return 'crossfade';
};

const resolveTransitionEasing = (value: unknown): LabSession['transitions'][number]['easing'] => {
  const token = String(value || '').trim().toLowerCase();
  if (token === 'linear') return 'linear';
  if (token === 'ease_in') return 'ease_in';
  if (token === 'ease_out') return 'ease_out';
  return 'ease_in_out';
};

const migrateLabSessionSnapshot = (snapshot: LabLegacySessionSnapshot | null): LabSessionSnapshot | null => {
  if (!snapshot) return null;
  const snapshotVersion = Number(snapshot.version || 0);
  if (!Number.isFinite(snapshotVersion) || snapshotVersion < 1 || snapshotVersion > LAB_SNAPSHOT_VERSION) {
    return null;
  }

  const sourceSession = snapshot.session;
  if (
    !sourceSession
    || !Array.isArray(sourceSession.assets)
    || !Array.isArray(sourceSession.tracks)
    || !Array.isArray(sourceSession.clips)
  ) {
    return null;
  }

  const migratedClips: LabClip[] = sourceSession.clips.map((clip, index) => {
    const rowId = String(clip.timelineRowId || clip.trackId || `lab_row_${index}`).trim() || `lab_row_${index}`;
    return {
      ...clip,
      trackId: String(clip.trackId || rowId).trim() || rowId,
      timelineRowId: rowId,
      layerOrder: Number.isFinite(clip.layerOrder) ? Math.max(0, Math.round(clip.layerOrder)) : index,
      insertedAtPlayheadMs: Number.isFinite(clip.insertedAtPlayheadMs)
        ? Math.max(0, Math.round(clip.insertedAtPlayheadMs))
        : Math.max(0, Math.round(Number(clip.startMs || 0))),
    };
  });
  const validClipIds = new Set(migratedClips.map((clip) => clip.id));
  const now = Date.now();
  const migratedTransitions: LabSession['transitions'] = (
    Array.isArray(sourceSession.transitions) ? sourceSession.transitions : []
  )
    .map((transition, index) => ({
      id: String(transition.id || `lab_transition_${index}`).trim() || `lab_transition_${index}`,
      kind: resolveTransitionKind(transition.kind),
      fromClipId: String(transition.fromClipId || '').trim(),
      toClipId: String(transition.toClipId || '').trim(),
      durationMs: Math.max(0, Math.round(Number(transition.durationMs || 0))),
      easing: resolveTransitionEasing(transition.easing),
      enabled: transition.enabled !== false,
      createdAt: Number.isFinite(transition.createdAt) ? Number(transition.createdAt) : now,
      updatedAt: Number.isFinite(transition.updatedAt) ? Number(transition.updatedAt) : now,
    }))
    .filter((transition) => (
      Boolean(transition.fromClipId)
      && Boolean(transition.toClipId)
      && transition.fromClipId !== transition.toClipId
      && validClipIds.has(transition.fromClipId)
      && validClipIds.has(transition.toClipId)
    ));

  const rawCanvas = sourceSession.canvas;
  const safeWidth = Math.max(1, Math.round(Number(rawCanvas?.width || 1080)));
  const safeHeight = Math.max(1, Math.round(Number(rawCanvas?.height || 1920)));
  const resolvedPreset = getLabCanvasPreset(String(rawCanvas?.presetId || DEFAULT_LAB_CANVAS_PRESET_ID));
  const isCustomCanvas = rawCanvas?.isCustom === true || String(rawCanvas?.presetId || '').trim().toLowerCase() === 'custom';
  const migratedCanvas: LabSession['canvas'] = {
    presetId: isCustomCanvas ? 'custom' : resolvedPreset.id,
    label: String(rawCanvas?.label || (isCustomCanvas ? 'Custom' : resolvedPreset.label)),
    width: safeWidth,
    height: safeHeight,
    aspectLabel: String(rawCanvas?.aspectLabel || `${safeWidth}:${safeHeight}`),
    background: String(rawCanvas?.background || '#0f172a'),
    isCustom: isCustomCanvas,
    ...(isCustomCanvas
      ? {
          customWidth: Math.max(1, Math.round(Number(rawCanvas?.customWidth || safeWidth))),
          customHeight: Math.max(1, Math.round(Number(rawCanvas?.customHeight || safeHeight))),
        }
      : {}),
  };

  return {
    version: LAB_SNAPSHOT_VERSION,
    session: {
      version: Math.max(1, Math.round(Number(sourceSession.version || 1))),
      canvas: migratedCanvas,
      assets: sourceSession.assets,
      tracks: sourceSession.tracks,
      clips: migratedClips,
      transitions: migratedTransitions,
      transport: {
        playheadMs: Math.max(0, Math.round(Number(sourceSession.transport?.playheadMs || 0))),
        zoomLevel: Number.isFinite(sourceSession.transport?.zoomLevel) ? Number(sourceSession.transport?.zoomLevel) : 1,
        isPlaying: false,
      },
    },
    ...(snapshot.selectedAssetId ? { selectedAssetId: snapshot.selectedAssetId } : {}),
    ...(snapshot.selectedClipId ? { selectedClipId: snapshot.selectedClipId } : {}),
    ...(snapshot.selectedTool ? { selectedTool: snapshot.selectedTool } : {}),
  };
};

export const readLabSessionSnapshot = (): LabSessionSnapshot | null => {
  const snapshot = readStorageJson<LabLegacySessionSnapshot>(STORAGE_KEYS.labSession);
  return migrateLabSessionSnapshot(snapshot);
};

export const persistLabPreferences = (preferences: LabPreferencesSnapshot): void => {
  writeStorageJson(STORAGE_KEYS.labPreferences, preferences);
};

export const readLabPreferences = (): LabPreferencesSnapshot | null => {
  return readStorageJson<LabPreferencesSnapshot>(STORAGE_KEYS.labPreferences);
};

export const persistLabCapabilities = (profile: LabCapabilityProfile): void => {
  writeStorageJson(STORAGE_KEYS.labCapabilities, profile);
};

export const readLabCapabilities = (): LabCapabilityProfile | null => {
  return readStorageJson<LabCapabilityProfile>(STORAGE_KEYS.labCapabilities);
};

export const persistLabRuntimeDefaults = (defaults: LabRuntimeDefaults): void => {
  writeStorageJson(STORAGE_KEYS.labRuntimeDefaults, defaults);
};

export const readLabRuntimeDefaults = (): LabRuntimeDefaults => {
  const stored = readStorageJson<LabRuntimeDefaults>(STORAGE_KEYS.labRuntimeDefaults);
  return stored ? { ...DEFAULT_LAB_RUNTIME_DEFAULTS, ...stored } : { ...DEFAULT_LAB_RUNTIME_DEFAULTS };
};
