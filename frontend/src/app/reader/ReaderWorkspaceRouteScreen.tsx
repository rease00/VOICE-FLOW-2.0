'use client';

import { WorkspaceRouteEntryScreen } from '../workspace/WorkspaceRouteEntryScreen';

export function ReaderWorkspaceRouteScreen() {
  return (
    <WorkspaceRouteEntryScreen
      eyebrow="Reader workspace"
      loadingLabel="Opening Reader"
      loadingDescription="Checking your session before loading the shared workspace shell."
      signInTitle="Sign in to open Reader"
      signInDescription="Shelves, saved sessions, and playback controls stay inside your secure workspace session."
      loadingBadges={[
        { label: 'Shelves', value: 'Preparing' },
        { label: 'Session', value: 'Hydrating' },
        { label: 'Controls', value: 'Loading' },
      ]}
    />
  );
}
