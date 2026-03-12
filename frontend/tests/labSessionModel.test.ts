import { describe, expect, it } from 'vitest';

import type { LabAsset } from '../types';
import {
  buildClipForAsset,
  createDefaultStageTransform,
  createInitialLabState,
  getClipDurationMs,
  labReducer,
} from '../src/features/lab/model/session';
import { LAB_CANVAS_DIMENSION_LIMITS } from '../src/features/lab/model/canvasPresets';

const createAudioAsset = (overrides?: Partial<LabAsset>): LabAsset => ({
  id: 'asset_voice_1',
  kind: 'audio',
  name: 'voice_take.wav',
  mimeType: 'audio/wav',
  sizeBytes: 4096,
  durationMs: 10_000,
  channelCount: 2,
  sampleRate: 44_100,
  createdAt: 1,
  ...overrides,
});

describe('lab session reducer', () => {
  it('imports an asset with a timeline clip and updates selection', () => {
    const initial = createInitialLabState();
    const asset = createAudioAsset();
    const clip = buildClipForAsset(initial.session, asset);

    const next = labReducer(initial, { type: 'add-asset', asset, clip });

    expect(next.session.assets).toHaveLength(1);
    expect(next.session.clips).toHaveLength(1);
    expect(next.selectedAssetId).toBe(asset.id);
    expect(next.selectedClipId).toBe(clip.id);
    expect(next.session.clips[0]?.timelineRowId).toBeTruthy();
  });

  it('supports duplicate, split, delete, undo, and redo flows', () => {
    const initial = createInitialLabState();
    const asset = createAudioAsset();
    const baseClip = buildClipForAsset(initial.session, asset);
    const imported = labReducer(initial, { type: 'add-asset', asset, clip: baseClip });
    const selected = labReducer(imported, { type: 'set-selected-clip', clipId: baseClip.id });
    const duplicated = labReducer(selected, { type: 'duplicate-selected-clip' });

    expect(duplicated.session.clips).toHaveLength(2);

    const clipForSplit = duplicated.session.clips[0];
    expect(clipForSplit).toBeDefined();

    const withPlayhead = labReducer(duplicated, {
      type: 'set-playhead',
      playheadMs: Math.round((clipForSplit?.startMs || 0) + (getClipDurationMs(clipForSplit!) / 2)),
    });
    const selectedForSplit = labReducer(withPlayhead, {
      type: 'set-selected-clip',
      clipId: clipForSplit?.id || '',
    });
    const split = labReducer(selectedForSplit, { type: 'split-selected-clip' });

    expect(split.session.clips).toHaveLength(3);

    const deleted = labReducer(split, { type: 'delete-selected-clip' });
    expect(deleted.session.clips).toHaveLength(2);

    const undone = labReducer(deleted, { type: 'undo' });
    expect(undone.session.clips).toHaveLength(3);

    const redone = labReducer(undone, { type: 'redo' });
    expect(redone.session.clips).toHaveLength(2);
  });

  it('stores and clears job state for cancellation-safe UI updates', () => {
    const initial = createInitialLabState();
    const withJob = labReducer(initial, {
      type: 'set-job',
      job: {
        id: 'stem_job',
        kind: 'stem',
        status: 'running',
        progressPct: 48,
        message: 'Running local separation...',
        startedAt: Date.now(),
      },
    });

    expect(withJob.job?.status).toBe('running');

    const cleared = labReducer(withJob, { type: 'set-job', job: null });
    expect(cleared.job).toBeNull();
  });

  it('keeps visual layer transforms editable in the reducer', () => {
    const initial = createInitialLabState();
    const asset: LabAsset = {
      id: 'asset_text_1',
      kind: 'text',
      name: 'title overlay',
      mimeType: 'application/x.voiceflow.text',
      sizeBytes: 64,
      durationMs: 6_000,
      textStyle: {
        preset: 'title',
        text: 'Headline',
        fontFamily: 'Georgia',
        fontSize: 72,
        fontWeight: 700,
        lineHeight: 1.05,
        letterSpacing: 0.5,
        textAlign: 'center',
        color: '#ffffff',
      },
      stageTransform: createDefaultStageTransform({ kind: 'text' }),
      createdAt: 1,
    };
    const clip = buildClipForAsset(initial.session, asset);
    const imported = labReducer(initial, { type: 'add-asset', asset, clip });
    const selected = labReducer(imported, { type: 'set-selected-clip', clipId: clip.id });
    const updated = labReducer(selected, {
      type: 'patch-selected-clip',
      patch: {
        stageTransform: {
          ...clip.stageTransform,
          xPercent: 62,
          yPercent: 28,
          rotationDeg: 12,
          opacity: 0.84,
        },
      },
    });

    expect(updated.session.clips[0]?.stageTransform.xPercent).toBe(62);
    expect(updated.session.clips[0]?.stageTransform.yPercent).toBe(28);
    expect(updated.session.clips[0]?.stageTransform.rotationDeg).toBe(12);
    expect(updated.session.clips[0]?.stageTransform.opacity).toBe(0.84);
  });

  it('reorders layered timeline rows independently of asset kind', () => {
    const initial = createInitialLabState();
    const audioAsset = createAudioAsset({ id: 'asset_audio_1', name: 'music-bed.mp3' });
    const imageAsset: LabAsset = {
      id: 'asset_image_1',
      kind: 'image',
      name: 'cover.jpg',
      mimeType: 'image/jpeg',
      sizeBytes: 512,
      durationMs: 8_000,
      intrinsicWidth: 1080,
      intrinsicHeight: 1080,
      createdAt: 2,
    };

    const audioClip = buildClipForAsset(initial.session, audioAsset);
    const withAudio = labReducer(initial, { type: 'add-asset', asset: audioAsset, clip: audioClip });
    const imageClip = buildClipForAsset(withAudio.session, imageAsset);
    const withBoth = labReducer(withAudio, { type: 'add-asset', asset: imageAsset, clip: imageClip });

    expect(withBoth.session.clips[0]?.layerOrder).toBe(0);
    expect(withBoth.session.clips[1]?.layerOrder).toBe(1);

    const moved = labReducer(withBoth, {
      type: 'move-clip-row',
      sourceRowId: imageClip.timelineRowId,
      targetRowId: audioClip.timelineRowId,
    });

    const movedAudioClip = moved.session.clips.find((clip) => clip.id === audioClip.id);
    const movedImageClip = moved.session.clips.find((clip) => clip.id === imageClip.id);
    expect(movedImageClip?.layerOrder).toBe(0);
    expect(movedAudioClip?.layerOrder).toBe(1);
  });

  it('moves clips across timeline rows while preserving target layer logic', () => {
    const initial = createInitialLabState();
    const firstAsset = createAudioAsset({ id: 'asset_a', name: 'clip-a.wav' });
    const firstClip = buildClipForAsset(initial.session, firstAsset);
    const withFirst = labReducer(initial, { type: 'add-asset', asset: firstAsset, clip: firstClip });
    const secondAsset = createAudioAsset({ id: 'asset_b', name: 'clip-b.wav', createdAt: 2 });
    const secondClip = buildClipForAsset(withFirst.session, secondAsset);
    const withSecond = labReducer(withFirst, { type: 'add-asset', asset: secondAsset, clip: secondClip });

    const moved = labReducer(withSecond, {
      type: 'move-clip',
      clipId: firstClip.id,
      targetRowId: secondClip.timelineRowId,
      targetLayerOrder: secondClip.layerOrder,
      startMs: 3_250,
    });

    const movedClip = moved.session.clips.find((clip) => clip.id === firstClip.id);
    expect(movedClip?.timelineRowId).toBe(secondClip.timelineRowId);
    expect(movedClip?.trackId).toBe(secondClip.timelineRowId);
    expect(movedClip?.layerOrder).toBe(secondClip.layerOrder);
    expect(movedClip?.startMs).toBe(3_250);
  });

  it('supports transition create, update, remove, and cleanup when clips are deleted', () => {
    const initial = createInitialLabState();
    const firstAsset = createAudioAsset({ id: 'asset_audio_a', name: 'a.wav', durationMs: 9_000 });
    const firstClip = buildClipForAsset(initial.session, firstAsset);
    const withFirst = labReducer(initial, { type: 'add-asset', asset: firstAsset, clip: firstClip });
    const secondAsset = createAudioAsset({ id: 'asset_audio_b', name: 'b.wav', durationMs: 7_500, createdAt: 2 });
    const secondClip = buildClipForAsset(withFirst.session, secondAsset);
    const withBoth = labReducer(withFirst, { type: 'add-asset', asset: secondAsset, clip: secondClip });

    const withTransition = labReducer(withBoth, {
      type: 'add-transition',
      fromClipId: firstClip.id,
      toClipId: secondClip.id,
      kind: 'crossfade',
      durationMs: 4_200,
      easing: 'ease_out',
    });
    const transition = withTransition.session.transitions[0];
    expect(transition).toBeDefined();
    expect(transition?.kind).toBe('crossfade');
    expect(transition?.durationMs).toBeLessThanOrEqual(1800);
    expect(transition?.durationMs).toBeGreaterThanOrEqual(80);
    expect(transition?.easing).toBe('ease_out');

    const updated = labReducer(withTransition, {
      type: 'update-transition',
      transitionId: transition?.id || '',
      patch: {
        kind: 'fade',
        durationMs: 120,
        easing: 'linear',
      },
    });
    expect(updated.session.transitions[0]?.kind).toBe('fade');
    expect(updated.session.transitions[0]?.durationMs).toBe(120);
    expect(updated.session.transitions[0]?.easing).toBe('linear');

    const selectedForDelete = labReducer(updated, { type: 'set-selected-clip', clipId: secondClip.id });
    const afterDelete = labReducer(selectedForDelete, { type: 'delete-selected-clip' });
    expect(afterDelete.session.transitions).toHaveLength(0);

    const removed = labReducer(updated, {
      type: 'remove-transition',
      transitionId: updated.session.transitions[0]?.id || '',
    });
    expect(removed.session.transitions).toHaveLength(0);
  });

  it('validates and stores custom canvas ratios via reducer action', () => {
    const initial = createInitialLabState();
    const custom = labReducer(initial, {
      type: 'set-canvas-custom',
      width: LAB_CANVAS_DIMENSION_LIMITS.max + 200,
      height: LAB_CANVAS_DIMENSION_LIMITS.min - 100,
    });

    expect(custom.session.canvas.presetId).toBe('custom');
    expect(custom.session.canvas.isCustom).toBe(true);
    expect(custom.session.canvas.width).toBe(LAB_CANVAS_DIMENSION_LIMITS.max);
    expect(custom.session.canvas.height).toBe(LAB_CANVAS_DIMENSION_LIMITS.min);
    expect(custom.session.canvas.customWidth).toBe(LAB_CANVAS_DIMENSION_LIMITS.max);
    expect(custom.session.canvas.customHeight).toBe(LAB_CANVAS_DIMENSION_LIMITS.min);
  });
});
