"use client";

import { useEffect, useState } from "react";
import {
  DEFAULT_UI_V2_FLAG,
  readCachedFlag,
  resolveSurface,
  type UiV2Flag,
} from "./uiV2";

/**
 * Hook returning whether a given v2 surface is enabled for the current user.
 * Reads from localStorage cache (5 min TTL) populated by a separate sync
 * effect — keeps render path off the network.
 *
 * Server-side renders default to `false` to avoid hydration mismatch; the
 * client effect promotes to the real value on next paint.
 */
export function useUiV2Surface(
  uid: string | null | undefined,
  surface: keyof UiV2Flag["surfaces"],
): boolean {
  const [flag, setFlag] = useState<UiV2Flag>(DEFAULT_UI_V2_FLAG);

  useEffect(() => {
    const cached = readCachedFlag();
    if (cached) setFlag(cached);
  }, []);

  return resolveSurface(uid ?? null, flag, surface);
}
