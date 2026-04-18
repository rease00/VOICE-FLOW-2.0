'use client';

import { useUser } from '../../features/auth/context/UserContext';
import { resolveSurface, readCachedFlag, DEFAULT_UI_V2_FLAG } from '../../features/feature-flags/uiV2';
import { StudioShellV2 } from '../../features/studio/v2/StudioShellV2';
import { WorkspaceRouteEntryScreen } from '../workspace/WorkspaceRouteEntryScreen';

export function StudioRouteScreen() {
  const { user } = useUser();
  const flag = readCachedFlag() ?? DEFAULT_UI_V2_FLAG;
  const useV2 = resolveSurface(user?.uid ?? null, flag, 'studio');

  if (useV2) {
    return <StudioShellV2 />;
  }

  return (
    <WorkspaceRouteEntryScreen
      eyebrow="Studio workspace"
      loadingLabel="Opening Studio"
      loadingDescription="Checking your session before loading the full production workspace."
      signInTitle="Sign in to open Studio"
      signInDescription="Drafts, engine controls, and generation history stay inside your secure workspace session."
      loadingBadges={[
        { label: 'Studio', value: 'Preparing' },
        { label: 'Voices', value: 'Standing by' },
        { label: 'Access', value: 'Checking' },
      ]}
    />
  );
}
