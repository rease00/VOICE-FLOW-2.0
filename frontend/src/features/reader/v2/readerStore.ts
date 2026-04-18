/**
 * readerStore — Zustand store for Reader v2 playback state.
 *
 * This is the single source of truth for what is currently playing.
 * Both ReaderShellV2 (writes) and MiniPlayer (reads + writes) subscribe here.
 *
 * Design notes:
 * - No persistence: state resets on page reload (audio URLs are object: blobs).
 * - PlayerDock owns the HTMLAudioElement ref; it calls store actions on events.
 * - MiniPlayer reads the store and shows when audioUrl != null.
 */

import { create } from "zustand";

export interface ReaderTrack {
  /** Displayed in MiniPlayer as the "title" of what's playing. */
  title: string;
  /** Active paragraph / section index (-1 = none). */
  activeIndex: number;
  /** Total number of paragraphs (for skip prev/next bounds). */
  totalParagraphs: number;
}

export interface ReaderState {
  /* ── track ─────────────────────────────────── */
  track: ReaderTrack | null;
  audioUrl: string | null;

  /* ── transport ─────────────────────────────── */
  playing: boolean;
  synthesizing: boolean;
  currentTime: number;
  duration: number;

  /* ── settings ──────────────────────────────── */
  speed: number;
  volume: number;
  muted: boolean;
}

export interface ReaderActions {
  /* called by ReaderShellV2 when synthesis begins / completes */
  setTrack: (track: ReaderTrack) => void;
  setAudioUrl: (url: string | null) => void;
  setSynthesizing: (v: boolean) => void;

  /* called by PlayerDock on HTMLAudioElement events */
  setPlaying: (v: boolean) => void;
  setCurrentTime: (t: number) => void;
  setDuration: (d: number) => void;

  /* settings (MiniPlayer + PlayerDock share these) */
  setSpeed: (s: number) => void;
  setVolume: (v: number) => void;
  setMuted: (v: boolean) => void;

  /* skip forward / back — changes activeIndex; shell listens + re-synthesizes */
  skipForward: () => void;
  skipBack: () => void;

  /* MiniPlayer dismiss — clears active track */
  dismiss: () => void;
}

export type ReaderStore = ReaderState & ReaderActions;

export const useReaderStore = create<ReaderStore>((set, get) => ({
  /* ── initial state ──────────────────────────── */
  track: null,
  audioUrl: null,
  playing: false,
  synthesizing: false,
  currentTime: 0,
  duration: 0,
  speed: 1.0,
  volume: 1.0,
  muted: false,

  /* ── actions ────────────────────────────────── */
  setTrack: (track) => set({ track }),
  setAudioUrl: (url) => set({ audioUrl: url, currentTime: 0, duration: 0, playing: false }),
  setSynthesizing: (synthesizing) => set({ synthesizing }),
  setPlaying: (playing) => set({ playing }),
  setCurrentTime: (currentTime) => set({ currentTime }),
  setDuration: (duration) => set({ duration }),
  setSpeed: (speed) => set({ speed }),
  setVolume: (volume) => set({ volume }),
  setMuted: (muted) => set({ muted }),

  skipForward: () => {
    const { track } = get();
    if (!track) return;
    const next = Math.min(track.activeIndex + 1, track.totalParagraphs - 1);
    if (next !== track.activeIndex) {
      set({ track: { ...track, activeIndex: next } });
    }
  },

  skipBack: () => {
    const { track } = get();
    if (!track) return;
    const prev = Math.max(track.activeIndex - 1, 0);
    if (prev !== track.activeIndex) {
      set({ track: { ...track, activeIndex: prev } });
    }
  },

  dismiss: () =>
    set({
      track: null,
      audioUrl: null,
      playing: false,
      synthesizing: false,
      currentTime: 0,
      duration: 0,
    }),
}));

/* ── convenience selectors ───────────────────── */

/** True when the mini-player should be visible. */
export const selectMiniPlayerVisible = (s: ReaderStore) =>
  s.audioUrl !== null || s.synthesizing;
