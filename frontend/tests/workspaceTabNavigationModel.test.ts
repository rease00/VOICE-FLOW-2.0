import { describe, expect, it } from 'vitest';

import { WorkspaceTab } from '../src/features/workspace/model/tabs';
import {
  buildWorkspaceTabNavigationHref,
  formatMobileAvailableCreditsPercent,
  normalizeWorkspaceTabCandidate,
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

  it('normalizes legacy CHARACTERS selection to VOICE_CLONING', () => {
    const normalized = normalizeWorkspaceTabCandidate(WorkspaceTab.CHARACTERS);
    const result = buildWorkspaceTabNavigationHref(
      'https://voiceflow.local/app/characters',
      WorkspaceTab.CHARACTERS
    );

    expect(normalized).toBe(WorkspaceTab.VOICE_CLONING);
    expect(result.tab).toBe(WorkspaceTab.VOICE_CLONING);
    expect(result.href).toBe('/app/voices');
  });

  it('hydrates active tab from pathname and does not fall back to stale tab state', () => {
    const staleActiveTab = WorkspaceTab.VOICE_CLONING;
    const pathDrivenTab = normalizeWorkspaceTabCandidate(
      resolveWorkspaceTabFromPathname('/app/reader')
    );

    expect(pathDrivenTab).toBe(WorkspaceTab.READER);
    expect(pathDrivenTab).not.toBe(staleActiveTab);
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
