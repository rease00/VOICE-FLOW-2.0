import { describe, expect, it } from 'vitest';
import { buildWorkspaceTabs, resolveWorkspaceNextPreloadTab, WorkspaceTab } from '../src/features/workspace/model/tabs';

describe('workspace tabs reader contract', () => {
  it('includes the full production tab surface for standard users', () => {
    const tabs = buildWorkspaceTabs(false);
    expect(tabs.map((item) => item.id)).toEqual([
      WorkspaceTab.STUDIO,
      WorkspaceTab.VOICE_CLONING,
      WorkspaceTab.NOVEL,
      WorkspaceTab.READER,
      WorkspaceTab.HISTORY,
    ]);
    expect(tabs.some((item) => item.id === WorkspaceTab.READER && item.label === 'Reader')).toBe(true);
    expect(tabs.some((item) => item.id === WorkspaceTab.VOICE_CLONING && item.label === 'Voices')).toBe(true);
  });

  it('keeps Reader after the core create tabs and excludes Admin from main navigation', () => {
    const tabs = buildWorkspaceTabs(false);
    const novelIndex = tabs.findIndex((item) => item.id === WorkspaceTab.NOVEL);
    const readerIndex = tabs.findIndex((item) => item.id === WorkspaceTab.READER);

    expect(readerIndex).toBeGreaterThanOrEqual(0);
    expect(novelIndex).toBeGreaterThanOrEqual(0);
    expect(readerIndex).toBe(novelIndex + 1);
    expect(tabs[readerIndex]?.label).toBe('Reader');
    expect(tabs.some((item) => item.id === WorkspaceTab.ADMIN)).toBe(false);
  });

  it('adds Admin to the main navigation only for admins', () => {
    const tabs = buildWorkspaceTabs(true);

    expect(tabs.at(-1)?.id).toBe(WorkspaceTab.ADMIN);
    expect(tabs.at(-1)?.label).toBe('Admin');
  });

  it('does not preload Reader from Studio by default', () => {
    const tabs = buildWorkspaceTabs(false);
    const preloadTarget = resolveWorkspaceNextPreloadTab(tabs, WorkspaceTab.STUDIO);

    expect(preloadTarget).toBeNull();
  });

  it('preloads the next create tab from Studio only when explicitly enabled', () => {
    const tabs = buildWorkspaceTabs(false);
    const preloadTarget = resolveWorkspaceNextPreloadTab(tabs, WorkspaceTab.STUDIO, {
      allowNextPreloadFromStudio: true,
    });

    expect(preloadTarget).toBe(WorkspaceTab.VOICE_CLONING);
  });
});
