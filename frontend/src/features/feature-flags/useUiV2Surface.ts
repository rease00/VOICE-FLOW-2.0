"use client";

import { useUiV2Flag } from "./UiV2FlagContext";
import type { UiV2Flag } from "./uiV2";

/**
 * Returns whether a given v2 surface is enabled for the current user.
 * Reads from the UiV2FlagProvider context — requires the provider to be
 * mounted above in the tree (see app/(app)/app/layout.tsx).
 *
 * Defaults to false on SSR and before the provider hydrates, preventing
 * hydration mismatches.
 */
export function useUiV2Surface(
  uid: string | null | undefined,
  surface: keyof UiV2Flag["surfaces"],
): boolean {
  const { checkSurface } = useUiV2Flag();
  return checkSurface(uid, surface);
}
