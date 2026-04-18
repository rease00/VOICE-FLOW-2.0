"use client";

import { useUser } from "../../features/auth/context/UserContext";
import {
  DEFAULT_UI_V2_FLAG,
  readCachedFlag,
  resolveSurface,
} from "../../features/feature-flags/uiV2";
import { LibraryHubV2 } from "../../features/library/v2/LibraryHubV2";
import { LibraryPage } from "../../features/library/LibraryPage";

export function LibraryRouteScreen() {
  const { user } = useUser();
  const flag = readCachedFlag() ?? DEFAULT_UI_V2_FLAG;
  const useV2 = resolveSurface(user?.uid ?? null, flag, "library");

  return useV2 ? <LibraryHubV2 /> : <LibraryPage />;
}
