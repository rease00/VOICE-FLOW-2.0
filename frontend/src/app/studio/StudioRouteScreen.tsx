'use client';

import { useUser } from '../../features/auth/context/UserContext';
import { useUiV2Surface } from '../../features/feature-flags/useUiV2Surface';
import { StudioShellV2 } from '../../features/studio/v2/StudioShellV2';
import { WorkspaceRouteEntryScreen } from '../workspace/WorkspaceRouteEntryScreen';

export function StudioRouteScreen() {
  const { user } = useUser();
  const useV2 = useUiV2Surface(user?.uid, 'studio');

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
