'use client';

import { WorkspaceRouteEntryScreen } from '../workspace/WorkspaceRouteEntryScreen';

export function VoicesRouteScreen() {
  return (
    <WorkspaceRouteEntryScreen
      eyebrow="Voices workspace"
      loadingLabel="Opening Voices"
      loadingDescription="Checking your session before loading voice cloning tools and cast presets."
      signInTitle="Sign in to open Voices"
      signInDescription="Voice tools, clone flows, and cast presets stay behind secure workspace access."
      loadingBadges={[
        { label: 'Voices', value: 'Preparing' },
        { label: 'Clone tools', value: 'Standing by' },
        { label: 'Access', value: 'Checking' },
      ]}
    />
  );
}
