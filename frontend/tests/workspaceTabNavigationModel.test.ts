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
  it('keeps the create tabs in the studio, voices, writing order', () => {
    const tabs = buildWorkspaceTabs(false);
    expect(tabs.map((item) => item.id)).toEqual([
      WorkspaceTab.STUDIO,
      WorkspaceTab.VOICE_CLONING,
      WorkspaceTab.WRITING,
      WorkspaceTab.HISTORY,
      WorkspaceTab.BILLING,
    ]);
    expect(tabs.some((item) => item.id === WorkspaceTab.WRITING && item.label === 'Writing')).toBe(true);
  });

  it('maps the writing tab to the canonical writing route', () => {
    const result = buildWorkspaceTabNavigationHref(
      'https://v-flow-ai.local/app/voices?billing=success#top',
      WorkspaceTab.WRITING
    );

    expect(result.tab).toBe(WorkspaceTab.WRITING);
    expect(result.href).toBe('/app/writing?billing=success#top');
    expect(result.changed).toBe(true);
  });

  it('hydrates the writing tab from pathname', () => {
    expect(resolveWorkspaceTabFromPathname('/app/writing')).toBe(WorkspaceTab.WRITING);
    expect(resolveWorkspaceTabFromPathname('/app/writing/chapter-1')).toBe(WorkspaceTab.WRITING);
  });

  it('upgrades legacy novel storage to the writing tab', () => {
    localStorage.setItem(STORAGE_KEYS.workspaceActiveTab, 'NOVEL');
    expect(resolveWorkspaceTabFromStorage()).toBe(WorkspaceTab.WRITING);
  });
});
