import { describe, expect, it } from 'vitest';
import type { GenerationSettings, StudioQueueState } from '../types';
import {
  buildStudioQueueItems,
  computeStudioQueueMasterOrder,
  createStudioQueueState,
  normalizeStoredStudioQueueState,
} from '../src/features/studio/model/queue';

const TEST_SETTINGS: GenerationSettings = {
  voiceId: 'voice_1',
  speed: 1,
  pitch: 'Medium',
  language: 'Auto',
  engine: 'PRIME',
  helperProvider: 'GEMINI',
  musicTrackId: 'm_none',
  musicVolume: 0.3,
  speechVolume: 1,
  multiSpeakerEnabled: true,
  speakerMapping: {},
};

describe('studio queue model', () => {
  it('creates stable part labels and queue metadata from long Studio text', () => {
    const text = [
      'Narrator: Part one opens the scene with enough text to fill the queue window.',
      'Narrator: Part two follows with a second sentence so the queue splits cleanly.',
      'Narrator: Part three closes the section.',
    ].join(' ');

    const state = createStudioQueueState(text, 95, TEST_SETTINGS, true);

    expect(state.queueModeEnabled).toBe(true);
    expect(state.items.length).toBeGreaterThan(1);
    expect(state.items.map((item) => item.label)).toEqual(
      state.items.map((_, index) => `Part ${index + 1}`)
    );
    expect(state.masterOrder).toBe(
      Array.from({ length: state.items.length }, (_, index) => String(index + 1)).join('+')
    );
  });

  it('recomputes master order from the visible queue order', () => {
    const items = buildStudioQueueItems(
      'One sentence. Two sentence. Three sentence.',
      16,
      TEST_SETTINGS
    );
    const reordered = [items[2], items[0], items[1]].map((item, index) => ({
      ...item,
      order: index,
    }));

    expect(computeStudioQueueMasterOrder(reordered)).toBe('3+1+2');
  });

  it('normalizes persisted queue payloads with missing optional fields', () => {
    const rawState = {
      items: [
        {
          id: 'item-a',
          order: 0,
          label: 'Part 1',
          status: 'completed',
          sourceText: 'Hello there.',
          charCount: 12,
          settingsSnapshot: {
            voiceId: 'legacy_voice',
            speed: 1,
            pitch: 'Medium',
            language: 'Auto',
            engine: 'GOOD',
            helperProvider: 'GEMINI',
          },
          createdAt: Date.now(),
        },
      ],
      queueModeEnabled: true,
      sourceHash: 'studio_hash',
    } satisfies Partial<StudioQueueState>;

    const normalized = normalizeStoredStudioQueueState(rawState);

    expect(normalized).not.toBeNull();
    expect(normalized?.items[0]?.audioCacheKey).toBe('');
    expect(normalized?.items[0]?.settingsSnapshot.engine).toBe('PRIME');
    expect(normalized?.masterOrder).toBe('1');
    expect(normalized?.masterStatus).toBe('idle');
  });

  it('preserves legacy engine tokens when building outbound queue items', () => {
    const items = buildStudioQueueItems(
      'Hello there. This should become one queued item.',
      120,
      {
        ...TEST_SETTINGS,
        engine: 'prime_v2',
      } as any
    );

    expect(items).toHaveLength(1);
    expect(items[0]?.settingsSnapshot.engine).toBe('prime_v2');
  });

  it('accepts production engine labels when rebuilding persisted queue state', () => {
    const rawState = {
      items: [
        {
          id: 'item-standard',
          order: 0,
          label: 'Part 1',
          status: 'queued',
          sourceText: 'VECTOR engine text.',
          charCount: 18,
          settingsSnapshot: {
            voiceId: 'legacy_voice',
            speed: 1,
            pitch: 'Medium',
            language: 'Auto',
            engine: 'VECTOR',
            helperProvider: 'GEMINI',
          },
          createdAt: Date.now(),
        },
        {
          id: 'item-vector',
          order: 1,
          label: 'Part 2',
          status: 'queued',
          sourceText: 'VECTOR engine text.',
          charCount: 19,
          settingsSnapshot: {
            voiceId: 'legacy_voice',
            speed: 1,
            pitch: 'Medium',
            language: 'Auto',
            engine: 'VECTOR',
            helperProvider: 'GEMINI',
          },
          createdAt: Date.now(),
        },
      ],
      queueModeEnabled: true,
      sourceHash: 'studio_hash_labels',
    } satisfies Partial<StudioQueueState>;

    const normalized = normalizeStoredStudioQueueState(rawState);

    expect(normalized?.items[0]?.settingsSnapshot.engine).toBe('VECTOR');
    expect(normalized?.items[1]?.settingsSnapshot.engine).toBe('VECTOR');
  });
});

