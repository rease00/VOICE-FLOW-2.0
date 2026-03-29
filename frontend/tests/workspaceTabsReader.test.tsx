import { describe, expect, it } from 'vitest';
import { buildWorkspaceTabs, resolveWorkspaceNextPreloadTab, WorkspaceTab } from '../src/features/workspace/model/tabs';

describe('workspace tabs reader contract', () => {
  it('includes the full production tab surface for standard users', () => {
    const tabs = buildWorkspaceTabs(false);
    expect(tabs.map((item) => item.id)).toEqual([
      WorkspaceTab.STUDIO,
      WorkspaceTab.READER,
      WorkspaceTab.VOICE_CLONING,
      WorkspaceTab.NOVEL,
      WorkspaceTab.CHARACTERS,
      WorkspaceTab.HISTORY,
    ]);
    expect(tabs.some((item) => item.id === WorkspaceTab.READER && item.label === 'Reader')).toBe(true);
    expect(tabs.some((item) => item.id === WorkspaceTab.VOICE_CLONING && item.label === 'Voice Cloning')).toBe(true);
  });

  it('keeps Reader immediately after Studio and excludes Admin from main navigation', () => {
    const tabs = buildWorkspaceTabs(false);
    const studioIndex = tabs.findIndex((item) => item.id === WorkspaceTab.STUDIO);
    const readerIndex = tabs.findIndex((item) => item.id === WorkspaceTab.READER);

    expect(readerIndex).toBeGreaterThanOrEqual(0);
    expect(readerIndex).toBe(studioIndex + 1);
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

  it('preloads Reader from Studio only when explicitly enabled', () => {
    const tabs = buildWorkspaceTabs(false);
    const preloadTarget = resolveWorkspaceNextPreloadTab(tabs, WorkspaceTab.STUDIO, {
      allowReaderPreload: true,
      allowNextPreloadFromStudio: true,
    });

    expect(preloadTarget).toBe(WorkspaceTab.READER);
  });
});
