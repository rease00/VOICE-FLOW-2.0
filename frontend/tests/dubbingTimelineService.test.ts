import { describe, expect, it } from 'vitest';

import type { DubbingClip } from '../types';
import {
  copyClip,
  cutClip,
  moveClipLayer,
  pasteClipAfterSelection,
  redoTimeline,
  removeCompletedClips,
  removeClip,
  splitClipAtPlayhead,
  trimClipWindow,
  undoTimeline,
  pushUndoHistory,
} from '../services/dubbingTimelineService';

const buildClip = (id: string, status: DubbingClip['status'] = 'idle'): DubbingClip => ({
  id,
  file: new File(['00'], `${id}.mp4`, { type: 'video/mp4' }),
  objectUrl: `blob:${id}`,
  durationMs: 10_000,
  trimInMs: 0,
  trimOutMs: 10_000,
  layer: 'V1',
  script: '',
  status,
  jobId: '',
  resultUrl: null,
  reportUrl: null,
  error: '',
});

describe('dubbing timeline service', () => {
  it('supports cut/copy/paste/remove operations', () => {
    const clips = [buildClip('a'), buildClip('b')];
    const copied = copyClip(clips, 'a');
    expect(copied?.clip.id).toBe('a');

    const cut = cutClip(clips, 'b');
    expect(cut.clips.map((clip) => clip.id)).toEqual(['a']);

    const pasted = pasteClipAfterSelection(cut.clips, 'a', copied);
    expect(pasted.clips).toHaveLength(2);
    expect(pasted.pastedId).not.toBe('a');

    const removed = removeClip(pasted.clips, String(pasted.pastedId));
    expect(removed.clips.map((clip) => clip.id)).toEqual(['a']);
  });

  it('supports split trim and layer changes', () => {
    const clips = [buildClip('x')];
    const split = splitClipAtPlayhead(clips, 'x', 5000);
    expect(split.splitIds).not.toBeNull();
    expect(split.clips).toHaveLength(2);

    const leftId = String(split.splitIds?.[0]);
    const trimmed = trimClipWindow(split.clips, leftId, { trimInMs: 200, trimOutMs: 4200 });
    const left = trimmed.find((clip) => clip.id === leftId);
    expect(left?.trimInMs).toBe(200);
    expect((left?.trimOutMs || 0) - (left?.trimInMs || 0)).toBeGreaterThanOrEqual(240);

    const layered = moveClipLayer(trimmed, leftId, 'V2');
    expect(layered.find((clip) => clip.id === leftId)?.layer).toBe('V2');
  });

  it('supports undo and redo timeline history', () => {
    const initial = [buildClip('a'), buildClip('b')];
    const afterRemove = [buildClip('a')];
    const past = pushUndoHistory([], initial);

    const undone = undoTimeline(past, afterRemove, []);
    expect(undone.changed).toBe(true);
    expect(undone.current.map((clip) => clip.id)).toEqual(['a', 'b']);

    const redone = redoTimeline(undone.past, undone.current, undone.future);
    expect(redone.changed).toBe(true);
    expect(redone.current.map((clip) => clip.id)).toEqual(['a']);
  });

  it('removes completed clips', () => {
    const clips = [buildClip('a', 'completed'), buildClip('b', 'running')];
    const next = removeCompletedClips(clips);
    expect(next.map((clip) => clip.id)).toEqual(['b']);
  });
});
