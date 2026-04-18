/**
 * studioStore — Zustand store for Studio v2 generation state.
 *
 * This is the single source of truth for what Studio is currently doing.
 * Both StudioShellV2 (writes) and GenerationIndicator (reads) subscribe here.
 *
 * Design notes:
 * - Draft text is NOT stored here — it stays in StudioShellV2 local state and
 *   is persisted to IndexedDB via studioDraftService. The store carries only
 *   the ephemeral generation lifecycle data.
 * - GenerationIndicator shows when status !== 'idle', so the user gets
 *   feedback even after navigating away from /app/studio.
 */

import { create } from "zustand";

export type GenerationStatus =
  | "idle"
  | "generating"
  | "playing"
  | "paused"
  | "error";

export interface StudioGenerationJob {
  /** First 80 chars of the script — used as label in the indicator. */
  label: string;
  /** Which voice was selected (display name). */
  voiceName: string;
}

export interface StudioState {
  status: GenerationStatus;
  progress: number;
  audioUrl: string | null;
  errorMessage: string | undefined;
  job: StudioGenerationJob | null;
}

export interface StudioActions {
  /** Called when generation starts. */
  startGeneration: (job: StudioGenerationJob) => void;
  /** Called periodically to update the progress bar (0–100). */
  setProgress: (progress: number) => void;
  /** Called when generation completes with a URL. */
  completeGeneration: (audioUrl: string | null) => void;
  /** Called when generation fails. */
  failGeneration: (message: string) => void;
  /** Called when generation is aborted by the user. */
  cancelGeneration: () => void;
  /** Playback state — set by GenerationDock events. */
  setStatus: (status: GenerationStatus) => void;
  /** Clear the indicator (user dismissed or started a new draft). */
  reset: () => void;
}

export type StudioStore = StudioState & StudioActions;

const INITIAL_STATE: StudioState = {
  status: "idle",
  progress: 0,
  audioUrl: null,
  errorMessage: undefined,
  job: null,
};

export const useStudioStore = create<StudioStore>((set) => ({
  ...INITIAL_STATE,

  startGeneration: (job) =>
    set({ status: "generating", progress: 0, audioUrl: null, errorMessage: undefined, job }),

  setProgress: (progress) => set({ progress }),

  completeGeneration: (audioUrl) =>
    set({ status: "idle", progress: 100, audioUrl }),

  failGeneration: (message) =>
    set({ status: "error", progress: 0, errorMessage: message }),

  cancelGeneration: () =>
    set({ status: "idle", progress: 0, errorMessage: undefined }),

  setStatus: (status) => set({ status }),

  reset: () => set(INITIAL_STATE),
}));

/* ── convenience selectors ───────────────────── */

/** True when the generation indicator should be visible. */
export const selectIndicatorVisible = (s: StudioStore) =>
  s.status !== "idle" || s.audioUrl !== null;
