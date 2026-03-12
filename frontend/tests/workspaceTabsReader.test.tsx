import { describe, expect, it } from 'vitest';
import { buildWorkspaceTabs, WorkspaceTab } from '../src/features/workspace/model/tabs';

describe('workspace tabs reader contract', () => {
  it('includes the full production tab surface for standard users', () => {
    const tabs = buildWorkspaceTabs(false);
    expect(tabs.map((item) => item.id)).toEqual([
      WorkspaceTab.STUDIO,
      WorkspaceTab.PODCAST,
      WorkspaceTab.READER,
      WorkspaceTab.NOVEL,
      WorkspaceTab.CHARACTERS,
      WorkspaceTab.HISTORY,
    ]);
    expect(tabs.some((item) => item.id === WorkspaceTab.READER && item.label === 'Reader')).toBe(true);
  });

  it('includes Podcast immediately after Studio and excludes Lab/Admin from main navigation', () => {
    const tabs = buildWorkspaceTabs(false);
    const studioIndex = tabs.findIndex((item) => item.id === WorkspaceTab.STUDIO);
    const podcastIndex = tabs.findIndex((item) => item.id === WorkspaceTab.PODCAST);

    expect(podcastIndex).toBeGreaterThanOrEqual(0);
    expect(podcastIndex).toBe(studioIndex + 1);
    expect(tabs[podcastIndex]?.label).toBe('Podcast');
    expect(tabs.some((item) => item.id === WorkspaceTab.LAB)).toBe(false);
    expect(tabs.some((item) => item.id === WorkspaceTab.ADMIN)).toBe(false);
  });

  it('adds Admin to the main navigation only for admins', () => {
    const tabs = buildWorkspaceTabs(true);

    expect(tabs.at(-1)?.id).toBe(WorkspaceTab.ADMIN);
    expect(tabs.at(-1)?.label).toBe('Admin');
  });
});
