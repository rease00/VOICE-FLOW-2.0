import { describe, expect, it } from 'vitest';

import { WorkspaceTab } from '../src/features/workspace/model/tabs';
import {
  buildWorkspaceTabNavigationHref,
  formatMobileAvailableCreditsPercent,
  resolveWorkspaceTabFromPathname,
} from '../views/mainAppHelpers';

describe('workspace tab navigation model', () => {
  it('maps each main workspace tab to its canonical route path', () => {
    const expectations: Array<{ tab: WorkspaceTab; path: string }> = [
      { tab: WorkspaceTab.STUDIO, path: '/app/studio' },
      { tab: WorkspaceTab.VOICE_CLONING, path: '/app/voices' },
      { tab: WorkspaceTab.NOVEL, path: '/app/writing' },
      { tab: WorkspaceTab.READER, path: '/app/reader' },
      { tab: WorkspaceTab.HISTORY, path: '/app/runs' },
      { tab: WorkspaceTab.BILLING, path: '/app/billing' },
      { tab: WorkspaceTab.ADMIN, path: '/app/admin' },
    ];

    expectations.forEach(({ tab, path }) => {
      const result = buildWorkspaceTabNavigationHref(
        'https://voiceflow.local/app/voices?billing=success#top',
        tab
      );
      expect(result.tab).toBe(tab);
      expect(result.href).toBe(`${path}?billing=success#top`);
    });
  });

  it('removes legacy vf-tab query params during tab navigation', () => {
    const result = buildWorkspaceTabNavigationHref(
      'https://voiceflow.local/app/voices?vf-tab=READER&billing=success#credits',
      WorkspaceTab.READER
    );

    expect(result.tab).toBe(WorkspaceTab.READER);
    expect(result.href).toBe('/app/reader?billing=success#credits');
    expect(result.changed).toBe(true);
  });

  it('hydrates active tab from pathname and keeps billing canonical', () => {
    expect(resolveWorkspaceTabFromPathname('/app/billing')).toBe(WorkspaceTab.BILLING);
    expect(resolveWorkspaceTabFromPathname('/app/voices')).toBe(WorkspaceTab.VOICE_CLONING);
  });

  it('does not hydrate active tab from legacy vf-tab state', () => {
    expect(resolveWorkspaceTabFromPathname('/app/reader')).toBe(WorkspaceTab.READER);
  });

  it('formats mobile available credits as percentage of free-limit plus paid capacity', () => {
    expect(formatMobileAvailableCreditsPercent({
      hasUnlimitedAccess: false,
      monthlyFreeRemaining: 500,
      monthlyFreeLimit: 1000,
      paidVfBalance: 500,
    })).toBe('67%');

    expect(formatMobileAvailableCreditsPercent({
      hasUnlimitedAccess: false,
      monthlyFreeRemaining: 0,
      monthlyFreeLimit: 1000,
      paidVfBalance: 0,
    })).toBe('0%');
  });

  it('reports full mobile available credits for unlimited access', () => {
    expect(formatMobileAvailableCreditsPercent({
      hasUnlimitedAccess: true,
      monthlyFreeRemaining: 0,
      monthlyFreeLimit: 0,
      paidVfBalance: 0,
    })).toBe('100%');
  });
});
