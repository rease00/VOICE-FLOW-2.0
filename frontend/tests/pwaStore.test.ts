import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  usePwaStore,
  selectCanInstall,
  selectUpdateReady,
  type BeforeInstallPromptEvent,
} from "../src/features/pwa/pwaStore";

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function reset() {
  usePwaStore.getState().reset();
}

function makeMockPromptEvent(
  outcome: "accepted" | "dismissed" = "accepted",
): BeforeInstallPromptEvent {
  const event = new Event("beforeinstallprompt") as BeforeInstallPromptEvent;
  Object.defineProperties(event, {
    platforms: { value: ["web"], writable: false },
    userChoice: {
      value: Promise.resolve({ outcome, platform: "web" }),
      writable: false,
    },
    prompt: { value: vi.fn().mockResolvedValue(undefined), writable: false },
  });
  // Allow preventDefault
  vi.spyOn(event, "preventDefault");
  return event;
}

/* ------------------------------------------------------------------ */
/*  Tests                                                              */
/* ------------------------------------------------------------------ */

describe("pwaStore", () => {
  beforeEach(reset);

  describe("initial state", () => {
    it("status is idle", () => {
      expect(usePwaStore.getState().status).toBe("idle");
    });

    it("deferredPrompt is null", () => {
      expect(usePwaStore.getState().deferredPrompt).toBeNull();
    });

    it("updateReady is false", () => {
      expect(usePwaStore.getState().updateReady).toBe(false);
    });

    it("selectCanInstall is false", () => {
      expect(selectCanInstall(usePwaStore.getState())).toBe(false);
    });

    it("selectUpdateReady is false", () => {
      expect(selectUpdateReady(usePwaStore.getState())).toBe(false);
    });
  });

  describe("capture", () => {
    it("sets status to available", () => {
      const event = makeMockPromptEvent();
      usePwaStore.getState().capture(event);
      expect(usePwaStore.getState().status).toBe("available");
    });

    it("stores the deferred prompt event", () => {
      const event = makeMockPromptEvent();
      usePwaStore.getState().capture(event);
      expect(usePwaStore.getState().deferredPrompt).toBe(event);
    });

    it("calls preventDefault on the event", () => {
      const event = makeMockPromptEvent();
      usePwaStore.getState().capture(event);
      expect(event.preventDefault).toHaveBeenCalled();
    });

    it("selectCanInstall returns true after capture", () => {
      usePwaStore.getState().capture(makeMockPromptEvent());
      expect(selectCanInstall(usePwaStore.getState())).toBe(true);
    });
  });

  describe("install — accepted", () => {
    it("calls prompt on the deferred event", async () => {
      const event = makeMockPromptEvent("accepted");
      usePwaStore.getState().capture(event);
      await usePwaStore.getState().install();
      expect(event.prompt).toHaveBeenCalledTimes(1);
    });

    it("sets status to accepted", async () => {
      usePwaStore.getState().capture(makeMockPromptEvent("accepted"));
      await usePwaStore.getState().install();
      expect(usePwaStore.getState().status).toBe("accepted");
    });

    it("clears deferredPrompt after install", async () => {
      usePwaStore.getState().capture(makeMockPromptEvent("accepted"));
      await usePwaStore.getState().install();
      expect(usePwaStore.getState().deferredPrompt).toBeNull();
    });

    it("selectCanInstall is false after accepted", async () => {
      usePwaStore.getState().capture(makeMockPromptEvent("accepted"));
      await usePwaStore.getState().install();
      expect(selectCanInstall(usePwaStore.getState())).toBe(false);
    });
  });

  describe("install — dismissed", () => {
    it("sets status to dismissed when user declines", async () => {
      usePwaStore.getState().capture(makeMockPromptEvent("dismissed"));
      await usePwaStore.getState().install();
      expect(usePwaStore.getState().status).toBe("dismissed");
    });

    it("clears deferredPrompt on dismiss", async () => {
      usePwaStore.getState().capture(makeMockPromptEvent("dismissed"));
      await usePwaStore.getState().install();
      expect(usePwaStore.getState().deferredPrompt).toBeNull();
    });
  });

  describe("install — no prompt captured", () => {
    it("does nothing when no deferred prompt exists", async () => {
      await usePwaStore.getState().install();
      expect(usePwaStore.getState().status).toBe("idle");
    });
  });

  describe("setUpdateReady", () => {
    it("sets updateReady to true", () => {
      usePwaStore.getState().setUpdateReady(true);
      expect(usePwaStore.getState().updateReady).toBe(true);
      expect(selectUpdateReady(usePwaStore.getState())).toBe(true);
    });

    it("sets updateReady back to false", () => {
      usePwaStore.getState().setUpdateReady(true);
      usePwaStore.getState().setUpdateReady(false);
      expect(usePwaStore.getState().updateReady).toBe(false);
    });
  });

  describe("reset", () => {
    it("resets all state to initial values", async () => {
      usePwaStore.getState().capture(makeMockPromptEvent("accepted"));
      usePwaStore.getState().setUpdateReady(true);
      usePwaStore.getState().reset();

      const state = usePwaStore.getState();
      expect(state.status).toBe("idle");
      expect(state.deferredPrompt).toBeNull();
      expect(state.updateReady).toBe(false);
    });
  });
});
