/**
 * Aurora v2 feature-flag shape.
 *
 *   {
 *     enabled: boolean,        // master kill switch
 *     rolloutPct: number,      // 0..100 — used by stable hash bucket
 *     allowedUids: string[],   // explicit allow-list (overrides %)
 *     blockedUids: string[],   // explicit block-list
 *     surfaces: {              // per-surface gates
 *       studio: boolean,
 *       reader: boolean,
 *       library: boolean,
 *     }
 *   }
 *
 * Resolution priority:
 *   blocked > allowed > rolloutPct (hash) > default false
 *
 * Feature flags are currently disabled pending D1-backed API setup.
 * The localStorage cache layer is preserved for future use.
 */

export interface UiV2Flag {
  enabled: boolean;
  rolloutPct: number;
  allowedUids: string[];
  blockedUids: string[];
  surfaces: { studio: boolean; reader: boolean; library: boolean };
}

export const DEFAULT_UI_V2_FLAG: UiV2Flag = {
  enabled: false,
  rolloutPct: 0,
  allowedUids: [],
  blockedUids: [],
  surfaces: { studio: false, reader: false, library: false },
};

const CACHE_KEY = "vf:flag:ui_v2";
const CACHE_TTL_MS = 5 * 60 * 1000;

function fnv1a(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h;
}

/** Stable bucket 0..99 for a given uid. */
export function uidBucket(uid: string): number {
  return fnv1a(uid) % 100;
}

export function resolveUiV2(uid: string | null | undefined, flag: UiV2Flag): boolean {
  if (!flag.enabled) return false;
  if (!uid) return false;
  if (flag.blockedUids.includes(uid)) return false;
  if (flag.allowedUids.includes(uid)) return true;
  return uidBucket(uid) < flag.rolloutPct;
}

export function resolveSurface(
  uid: string | null | undefined,
  flag: UiV2Flag,
  surface: keyof UiV2Flag["surfaces"],
): boolean {
  return resolveUiV2(uid, flag) && Boolean(flag.surfaces[surface]);
}

interface CachedFlag {
  v: UiV2Flag;
  t: number;
}

export function readCachedFlag(): UiV2Flag | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedFlag;
    if (Date.now() - parsed.t > CACHE_TTL_MS) return null;
    return parsed.v;
  } catch {
    return null;
  }
}

export function writeCachedFlag(flag: UiV2Flag): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      CACHE_KEY,
      JSON.stringify({ v: flag, t: Date.now() } satisfies CachedFlag),
    );
  } catch {
    /* quota or private mode — ignore */
  }
}

/** Returns null — feature flags are disabled until a D1-backed API is set up. */
export async function fetchUiV2Flag(): Promise<UiV2Flag | null> {
  return null;
}
