/**
 * readerStore.test.ts — contract tests for the Reader v2 Zustand store.
 *
 * Tests use the store's plain action/selector surface without mounting React.
 * Zustand's `create` works in Node via vitest (no DOM needed for pure store tests).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { useReaderStore, selectMiniPlayerVisible } from '../src/features/reader/v2/readerStore';

/** Fresh store snapshot before each test — Zustand persists across imports. */
function resetStore() {
  useReaderStore.setState({
    track: null,
    audioUrl: null,
    playing: false,
    synthesizing: false,
    currentTime: 0,
    duration: 0,
    speed: 1.0,
    volume: 1.0,
    muted: false,
  });
}

describe('readerStore', () => {
  beforeEach(resetStore);

  /* ── initial state ───────────────────────── */

  it('starts with null track and no audio', () => {
    const s = useReaderStore.getState();
    expect(s.track).toBeNull();
    expect(s.audioUrl).toBeNull();
    expect(s.playing).toBe(false);
    expect(s.synthesizing).toBe(false);
  });

  it('selectMiniPlayerVisible is false initially', () => {
    expect(selectMiniPlayerVisible(useReaderStore.getState())).toBe(false);
  });

  /* ── setTrack ────────────────────────────── */

  it('setTrack stores title + activeIndex + totalParagraphs', () => {
    useReaderStore.getState().setTrack({ title: 'Para 1', activeIndex: 0, totalParagraphs: 5 });
    const { track } = useReaderStore.getState();
    expect(track?.title).toBe('Para 1');
    expect(track?.activeIndex).toBe(0);
    expect(track?.totalParagraphs).toBe(5);
  });

  /* ── setAudioUrl ─────────────────────────── */

  it('setAudioUrl sets url and resets time/playing', () => {
    // set some time first
    useReaderStore.setState({ currentTime: 30, duration: 120, playing: true });
    useReaderStore.getState().setAudioUrl('blob:http://localhost/abc');
    const s = useReaderStore.getState();
    expect(s.audioUrl).toBe('blob:http://localhost/abc');
    expect(s.currentTime).toBe(0);
    expect(s.duration).toBe(0);
    expect(s.playing).toBe(false);
  });

  it('setAudioUrl(null) clears the url', () => {
    useReaderStore.setState({ audioUrl: 'blob:x' });
    useReaderStore.getState().setAudioUrl(null);
    expect(useReaderStore.getState().audioUrl).toBeNull();
  });

  /* ── selectMiniPlayerVisible ─────────────── */

  it('selectMiniPlayerVisible true when audioUrl is set', () => {
    useReaderStore.getState().setAudioUrl('blob:http://localhost/track');
    expect(selectMiniPlayerVisible(useReaderStore.getState())).toBe(true);
  });

  it('selectMiniPlayerVisible true when synthesizing', () => {
    useReaderStore.getState().setSynthesizing(true);
    expect(selectMiniPlayerVisible(useReaderStore.getState())).toBe(true);
  });

  it('selectMiniPlayerVisible false when neither audioUrl nor synthesizing', () => {
    useReaderStore.getState().setSynthesizing(false);
    useReaderStore.getState().setAudioUrl(null);
    expect(selectMiniPlayerVisible(useReaderStore.getState())).toBe(false);
  });

  /* ── skipForward / skipBack ──────────────── */

  it('skipForward increments activeIndex up to totalParagraphs - 1', () => {
    useReaderStore.getState().setTrack({ title: 'T', activeIndex: 2, totalParagraphs: 5 });
    useReaderStore.getState().skipForward();
    expect(useReaderStore.getState().track?.activeIndex).toBe(3);
    // skip to max
    useReaderStore.getState().skipForward();
    useReaderStore.getState().skipForward();
    expect(useReaderStore.getState().track?.activeIndex).toBe(4); // capped at 4
  });

  it('skipBack decrements activeIndex down to 0', () => {
    useReaderStore.getState().setTrack({ title: 'T', activeIndex: 2, totalParagraphs: 5 });
    useReaderStore.getState().skipBack();
    expect(useReaderStore.getState().track?.activeIndex).toBe(1);
    useReaderStore.getState().skipBack();
    useReaderStore.getState().skipBack();
    expect(useReaderStore.getState().track?.activeIndex).toBe(0); // capped at 0
  });

  it('skipForward is no-op when track is null', () => {
    useReaderStore.getState().skipForward();
    expect(useReaderStore.getState().track).toBeNull();
  });

  /* ── dismiss ─────────────────────────────── */

  it('dismiss clears track, audioUrl, and resets transport', () => {
    useReaderStore.setState({
      track: { title: 'T', activeIndex: 1, totalParagraphs: 3 },
      audioUrl: 'blob:x',
      playing: true,
      synthesizing: true,
      currentTime: 42,
      duration: 90,
    });
    useReaderStore.getState().dismiss();
    const s = useReaderStore.getState();
    expect(s.track).toBeNull();
    expect(s.audioUrl).toBeNull();
    expect(s.playing).toBe(false);
    expect(s.synthesizing).toBe(false);
    expect(s.currentTime).toBe(0);
    expect(s.duration).toBe(0);
    expect(selectMiniPlayerVisible(s)).toBe(false);
  });

  /* ── settings ────────────────────────────── */

  it('setSpeed, setVolume, setMuted update state', () => {
    useReaderStore.getState().setSpeed(1.5);
    useReaderStore.getState().setVolume(0.6);
    useReaderStore.getState().setMuted(true);
    const s = useReaderStore.getState();
    expect(s.speed).toBe(1.5);
    expect(s.volume).toBe(0.6);
    expect(s.muted).toBe(true);
  });
});
