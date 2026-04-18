"use client";

import { useEffect } from "react";
import {
  usePwaStore,
  selectCanInstall,
  selectUpdateReady,
  type BeforeInstallPromptEvent,
} from "./pwaStore";

/* ------------------------------------------------------------------ */
/*  Install banner — slides up when the browser fires                  */
/*  `beforeinstallprompt`. Dismisses on install or user close.         */
/* ------------------------------------------------------------------ */

export function PwaInstallBanner() {
  const canInstall = usePwaStore(selectCanInstall);
  const install = usePwaStore((s) => s.install);
  const status = usePwaStore((s) => s.status);

  /* Capture the deferred prompt globally */
  useEffect(() => {
    const handler = (e: Event) => {
      usePwaStore.getState().capture(e as BeforeInstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  if (!canInstall) return null;

  return (
    <div
      role="alert"
      className="fixed bottom-20 left-1/2 z-50 flex w-[calc(100%-2rem)] max-w-sm -translate-x-1/2 items-center gap-3 rounded-2xl border border-white/10 bg-[#161A2C]/90 px-4 py-3 shadow-xl shadow-black/30 backdrop-blur-xl transition-all animate-in slide-in-from-bottom-4 duration-300"
    >
      {/* Icon */}
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-[#7C5CFF] to-[#22D3EE]">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          className="h-5 w-5 text-white"
          aria-hidden
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v12m0 0l-4-4m4 4l4-4M4 18h16" />
        </svg>
      </div>

      {/* Text */}
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-white/90">Install V FLOW AI</p>
        <p className="text-xs text-white/50">Get the full app experience</p>
      </div>

      {/* Actions */}
      <button
        onClick={() => install()}
        disabled={status !== "available"}
        className="shrink-0 rounded-lg bg-gradient-to-r from-[#7C5CFF] via-[#22D3EE] to-[#F472B6] px-3 py-1.5 text-xs font-semibold text-white shadow-md transition-transform active:scale-95"
      >
        Install
      </button>

      <button
        onClick={() => usePwaStore.setState({ status: "dismissed", deferredPrompt: null })}
        aria-label="Dismiss install prompt"
        className="shrink-0 rounded-md p-1 text-white/40 transition-colors hover:text-white/70"
      >
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4" aria-hidden>
          <path d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z" />
        </svg>
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Update toast — shows when a new SW version is waiting.             */
/* ------------------------------------------------------------------ */

export function PwaUpdateToast() {
  const updateReady = usePwaStore(selectUpdateReady);

  /* Listen for SW controllerchange (happens after skipWaiting) */
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    const onControllerChange = () => {
      usePwaStore.getState().setUpdateReady(false);
      window.location.reload();
    };

    navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);
    return () => navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange);
  }, []);

  /* Detect waiting worker */
  useEffect(() => {
    if (!("serviceWorker" in navigator) || process.env.NODE_ENV !== "production") return;

    navigator.serviceWorker.ready.then((reg) => {
      if (reg.waiting) {
        usePwaStore.getState().setUpdateReady(true);
        return;
      }

      const onUpdateFound = () => {
        const installing = reg.installing;
        if (!installing) return;
        installing.addEventListener("statechange", () => {
          if (installing.state === "installed" && navigator.serviceWorker.controller) {
            usePwaStore.getState().setUpdateReady(true);
          }
        });
      };

      reg.addEventListener("updatefound", onUpdateFound);
    });
  }, []);

  if (!updateReady) return null;

  const applyUpdate = async () => {
    const reg = await navigator.serviceWorker.ready;
    reg.waiting?.postMessage({ type: "SKIP_WAITING" });
  };

  return (
    <div
      role="alert"
      className="fixed bottom-20 left-1/2 z-50 flex w-[calc(100%-2rem)] max-w-sm -translate-x-1/2 items-center gap-3 rounded-2xl border border-white/10 bg-[#161A2C]/90 px-4 py-3 shadow-xl shadow-black/30 backdrop-blur-xl transition-all animate-in slide-in-from-bottom-4 duration-300"
    >
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-white/90">Update available</p>
        <p className="text-xs text-white/50">Refresh to get the latest version</p>
      </div>

      <button
        onClick={applyUpdate}
        className="shrink-0 rounded-lg bg-gradient-to-r from-[#7C5CFF] via-[#22D3EE] to-[#F472B6] px-3 py-1.5 text-xs font-semibold text-white shadow-md transition-transform active:scale-95"
      >
        Refresh
      </button>
    </div>
  );
}
