import type {
  LabAsset,
  LabCapabilityProfile,
  LabClip,
  LabJob,
  LabSession,
  LabStageTransform,
  LabTransition,
  LabTransitionEasing,
  LabTransitionKind,
  LabTool,
  LabTrack,
  LabTrackRole,
} from '../../../../types';
import { buildLabCustomCanvasPreset, DEFAULT_LAB_CANVAS_PRESET_ID, getLabCanvasPreset } from './canvasPresets';

const LAB_SESSION_VERSION = 2;
const LAB_HISTORY_LIMIT = 40;
const LAB_TRANSITION_DURATION_DEFAULT_MS = 320;
const LAB_TRANSITION_DURATION_MIN_MS = 80;
const LAB_TRANSITION_DURATION_MAX_MS = 1800;

const TRACK_DEFS: Array<{ id: string; name: string; role: LabTrackRole; color: string }> = [
  { id: 'track_voice', name: 'Voice', role: 'voice', color: 'from-cyan-500 to-sky-500' },
  { id: 'track_music', name: 'Music', role: 'music', color: 'from-fuchsia-500 to-violet-500' },
  { id: 'track_fx', name: 'FX', role: 'fx', color: 'from-amber-500 to-orange-500' },
  { id: 'track_video', name: 'Video', role: 'video', color: 'from-slate-500 to-slate-700' },
  { id: 'track_text', name: 'Text', role: 'text', color: 'from-indigo-500 to-violet-500' },
  { id: 'track_image', name: 'Images', role: 'image', color: 'from-emerald-500 to-teal-500' },
  { id: 'track_element', name: 'Elements', role: 'element', color: 'from-rose-500 to-pink-500' },
  { id: 'track_recording', name: 'Record', role: 'recording', color: 'from-orange-500 to-red-500' },
];

const createTracks = (): LabTrack[] => TRACK_DEFS.map((track) => ({ ...track, muted: false, solo: false }));
const createDefaultCanvas = () => {
  const preset = getLabCanvasPreset(DEFAULT_LAB_CANVAS_PRESET_ID);
  return {
    presetId: preset.id,
    label: preset.label,
    width: preset.width,
    height: preset.height,
    aspectLabel: preset.aspectLabel,
    background: '#0f172a',
    isCustom: false,
  };
};

export const createDefaultStageTransform = (asset?: Pick<LabAsset, 'kind'> | null): LabStageTransform => {
  const kind = String(asset?.kind || '').trim();
  if (kind === 'video' || kind === 'image' || kind === 'recording') {
    return {
      xPercent: 50,
      yPercent: 50,
      widthPercent: kind === 'image' ? 42 : 74,
      heightPercent: kind === 'image' ? 42 : 62,
      scale: 1,
      rotationDeg: 0,
      opacity: 1,
      zIndex: kind === 'video' ? 10 : 40,
      alignX: 'center',
      alignY: 'center',
      snapToCanvas: true,
    };
  }
  if (kind === 'text') {
    return {
      xPercent: 50,
      yPercent: 18,
      widthPercent: 72,
      heightPercent: 18,
      scale: 1,
      rotationDeg: 0,
      opacity: 1,
      zIndex: 70,
      alignX: 'center',
      alignY: 'center',
      snapToCanvas: true,
    };
  }
  if (kind === 'element') {
    return {
      xPercent: 50,
      yPercent: 82,
      widthPercent: 70,
      heightPercent: 14,
      scale: 1,
      rotationDeg: 0,
      opacity: 0.94,
      zIndex: 30,
      alignX: 'center',
      alignY: 'center',
      snapToCanvas: true,
    };
  }
  return {
    xPercent: 50,
    yPercent: 50,
    widthPercent: 56,
    heightPercent: 18,
    scale: 1,
    rotationDeg: 0,
    opacity: 1,
    zIndex: 20,
    alignX: 'center',
    alignY: 'center',
    snapToCanvas: true,
  };
};

const cloneSession = (session: LabSession): LabSession => ({
  version: session.version,
  canvas: {
    ...createDefaultCanvas(),
    ...(session.canvas || {}),
    isCustom: session.canvas?.isCustom === true,
    ...(session.canvas?.isCustom
      ? {
          customWidth: Math.max(1, Math.round(Number(session.canvas.customWidth || session.canvas.width || 1080))),
          customHeight: Math.max(1, Math.round(Number(session.canvas.customHeight || session.canvas.height || 1920))),
        }
      : {}),
  },
  assets: session.assets.map((asset) => ({
    ...asset,
    stageTransform: { ...createDefaultStageTransform(asset), ...(asset.stageTransform || {}) },
    ...(asset.textStyle ? { textStyle: { ...asset.textStyle } } : {}),
    ...(asset.elementStyle ? { elementStyle: { ...asset.elementStyle } } : {}),
    ...(asset.waveform ? { waveform: { ...asset.waveform, coarse: [...asset.waveform.coarse], detail: [...asset.waveform.detail] } } : {}),
  })),
  tracks: session.tracks.map((track) => ({ ...track })),
  clips: session.clips.map((clip, index) => {
    const rowId = String(clip.timelineRowId || clip.trackId || `lab_row_${index}`).trim() || `lab_row_${index}`;
    return {
      ...clip,
      trackId: String(clip.trackId || rowId).trim() || rowId,
      timelineRowId: rowId,
      layerOrder: Number.isFinite(clip.layerOrder) ? clip.layerOrder : index,
      insertedAtPlayheadMs: Number.isFinite(clip.insertedAtPlayheadMs) ? clip.insertedAtPlayheadMs : clip.startMs,
      stageTransform: { ...createDefaultStageTransform(null), ...(clip.stageTransform || {}) },
    };
  }),
  transitions: (session.transitions || []).map((transition) => ({
    ...transition,
    durationMs: Math.max(0, Math.round(Number(transition.durationMs || 0))),
    enabled: transition.enabled !== false,
  })),
  transport: { ...session.transport },
});

const nowId = (prefix: string): string => `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

export interface LabState {
  session: LabSession;
  selectedAssetId: string;
  selectedClipId: string;
  activeTool: LabTool;
  capabilities: LabCapabilityProfile | null;
  job: LabJob | null;
  historyPast: LabSession[];
  historyFuture: LabSession[];
}

export type LabStateAction =
  | { type: 'hydrate'; session: LabSession; selectedAssetId?: string; selectedClipId?: string; activeTool?: LabTool }
  | { type: 'set-capabilities'; capabilities: LabCapabilityProfile }
  | { type: 'set-job'; job: LabJob | null }
  | { type: 'set-active-tool'; tool: LabTool }
  | { type: 'set-canvas-preset'; presetId: string }
  | { type: 'set-canvas-custom'; width: number; height: number; label?: string }
  | { type: 'set-canvas-background'; background: string }
  | { type: 'set-playhead'; playheadMs: number }
  | { type: 'set-zoom'; zoomLevel: number }
  | { type: 'set-selected-asset'; assetId: string }
  | { type: 'set-selected-clip'; clipId: string }
  | { type: 'add-asset'; asset: LabAsset; clip?: LabClip }
  | { type: 'update-asset'; assetId: string; patch: Partial<LabAsset> }
  | { type: 'remove-asset'; assetId: string }
  | { type: 'add-clip'; clip: LabClip }
  | { type: 'duplicate-selected-clip' }
  | { type: 'split-selected-clip' }
  | { type: 'delete-selected-clip' }
  | { type: 'set-selected-clip-start'; startMs: number }
  | { type: 'set-selected-clip-trim-start'; trimStartMs: number }
  | { type: 'set-selected-clip-trim-end'; trimEndMs: number }
  | { type: 'patch-selected-clip'; patch: Partial<LabClip> }
  | { type: 'move-clip'; clipId: string; targetRowId: string; startMs: number; targetLayerOrder?: number }
  | {
      type: 'add-transition';
      fromClipId: string;
      toClipId: string;
      kind: LabTransitionKind;
      durationMs?: number;
      easing?: LabTransitionEasing;
    }
  | { type: 'update-transition'; transitionId: string; patch: Partial<LabTransition> }
  | { type: 'remove-transition'; transitionId: string }
  | { type: 'move-clip-row'; sourceRowId: string; targetRowId: string }
  | { type: 'undo' }
  | { type: 'redo' };

export const createInitialLabSession = (): LabSession => ({
  version: LAB_SESSION_VERSION,
  canvas: createDefaultCanvas(),
  assets: [],
  tracks: createTracks(),
  clips: [],
  transitions: [],
  transport: {
    playheadMs: 0,
    zoomLevel: 1,
    isPlaying: false,
  },
});

export const createInitialLabState = (): LabState => ({
  session: createInitialLabSession(),
  selectedAssetId: '',
  selectedClipId: '',
  activeTool: 'inspect',
  capabilities: null,
  job: null,
  historyPast: [],
  historyFuture: [],
});

export const getTrackByRole = (session: LabSession, role: LabTrackRole): LabTrack => (
  session.tracks.find((track) => track.role === role) || session.tracks[0] || createTracks()[0]!
);

export const getClipDurationMs = (clip: Pick<LabClip, 'trimStartMs' | 'trimEndMs' | 'playbackRate' | 'pitchSemitones'>): number => {
  const baseDuration = Math.max(50, clip.trimEndMs - clip.trimStartMs);
  const playbackMultiplier = Math.max(0.25, clip.playbackRate || 1);
  const pitchRate = Math.pow(2, (clip.pitchSemitones || 0) / 12);
  return Math.max(50, Math.round(baseDuration / (playbackMultiplier * pitchRate)));
};

const getTrackTailMs = (session: LabSession, trackId: string): number => {
  const clips = session.clips.filter((clip) => clip.trackId === trackId);
  return clips.reduce((max, clip) => Math.max(max, clip.startMs + getClipDurationMs(clip)), 0);
};

const getNextLayerOrder = (session: LabSession): number => (
  session.clips.reduce((max, clip) => Math.max(max, Number.isFinite(clip.layerOrder) ? clip.layerOrder : 0), -1) + 1
);

export const createLabClip = (asset: LabAsset, trackId: string, startMs?: number): LabClip => {
  const createdAt = Date.now();
  const safeTrackId = String(trackId || '').trim() || nowId('lab_row');
  return {
    id: nowId('lab_clip'),
    assetId: asset.id,
    trackId: safeTrackId,
    timelineRowId: safeTrackId,
    layerOrder: 0,
    insertedAtPlayheadMs: Math.max(0, Math.round(startMs || 0)),
    label: asset.name,
    startMs: Math.max(0, Math.round(startMs || 0)),
    trimStartMs: 0,
    trimEndMs: Math.max(100, Math.round(asset.durationMs || 1000)),
    gain: 1,
    muted: false,
    solo: false,
    playbackRate: 1,
    pitchSemitones: 0,
    fadeInMs: 0,
    fadeOutMs: 0,
    normalize: false,
    eqPreset: 'flat',
    denoiseAmount: 0,
    enabled: true,
    visible: true,
    stageTransform: { ...createDefaultStageTransform(asset), ...(asset.stageTransform || {}) },
    createdAt,
    updatedAt: createdAt,
  };
};

export const defaultTrackRoleForAsset = (asset: Pick<LabAsset, 'kind' | 'name'>): LabTrackRole => {
  if (asset.kind === 'text') return 'text';
  if (asset.kind === 'image') return 'image';
  if (asset.kind === 'element') return 'element';
  if (asset.kind === 'recording') return 'recording';
  if (asset.kind === 'video') return 'video';
  if (asset.kind === 'tts') return 'voice';
  const name = asset.name.toLowerCase();
  if (name.includes('music') || name.includes('bgm')) return 'music';
  if (name.includes('fx') || name.includes('sfx')) return 'fx';
  return 'voice';
};

export const chooseTrackForAsset = (session: LabSession, asset: Pick<LabAsset, 'kind' | 'name'>): LabTrack => {
  const role = defaultTrackRoleForAsset(asset);
  return getTrackByRole(session, role);
};

export const insertAssetWithClip = (session: LabSession, asset: LabAsset, clip?: LabClip): LabSession => {
  const next = cloneSession(session);
  next.assets.push(asset);
  if (clip) {
    next.clips.push(clip);
  }
  return next;
};

export const updateAsset = (session: LabSession, assetId: string, patch: Partial<LabAsset>): LabSession => ({
  ...cloneSession(session),
  assets: session.assets.map((asset) => (asset.id === assetId ? { ...asset, ...patch } : asset)),
});

export const removeAssetAndLinkedClips = (session: LabSession, assetId: string): LabSession => {
  const next = cloneSession(session);
  next.assets = next.assets.filter((asset) => asset.id !== assetId);
  next.clips = next.clips.filter((clip) => clip.assetId !== assetId);
  next.transitions = normalizeSessionTransitions(next);
  if (next.transport.playheadMs > getSessionDurationMs(next)) {
    next.transport.playheadMs = getSessionDurationMs(next);
  }
  return next;
};

export const getSessionDurationMs = (session: LabSession): number => {
  return session.clips.reduce((max, clip) => Math.max(max, clip.startMs + getClipDurationMs(clip)), 0);
};

const resolveTransitionKind = (value: unknown): LabTransitionKind => {
  const token = String(value || '').trim().toLowerCase();
  if (token === 'cut') return 'cut';
  if (token === 'fade') return 'fade';
  if (token === 'wipe') return 'wipe';
  if (token === 'slide') return 'slide';
  return 'crossfade';
};

const resolveTransitionEasing = (value: unknown): LabTransitionEasing => {
  const token = String(value || '').trim().toLowerCase();
  if (token === 'linear') return 'linear';
  if (token === 'ease_in') return 'ease_in';
  if (token === 'ease_out') return 'ease_out';
  return 'ease_in_out';
};

const resolveTransitionDurationMs = (
  session: LabSession,
  fromClipId: string,
  toClipId: string,
  kind: LabTransitionKind,
  value: unknown
): number => {
  if (kind === 'cut') return 0;
  const fromClip = session.clips.find((clip) => clip.id === fromClipId);
  const toClip = session.clips.find((clip) => clip.id === toClipId);
  if (!fromClip || !toClip) return LAB_TRANSITION_DURATION_DEFAULT_MS;
  const fromDuration = getClipDurationMs(fromClip);
  const toDuration = getClipDurationMs(toClip);
  const gapMs = Math.max(0, toClip.startMs - (fromClip.startMs + fromDuration));
  const maxDuration = Math.max(
    LAB_TRANSITION_DURATION_MIN_MS,
    Math.min(
      LAB_TRANSITION_DURATION_MAX_MS,
      Math.round(Math.min(fromDuration, toDuration, Math.max(LAB_TRANSITION_DURATION_MIN_MS, gapMs + Math.min(fromDuration, toDuration) * 0.45)))
    )
  );
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return Math.min(maxDuration, LAB_TRANSITION_DURATION_DEFAULT_MS);
  }
  return Math.max(LAB_TRANSITION_DURATION_MIN_MS, Math.min(maxDuration, Math.round(parsed)));
};

const normalizeSessionTransitions = (session: LabSession): LabTransition[] => {
  const validClipIds = new Set(session.clips.map((clip) => clip.id));
  return (session.transitions || [])
    .filter((transition) => validClipIds.has(transition.fromClipId) && validClipIds.has(transition.toClipId))
    .map((transition) => {
      const kind = resolveTransitionKind(transition.kind);
      const easing = resolveTransitionEasing(transition.easing);
      return {
        ...transition,
        kind,
        easing,
        durationMs: resolveTransitionDurationMs(session, transition.fromClipId, transition.toClipId, kind, transition.durationMs),
        enabled: transition.enabled !== false,
      };
    });
};

export const duplicateClip = (session: LabSession, clipId: string): { session: LabSession; duplicatedId: string | null } => {
  const next = cloneSession(session);
  const clip = next.clips.find((item) => item.id === clipId);
  if (!clip) return { session: next, duplicatedId: null };
  const duplicatedId = nowId('lab_clip');
  const duplicated = {
    ...clip,
    id: duplicatedId,
    startMs: clip.startMs + getClipDurationMs(clip) + 150,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  next.clips.push(duplicated);
  return { session: next, duplicatedId };
};

export const splitClipAtPlayhead = (session: LabSession, clipId: string, playheadMs: number): { session: LabSession; nextSelectedId: string | null } => {
  const next = cloneSession(session);
  const index = next.clips.findIndex((clip) => clip.id === clipId);
  if (index < 0) return { session: next, nextSelectedId: null };
  const clip = next.clips[index]!;
  const clipStart = clip.startMs;
  const clipEnd = clip.startMs + getClipDurationMs(clip);
  if (playheadMs <= clipStart + 50 || playheadMs >= clipEnd - 50) return { session: next, nextSelectedId: null };

  const relativeMs = playheadMs - clipStart;
  const speedFactor = Math.max(0.25, clip.playbackRate) * Math.pow(2, clip.pitchSemitones / 12);
  const trimSplitMs = clip.trimStartMs + Math.round(relativeMs * speedFactor);
  if (trimSplitMs <= clip.trimStartMs + 50 || trimSplitMs >= clip.trimEndMs - 50) return { session: next, nextSelectedId: null };

  const nextId = nowId('lab_clip');
  const firstHalf: LabClip = {
    ...clip,
    trimEndMs: trimSplitMs,
    updatedAt: Date.now(),
  };
  const secondHalf: LabClip = {
    ...clip,
    id: nextId,
    startMs: playheadMs,
    trimStartMs: trimSplitMs,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  next.clips.splice(index, 1, firstHalf, secondHalf);
  return { session: next, nextSelectedId: nextId };
};

export const patchClip = (session: LabSession, clipId: string, patch: Partial<LabClip>): LabSession => ({
  ...cloneSession(session),
  clips: session.clips.map((clip) => {
    if (clip.id !== clipId) return clip;
    const trimStartMs = patch.trimStartMs ?? clip.trimStartMs;
    const trimEndMs = patch.trimEndMs ?? clip.trimEndMs;
    const boundedTrimStart = Math.max(0, Math.min(trimStartMs, trimEndMs - 50));
    const boundedTrimEnd = Math.max(boundedTrimStart + 50, trimEndMs);
    const nextStageTransform = patch.stageTransform
      ? {
          ...clip.stageTransform,
          ...patch.stageTransform,
        }
      : clip.stageTransform;
    return {
      ...clip,
      ...patch,
      trimStartMs: boundedTrimStart,
      trimEndMs: boundedTrimEnd,
      stageTransform: nextStageTransform,
      updatedAt: Date.now(),
    };
  }),
});

export const moveClip = (
  session: LabSession,
  clipId: string,
  targetRowId: string,
  startMs: number,
  targetLayerOrder?: number
): LabSession => {
  const safeClipId = String(clipId || '').trim();
  const safeRowId = String(targetRowId || '').trim();
  if (!safeClipId || !safeRowId) return cloneSession(session);
  const next = cloneSession(session);
  const clip = next.clips.find((item) => item.id === safeClipId);
  if (!clip) return next;

  const targetRowClip = next.clips.find((item) => item.timelineRowId === safeRowId && item.id !== safeClipId);
  const resolvedLayerOrder = Number.isFinite(targetLayerOrder)
    ? Math.max(0, Math.round(Number(targetLayerOrder)))
    : Number.isFinite(targetRowClip?.layerOrder)
      ? Math.max(0, Math.round(Number(targetRowClip?.layerOrder)))
      : Math.max(0, Math.round(Number(clip.layerOrder || 0)));
  const resolvedZIndex = Number.isFinite(targetRowClip?.stageTransform?.zIndex)
    ? Number(targetRowClip?.stageTransform?.zIndex)
    : clip.stageTransform?.zIndex;
  const resolvedStartMs = Math.max(0, Math.round(Number(startMs || 0)));

  clip.timelineRowId = safeRowId;
  clip.trackId = safeRowId;
  clip.layerOrder = resolvedLayerOrder;
  clip.startMs = resolvedStartMs;
  clip.insertedAtPlayheadMs = resolvedStartMs;
  clip.stageTransform = {
    ...clip.stageTransform,
    ...(Number.isFinite(resolvedZIndex) ? { zIndex: Number(resolvedZIndex) } : {}),
  };
  clip.updatedAt = Date.now();

  // Transitions are adjacency-based; moving a clip invalidates existing pair assumptions.
  next.transitions = normalizeSessionTransitions({
    ...next,
    transitions: next.transitions.filter((transition) => transition.fromClipId !== safeClipId && transition.toClipId !== safeClipId),
  });
  return next;
};

export const removeClip = (session: LabSession, clipId: string): LabSession => ({
  ...(() => {
    const next = cloneSession(session);
    next.clips = next.clips.filter((clip) => clip.id !== clipId);
    next.transitions = normalizeSessionTransitions(next);
    return next;
  })(),
});

export const moveClipRow = (session: LabSession, sourceRowId: string, targetRowId: string): LabSession => {
  const safeSource = String(sourceRowId || '').trim();
  const safeTarget = String(targetRowId || '').trim();
  if (!safeSource || !safeTarget || safeSource === safeTarget) {
    return cloneSession(session);
  }
  const rowOrder = Array.from(
    new Map(
      [...session.clips]
        .sort((left, right) => {
          const layerDelta = left.layerOrder - right.layerOrder;
          if (layerDelta !== 0) return layerDelta;
          return left.createdAt - right.createdAt;
        })
        .map((clip) => [clip.timelineRowId, clip.layerOrder])
    ).keys()
  );
  const sourceIndex = rowOrder.indexOf(safeSource);
  const targetIndex = rowOrder.indexOf(safeTarget);
  if (sourceIndex < 0 || targetIndex < 0) {
    return cloneSession(session);
  }
  const nextOrder = [...rowOrder];
  const [moved] = nextOrder.splice(sourceIndex, 1);
  nextOrder.splice(targetIndex, 0, moved!);
  return {
    ...cloneSession(session),
    clips: session.clips.map((clip) => {
      const rowIndex = nextOrder.indexOf(clip.timelineRowId);
      const nextLayerOrder = rowIndex < 0 ? clip.layerOrder : rowIndex;
      return {
        ...clip,
        layerOrder: nextLayerOrder,
        stageTransform: {
          ...clip.stageTransform,
          zIndex: 10 + ((nextOrder.length - rowIndex) * 10),
        },
      };
    }),
  };
};

const pushHistory = (past: LabSession[], snapshot: LabSession): LabSession[] => {
  const nextPast = [...past, cloneSession(snapshot)];
  return nextPast.length > LAB_HISTORY_LIMIT ? nextPast.slice(nextPast.length - LAB_HISTORY_LIMIT) : nextPast;
};

const commitSessionChange = (
  state: LabState,
  mutator: (session: LabSession) => LabSession,
  options?: { selectedAssetId?: string; selectedClipId?: string }
): LabState => {
  const nextSession = mutator(state.session);
  return {
    ...state,
    session: nextSession,
    historyPast: pushHistory(state.historyPast, state.session),
    historyFuture: [],
    selectedAssetId: options?.selectedAssetId ?? state.selectedAssetId,
    selectedClipId: options?.selectedClipId ?? state.selectedClipId,
  };
};

export const labReducer = (state: LabState, action: LabStateAction): LabState => {
  switch (action.type) {
    case 'hydrate':
      return {
        ...state,
        session: cloneSession(action.session),
        selectedAssetId: action.selectedAssetId || '',
        selectedClipId: action.selectedClipId || '',
        activeTool: action.activeTool || state.activeTool,
        historyPast: [],
        historyFuture: [],
      };
    case 'set-capabilities':
      return { ...state, capabilities: action.capabilities };
    case 'set-job':
      return { ...state, job: action.job };
    case 'set-active-tool':
      return { ...state, activeTool: action.tool };
    case 'set-canvas-preset':
      return commitSessionChange(state, (session) => {
        const preset = getLabCanvasPreset(action.presetId);
        const { customWidth: _customWidth, customHeight: _customHeight, ...baseCanvas } = session.canvas;
        return {
          ...cloneSession(session),
          canvas: {
            ...baseCanvas,
            presetId: preset.id,
            label: preset.label,
            width: preset.width,
            height: preset.height,
            aspectLabel: preset.aspectLabel,
            isCustom: false,
          },
        };
      });
    case 'set-canvas-custom':
      return commitSessionChange(state, (session) => {
        const customPreset = buildLabCustomCanvasPreset(action.width, action.height, action.label || 'Custom');
        return {
          ...cloneSession(session),
          canvas: {
            ...session.canvas,
            presetId: 'custom',
            label: customPreset.label,
            width: customPreset.width,
            height: customPreset.height,
            aspectLabel: customPreset.aspectLabel,
            isCustom: true,
            customWidth: customPreset.width,
            customHeight: customPreset.height,
          },
        };
      });
    case 'set-canvas-background':
      return commitSessionChange(state, (session) => ({
        ...cloneSession(session),
        canvas: {
          ...session.canvas,
          background: action.background,
        },
      }));
    case 'set-playhead':
      return {
        ...state,
        session: {
          ...state.session,
          transport: {
            ...state.session.transport,
            playheadMs: Math.max(0, Math.round(action.playheadMs)),
          },
        },
      };
    case 'set-zoom':
      return {
        ...state,
        session: {
          ...state.session,
          transport: {
            ...state.session.transport,
            zoomLevel: Math.max(0.5, Math.min(6, action.zoomLevel)),
          },
        },
      };
    case 'set-selected-asset':
      return { ...state, selectedAssetId: action.assetId };
    case 'set-selected-clip':
      return { ...state, selectedClipId: action.clipId };
    case 'add-asset':
      return commitSessionChange(
        state,
        (session) => insertAssetWithClip(session, action.asset, action.clip),
        {
          selectedAssetId: action.asset.id,
          selectedClipId: action.clip?.id || state.selectedClipId,
        }
      );
    case 'update-asset':
      return commitSessionChange(state, (session) => updateAsset(session, action.assetId, action.patch));
    case 'remove-asset': {
      const nextSelectedClipId = state.selectedClipId && state.session.clips.some((clip) => clip.id === state.selectedClipId && clip.assetId === action.assetId)
        ? ''
        : state.selectedClipId;
      const nextSelectedAssetId = state.selectedAssetId === action.assetId ? '' : state.selectedAssetId;
      return commitSessionChange(state, (session) => removeAssetAndLinkedClips(session, action.assetId), {
        selectedAssetId: nextSelectedAssetId,
        selectedClipId: nextSelectedClipId,
      });
    }
    case 'add-clip':
      return commitSessionChange(state, (session) => {
        const next = cloneSession(session);
        next.clips.push(action.clip);
        return next;
      }, { selectedClipId: action.clip.id });
    case 'duplicate-selected-clip': {
      if (!state.selectedClipId) return state;
      const duplicated = duplicateClip(state.session, state.selectedClipId);
      return commitSessionChange(state, () => duplicated.session, { selectedClipId: duplicated.duplicatedId || state.selectedClipId });
    }
    case 'split-selected-clip': {
      if (!state.selectedClipId) return state;
      const split = splitClipAtPlayhead(state.session, state.selectedClipId, state.session.transport.playheadMs);
      return commitSessionChange(state, () => split.session, { selectedClipId: split.nextSelectedId || state.selectedClipId });
    }
    case 'delete-selected-clip': {
      if (!state.selectedClipId) return state;
      const nextSession = removeClip(state.session, state.selectedClipId);
      const nextSelectedClipId = nextSession.clips[0]?.id || '';
      return commitSessionChange(state, () => nextSession, { selectedClipId: nextSelectedClipId });
    }
    case 'set-selected-clip-start':
      if (!state.selectedClipId) return state;
      return commitSessionChange(state, (session) => patchClip(session, state.selectedClipId, { startMs: Math.max(0, action.startMs) }));
    case 'set-selected-clip-trim-start':
      if (!state.selectedClipId) return state;
      return commitSessionChange(state, (session) => patchClip(session, state.selectedClipId, { trimStartMs: action.trimStartMs }));
    case 'set-selected-clip-trim-end':
      if (!state.selectedClipId) return state;
      return commitSessionChange(state, (session) => patchClip(session, state.selectedClipId, { trimEndMs: action.trimEndMs }));
    case 'patch-selected-clip':
      if (!state.selectedClipId) return state;
      return commitSessionChange(state, (session) => patchClip(session, state.selectedClipId, action.patch));
    case 'move-clip':
      return commitSessionChange(state, (session) => moveClip(
        session,
        action.clipId,
        action.targetRowId,
        action.startMs,
        action.targetLayerOrder
      ));
    case 'add-transition':
      return commitSessionChange(state, (session) => {
        const next = cloneSession(session);
        const fromClip = next.clips.find((clip) => clip.id === action.fromClipId);
        const toClip = next.clips.find((clip) => clip.id === action.toClipId);
        if (!fromClip || !toClip || fromClip.id === toClip.id) return next;
        const orderedPair = [fromClip, toClip].sort((left, right) => left.startMs - right.startMs);
        const fromClipId = orderedPair[0]!.id;
        const toClipId = orderedPair[1]!.id;
        const kind = resolveTransitionKind(action.kind);
        const transition: LabTransition = {
          id: nowId('lab_transition'),
          kind,
          fromClipId,
          toClipId,
          durationMs: resolveTransitionDurationMs(next, fromClipId, toClipId, kind, action.durationMs),
          easing: resolveTransitionEasing(action.easing),
          enabled: true,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };
        next.transitions = [
          ...next.transitions.filter((item) => !(item.fromClipId === fromClipId && item.toClipId === toClipId)),
          transition,
        ];
        next.transitions = normalizeSessionTransitions(next);
        return next;
      });
    case 'update-transition':
      return commitSessionChange(state, (session) => {
        const next = cloneSession(session);
        next.transitions = next.transitions.map((transition) => {
          if (transition.id !== action.transitionId) return transition;
          const kind = resolveTransitionKind(action.patch.kind ?? transition.kind);
          const fromClipId = String(action.patch.fromClipId || transition.fromClipId);
          const toClipId = String(action.patch.toClipId || transition.toClipId);
          return {
            ...transition,
            ...action.patch,
            kind,
            fromClipId,
            toClipId,
            easing: resolveTransitionEasing(action.patch.easing ?? transition.easing),
            durationMs: resolveTransitionDurationMs(
              next,
              fromClipId,
              toClipId,
              kind,
              action.patch.durationMs ?? transition.durationMs
            ),
            enabled: action.patch.enabled ?? transition.enabled,
            updatedAt: Date.now(),
          };
        });
        next.transitions = normalizeSessionTransitions(next);
        return next;
      });
    case 'remove-transition':
      return commitSessionChange(state, (session) => {
        const next = cloneSession(session);
        next.transitions = next.transitions.filter((transition) => transition.id !== action.transitionId);
        return next;
      });
    case 'move-clip-row':
      return commitSessionChange(state, (session) => moveClipRow(session, action.sourceRowId, action.targetRowId));
    case 'undo': {
      const previous = state.historyPast[state.historyPast.length - 1];
      if (!previous) return state;
      return {
        ...state,
        session: cloneSession(previous),
        historyPast: state.historyPast.slice(0, -1),
        historyFuture: [cloneSession(state.session), ...state.historyFuture],
        selectedAssetId: state.selectedAssetId && previous.assets.some((asset) => asset.id === state.selectedAssetId) ? state.selectedAssetId : '',
        selectedClipId: state.selectedClipId && previous.clips.some((clip) => clip.id === state.selectedClipId) ? state.selectedClipId : '',
      };
    }
    case 'redo': {
      const next = state.historyFuture[0];
      if (!next) return state;
      return {
        ...state,
        session: cloneSession(next),
        historyPast: pushHistory(state.historyPast, state.session),
        historyFuture: state.historyFuture.slice(1),
        selectedAssetId: state.selectedAssetId && next.assets.some((asset) => asset.id === state.selectedAssetId) ? state.selectedAssetId : '',
        selectedClipId: state.selectedClipId && next.clips.some((clip) => clip.id === state.selectedClipId) ? state.selectedClipId : '',
      };
    }
    default:
      return state;
  }
};

export const buildClipForAsset = (session: LabSession, asset: LabAsset): LabClip => {
  const track = chooseTrackForAsset(session, asset);
  const usesIndependentLayerRow = (
    asset.kind === 'video'
    || asset.kind === 'image'
    || asset.kind === 'text'
    || asset.kind === 'element'
    || asset.kind === 'recording'
  );
  const rowId = usesIndependentLayerRow ? nowId('lab_row') : track.id;
  const startMs = Math.max(0, Math.round(session.transport.playheadMs || getTrackTailMs(session, track.id)));
  const rowLayerOrder = session.clips.find((clip) => clip.timelineRowId === rowId)?.layerOrder;
  const layerOrder = Number.isFinite(rowLayerOrder) ? Number(rowLayerOrder) : getNextLayerOrder(session);
  return {
    ...createLabClip(asset, rowId, startMs),
    layerOrder,
    stageTransform: {
      ...createDefaultStageTransform(asset),
      ...asset.stageTransform,
      zIndex: 10 + ((layerOrder + 1) * 10),
    },
  };
};
