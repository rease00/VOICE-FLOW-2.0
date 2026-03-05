import { DubbingClip, DubbingClipboard, DubbingClipLayer } from '../types';

const MIN_CLIP_WINDOW_MS = 240;

const buildClipId = (): string => `clip_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

const cloneClip = (clip: DubbingClip, overrides?: Partial<DubbingClip>): DubbingClip => ({
  ...clip,
  ...overrides,
});

const cloneClipList = (clips: DubbingClip[]): DubbingClip[] => clips.map((clip) => cloneClip(clip));

const clampTrimWindow = (clip: DubbingClip, nextTrimInMs: number, nextTrimOutMs: number): DubbingClip => {
  const safeDuration = Math.max(1, Number(clip.durationMs || 0));
  let trimInMs = Math.max(0, Math.min(nextTrimInMs, safeDuration));
  let trimOutMs = Math.max(trimInMs + MIN_CLIP_WINDOW_MS, Math.min(nextTrimOutMs, safeDuration));
  if (trimOutMs > safeDuration) {
    trimOutMs = safeDuration;
    trimInMs = Math.max(0, trimOutMs - MIN_CLIP_WINDOW_MS);
  }
  if (trimOutMs <= trimInMs) {
    trimOutMs = Math.min(safeDuration, trimInMs + MIN_CLIP_WINDOW_MS);
  }
  return cloneClip(clip, { trimInMs, trimOutMs });
};

export const createTimelineSnapshot = (clips: DubbingClip[]): DubbingClip[] => cloneClipList(clips);

export const pushUndoHistory = (
  past: DubbingClip[][],
  current: DubbingClip[],
  maxEntries: number = 40
): DubbingClip[][] => {
  const next = [...past, createTimelineSnapshot(current)];
  if (next.length <= maxEntries) return next;
  return next.slice(next.length - maxEntries);
};

export const undoTimeline = (
  past: DubbingClip[][],
  current: DubbingClip[],
  future: DubbingClip[][]
): { past: DubbingClip[][]; current: DubbingClip[]; future: DubbingClip[][]; changed: boolean } => {
  if (past.length <= 0) return { past, current, future, changed: false };
  const previous = createTimelineSnapshot(past[past.length - 1] || []);
  return {
    past: past.slice(0, -1),
    current: previous,
    future: [createTimelineSnapshot(current), ...future],
    changed: true,
  };
};

export const redoTimeline = (
  past: DubbingClip[][],
  current: DubbingClip[],
  future: DubbingClip[][]
): { past: DubbingClip[][]; current: DubbingClip[]; future: DubbingClip[][]; changed: boolean } => {
  if (future.length <= 0) return { past, current, future, changed: false };
  const nextCurrent = createTimelineSnapshot(future[0] || []);
  return {
    past: [...past, createTimelineSnapshot(current)],
    current: nextCurrent,
    future: future.slice(1),
    changed: true,
  };
};

export const removeClip = (
  clips: DubbingClip[],
  clipId: string
): { clips: DubbingClip[]; removed: DubbingClip | null } => {
  const index = clips.findIndex((clip) => clip.id === clipId);
  if (index < 0) return { clips, removed: null };
  const removed = clips[index] || null;
  return {
    clips: [...clips.slice(0, index), ...clips.slice(index + 1)],
    removed,
  };
};

export const cutClip = removeClip;

export const copyClip = (clips: DubbingClip[], clipId: string): DubbingClipboard | null => {
  const clip = clips.find((item) => item.id === clipId);
  if (!clip) return null;
  return {
    clip: cloneClip(clip),
    copiedAt: Date.now(),
  };
};

export const pasteClipAfterSelection = (
  clips: DubbingClip[],
  selectedClipId: string,
  clipboard: DubbingClipboard | null
): { clips: DubbingClip[]; pastedId: string | null } => {
  if (!clipboard?.clip) return { clips, pastedId: null };
  const source = clipboard.clip;
  const pastedId = buildClipId();
  const pastedClip = clampTrimWindow(
    cloneClip(source, {
      id: pastedId,
      status: 'idle',
      jobId: undefined,
      resultUrl: null,
      reportUrl: null,
      error: '',
    }),
    source.trimInMs,
    source.trimOutMs
  );
  const index = clips.findIndex((clip) => clip.id === selectedClipId);
  if (index < 0) {
    return { clips: [...clips, pastedClip], pastedId };
  }
  return {
    clips: [...clips.slice(0, index + 1), pastedClip, ...clips.slice(index + 1)],
    pastedId,
  };
};

export const splitClipAtPlayhead = (
  clips: DubbingClip[],
  clipId: string,
  playheadMs: number
): { clips: DubbingClip[]; splitIds: [string, string] | null } => {
  const index = clips.findIndex((clip) => clip.id === clipId);
  if (index < 0) return { clips, splitIds: null };
  const target = clips[index];
  if (!target) return { clips, splitIds: null };
  const pivotMs = Math.round(playheadMs);
  const minPivot = target.trimInMs + MIN_CLIP_WINDOW_MS;
  const maxPivot = target.trimOutMs - MIN_CLIP_WINDOW_MS;
  if (pivotMs < minPivot || pivotMs > maxPivot) return { clips, splitIds: null };

  const leftId = buildClipId();
  const rightId = buildClipId();
  const leftClip = clampTrimWindow(cloneClip(target, { id: leftId }), target.trimInMs, pivotMs);
  const rightClip = clampTrimWindow(cloneClip(target, { id: rightId }), pivotMs, target.trimOutMs);
  return {
    clips: [...clips.slice(0, index), leftClip, rightClip, ...clips.slice(index + 1)],
    splitIds: [leftId, rightId],
  };
};

export const trimClipWindow = (
  clips: DubbingClip[],
  clipId: string,
  options: { trimInMs?: number; trimOutMs?: number }
): DubbingClip[] => {
  return clips.map((clip) => {
    if (clip.id !== clipId) return clip;
    const nextTrimIn = typeof options.trimInMs === 'number' ? options.trimInMs : clip.trimInMs;
    const nextTrimOut = typeof options.trimOutMs === 'number' ? options.trimOutMs : clip.trimOutMs;
    return clampTrimWindow(clip, nextTrimIn, nextTrimOut);
  });
};

export const moveClipLayer = (clips: DubbingClip[], clipId: string, layer: DubbingClipLayer): DubbingClip[] => {
  return clips.map((clip) => (clip.id === clipId ? cloneClip(clip, { layer }) : clip));
};

export const removeCompletedClips = (clips: DubbingClip[]): DubbingClip[] => {
  return clips.filter((clip) => clip.status !== 'completed');
};

export const clearAllClips = (): DubbingClip[] => [];
