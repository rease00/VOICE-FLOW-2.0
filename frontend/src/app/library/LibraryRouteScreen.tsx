"use client";

import { useUser } from "../../features/auth/context/UserContext";
import { useUiV2Surface } from "../../features/feature-flags/useUiV2Surface";
import { LibraryHubV2 } from "../../features/library/v2/LibraryHubV2";
import { LibraryPage } from "../../features/library/LibraryPage";

export function LibraryRouteScreen() {
  const { user } = useUser();
  const useV2 = useUiV2Surface(user?.uid, "library");

  return useV2 ? <LibraryHubV2 /> : <LibraryPage />;
}
