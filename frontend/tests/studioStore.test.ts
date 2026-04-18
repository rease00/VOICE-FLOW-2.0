/**
 * studioStore.test.ts — contract tests for the Studio v2 Zustand store.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { useStudioStore, selectIndicatorVisible } from '../src/features/studio/v2/studioStore';

const JOB = { label: 'Read aloud the chapter opening...', voiceName: 'Kore' };

function resetStore() {
  useStudioStore.setState({
    status: 'idle',
    progress: 0,
    audioUrl: null,
    errorMessage: undefined,
    job: null,
  });
}

describe('studioStore', () => {
  beforeEach(resetStore);

  /* ── initial state ───────────────────────── */

  it('starts idle with no job or audio', () => {
    const s = useStudioStore.getState();
    expect(s.status).toBe('idle');
    expect(s.progress).toBe(0);
    expect(s.audioUrl).toBeNull();
    expect(s.job).toBeNull();
  });

  it('selectIndicatorVisible is false initially', () => {
    expect(selectIndicatorVisible(useStudioStore.getState())).toBe(false);
  });

  /* ── startGeneration ─────────────────────── */

  it('startGeneration sets status to generating and stores job', () => {
    useStudioStore.getState().startGeneration(JOB);
    const s = useStudioStore.getState();
    expect(s.status).toBe('generating');
    expect(s.progress).toBe(0);
    expect(s.audioUrl).toBeNull();
    expect(s.job?.label).toBe(JOB.label);
    expect(s.job?.voiceName).toBe('Kore');
  });

  it('selectIndicatorVisible true while generating', () => {
    useStudioStore.getState().startGeneration(JOB);
    expect(selectIndicatorVisible(useStudioStore.getState())).toBe(true);
  });

  /* ── setProgress ─────────────────────────── */

  it('setProgress updates progress value', () => {
    useStudioStore.getState().startGeneration(JOB);
    useStudioStore.getState().setProgress(45);
    expect(useStudioStore.getState().progress).toBe(45);
  });

  /* ── completeGeneration ──────────────────── */

  it('completeGeneration stores audioUrl and resets status to idle', () => {
    useStudioStore.getState().startGeneration(JOB);
    useStudioStore.getState().completeGeneration('blob:http://localhost/audio');
    const s = useStudioStore.getState();
    expect(s.status).toBe('idle');
    expect(s.progress).toBe(100);
    expect(s.audioUrl).toBe('blob:http://localhost/audio');
  });

  it('selectIndicatorVisible true after completion (audioUrl present)', () => {
    useStudioStore.getState().startGeneration(JOB);
    useStudioStore.getState().completeGeneration('blob:http://localhost/x');
    expect(selectIndicatorVisible(useStudioStore.getState())).toBe(true);
  });

  it('completeGeneration with null url leaves selectIndicatorVisible false', () => {
    useStudioStore.getState().startGeneration(JOB);
    useStudioStore.getState().completeGeneration(null);
    expect(selectIndicatorVisible(useStudioStore.getState())).toBe(false);
  });

  /* ── failGeneration ──────────────────────── */

  it('failGeneration sets error status and message', () => {
    useStudioStore.getState().startGeneration(JOB);
    useStudioStore.getState().failGeneration('Network error');
    const s = useStudioStore.getState();
    expect(s.status).toBe('error');
    expect(s.errorMessage).toBe('Network error');
    expect(s.progress).toBe(0);
  });

  it('selectIndicatorVisible true on error', () => {
    useStudioStore.getState().startGeneration(JOB);
    useStudioStore.getState().failGeneration('timeout');
    expect(selectIndicatorVisible(useStudioStore.getState())).toBe(true);
  });

  /* ── cancelGeneration ────────────────────── */

  it('cancelGeneration resets to idle with no error', () => {
    useStudioStore.getState().startGeneration(JOB);
    useStudioStore.getState().setProgress(40);
    useStudioStore.getState().cancelGeneration();
    const s = useStudioStore.getState();
    expect(s.status).toBe('idle');
    expect(s.progress).toBe(0);
    expect(s.errorMessage).toBeUndefined();
  });

  /* ── setStatus ───────────────────────────── */

  it('setStatus transitions playing ↔ paused', () => {
    useStudioStore.getState().startGeneration(JOB);
    useStudioStore.getState().completeGeneration('blob:x');
    useStudioStore.getState().setStatus('playing');
    expect(useStudioStore.getState().status).toBe('playing');
    useStudioStore.getState().setStatus('paused');
    expect(useStudioStore.getState().status).toBe('paused');
  });

  /* ── reset ───────────────────────────────── */

  it('reset returns to INITIAL_STATE', () => {
    useStudioStore.getState().startGeneration(JOB);
    useStudioStore.getState().completeGeneration('blob:x');
    useStudioStore.getState().reset();
    const s = useStudioStore.getState();
    expect(s.status).toBe('idle');
    expect(s.audioUrl).toBeNull();
    expect(s.job).toBeNull();
    expect(s.errorMessage).toBeUndefined();
    expect(selectIndicatorVisible(s)).toBe(false);
  });
});
