import { create } from "zustand";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

/** Condensed `BeforeInstallPromptEvent` — not in lib.dom yet. */
export interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  readonly userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
  prompt(): Promise<void>;
}

export type PwaInstallStatus = "idle" | "available" | "accepted" | "dismissed";

interface PwaState {
  /** Current install-prompt lifecycle status. */
  status: PwaInstallStatus;
  /** Captured browser event — only set when `status === "available"`. */
  deferredPrompt: BeforeInstallPromptEvent | null;
  /** Whether a SW update is waiting to activate. */
  updateReady: boolean;
}

interface PwaActions {
  /** Called by the global listener when `beforeinstallprompt` fires. */
  capture(event: BeforeInstallPromptEvent): void;
  /** Trigger the native install prompt. */
  install(): Promise<void>;
  /** Mark that a new SW is waiting. */
  setUpdateReady(ready: boolean): void;
  /** Reset store to defaults (for tests). */
  reset(): void;
}

/* ------------------------------------------------------------------ */
/*  Store                                                              */
/* ------------------------------------------------------------------ */

const initialState: PwaState = {
  status: "idle",
  deferredPrompt: null,
  updateReady: false,
};

export const usePwaStore = create<PwaState & PwaActions>()((set, get) => ({
  ...initialState,

  capture(event) {
    event.preventDefault();
    set({ status: "available", deferredPrompt: event });
  },

  async install() {
    const { deferredPrompt } = get();
    if (!deferredPrompt) return;
    await deferredPrompt.prompt();
    const choice = await deferredPrompt.userChoice;
    set({
      status: choice.outcome === "accepted" ? "accepted" : "dismissed",
      deferredPrompt: null,
    });
  },

  setUpdateReady(ready) {
    set({ updateReady: ready });
  },

  reset() {
    set({ ...initialState });
  },
}));

/* ------------------------------------------------------------------ */
/*  Selectors                                                          */
/* ------------------------------------------------------------------ */

export const selectCanInstall = (s: PwaState) => s.status === "available";
export const selectUpdateReady = (s: PwaState) => s.updateReady;
