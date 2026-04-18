import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { WorkspaceTab, buildWorkspaceTabs } from '../src/features/workspace/model/tabs';
import {
  buildWorkspaceTabNavigationHref,
  resolveWorkspaceTabFromPathname,
  resolveWorkspaceTabFromStorage,
} from '../src/app/workspace/mainAppHelpers';
import { STORAGE_KEYS } from '../src/shared/storage/keys';

const storageState = new Map<string, string>();

beforeEach(() => {
  storageState.clear();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storageState.get(key) || null,
    setItem: (key: string, value: string) => {
      storageState.set(key, String(value));
    },
    removeItem: (key: string) => {
      storageState.delete(key);
    },
    clear: () => {
      storageState.clear();
    },
  } as unknown as Storage);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('workspace tab navigation model', () => {
  it('keeps the create tabs in the studio, voices, readers order', () => {
    const tabs = buildWorkspaceTabs(false);
    expect(tabs.map((item) => item.id)).toEqual([
      WorkspaceTab.STUDIO,
      WorkspaceTab.VOICE_CLONING,
      WorkspaceTab.LIBRARY,
      WorkspaceTab.HISTORY,
      WorkspaceTab.BILLING,
    ]);
    expect(tabs.some((item) => item.id === WorkspaceTab.LIBRARY && item.label === 'Readers')).toBe(true);
  });

  it('maps the library tab to the canonical library route', () => {
    const result = buildWorkspaceTabNavigationHref(
      'https://v-flow-ai.local/app/voices?billing=success#top',
      WorkspaceTab.LIBRARY
    );

    expect(result.tab).toBe(WorkspaceTab.LIBRARY);
    expect(result.href).toBe('/app/library?billing=success#top');
    expect(result.changed).toBe(true);
  });

  it('hydrates the library tab from pathname', () => {
    expect(resolveWorkspaceTabFromPathname('/app/library')).toBe(WorkspaceTab.LIBRARY);
    expect(resolveWorkspaceTabFromPathname('/app/library/chapter-1')).toBe(WorkspaceTab.LIBRARY);
    expect(resolveWorkspaceTabFromPathname('/app/writing')).toBe(WorkspaceTab.LIBRARY);
    expect(resolveWorkspaceTabFromPathname('/app/writing/chapter-1')).toBe(WorkspaceTab.LIBRARY);
  });

  it('upgrades legacy novel/writing storage to the library tab', () => {
    localStorage.setItem(STORAGE_KEYS.workspaceActiveTab, 'NOVEL');
    expect(resolveWorkspaceTabFromStorage()).toBe(WorkspaceTab.LIBRARY);
  });

  it('upgrades legacy WRITING storage to the library tab', () => {
    localStorage.setItem(STORAGE_KEYS.workspaceActiveTab, 'WRITING');
    expect(resolveWorkspaceTabFromStorage()).toBe(WorkspaceTab.LIBRARY);
  });
});
