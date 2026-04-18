"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  DEFAULT_UI_V2_FLAG,
  fetchUiV2Flag,
  readCachedFlag,
  resolveSurface,
  writeCachedFlag,
  type UiV2Flag,
} from "./uiV2";

/* ── context shape ────────────────────────────── */

interface UiV2FlagContextValue {
  flag: UiV2Flag;
  /** true while the Firestore fetch is in flight */
  syncing: boolean;
  /** Returns whether a named surface is enabled for the given uid */
  checkSurface: (uid: string | null | undefined, surface: keyof UiV2Flag["surfaces"]) => boolean;
  /**
   * Manually override the in-memory flag and write it to the localStorage
   * cache. Useful for developer/QA tooling when Firestore is unavailable.
   */
  overrideFlag: (patch: Partial<UiV2Flag> | ((prev: UiV2Flag) => UiV2Flag)) => void;
}

const UiV2FlagContext = createContext<UiV2FlagContextValue>({
  flag: DEFAULT_UI_V2_FLAG,
  syncing: false,
  checkSurface: () => false,
  overrideFlag: () => {},
});

/* ── provider ─────────────────────────────────── */

interface UiV2FlagProviderProps {
  children: ReactNode;
}

/**
 * Provides the Aurora v2 feature-flag to all descendants.
 *
 * On first mount it:
 *   1. Reads the localStorage cache (instant — no flash).
 *   2. If the cache is stale or missing, fetches from Firestore and refreshes
 *      the cache (no-ops gracefully if db is null).
 *
 * Both steps are client-only so SSR always starts from DEFAULT_UI_V2_FLAG,
 * preventing hydration mismatches.
 */
export function UiV2FlagProvider({ children }: UiV2FlagProviderProps) {
  const [flag, setFlag] = useState<UiV2Flag>(DEFAULT_UI_V2_FLAG);
  const [syncing, setSyncing] = useState(false);
  const fetchedRef = useRef(false);

  useEffect(() => {
    if (fetchedRef.current) return;
    fetchedRef.current = true;

    // Step 1 — promote from cache instantly
    const cached = readCachedFlag();
    if (cached) setFlag(cached);

    // Step 2 — refresh from Firestore in the background
    setSyncing(true);
    fetchUiV2Flag()
      .then((fresh) => {
        if (fresh) {
          writeCachedFlag(fresh);
          setFlag(fresh);
        }
      })
      .finally(() => setSyncing(false));
  }, []);

  const checkSurface = useCallback(
    (uid: string | null | undefined, surface: keyof UiV2Flag["surfaces"]) =>
      resolveSurface(uid ?? null, flag, surface),
    [flag],
  );

  const overrideFlag = useCallback(
    (patch: Partial<UiV2Flag> | ((prev: UiV2Flag) => UiV2Flag)) => {
      setFlag((prev) => {
        const next = typeof patch === "function" ? patch(prev) : { ...prev, ...patch };
        writeCachedFlag(next);
        return next;
      });
    },
    [],
  );

  return (
    <UiV2FlagContext.Provider value={{ flag, syncing, checkSurface, overrideFlag }}>
      {children}
    </UiV2FlagContext.Provider>
  );
}

/* ── consumer hook ────────────────────────────── */

// eslint-disable-next-line react-refresh/only-export-components
export function useUiV2Flag(): UiV2FlagContextValue {
  return useContext(UiV2FlagContext);
}
