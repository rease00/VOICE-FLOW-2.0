'use client';

import { WorkspaceRouteEntryScreen } from '../workspace/WorkspaceRouteEntryScreen';

export function StudioRouteScreen() {
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
