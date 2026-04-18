"use client";

import { useEffect } from "react";

/**
 * Mounts a side-effect that registers `/sw.js` once on first paint.
 *
 * Production-only. In development we proactively unregister any stale
 * service worker so HMR / module replacement works as expected. The hook
 * is wrapped in a component so the root server layout can stay
 * server-rendered (only this leaf is `"use client"`).
 */
export function ServiceWorkerRegistrar(): null {
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator)) return;

    if (process.env.NODE_ENV !== "production") {
      navigator.serviceWorker
        .getRegistrations()
        .then((regs) => regs.forEach((r) => r.unregister()))
        .catch(() => undefined);
      return;
    }

    const register = () => {
      navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch((err) => {
        // SW registration failure must never break the app.
        if (typeof console !== "undefined") {
          console.warn("[sw] registration failed", err);
        }
      });
    };

    if (document.readyState === "complete") {
      register();
      return;
    }

    window.addEventListener("load", register, { once: true });
    return () => window.removeEventListener("load", register);
  }, []);

  return null;
}
