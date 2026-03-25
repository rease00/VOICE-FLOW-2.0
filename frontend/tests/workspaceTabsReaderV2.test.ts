import { describe, expect, it } from 'vitest';
import { buildWorkspaceTabs, WorkspaceTab } from '../src/features/workspace/model/tabs';

describe('workspace tab contract reader v2', () => {
  it('includes reader for standard users', () => {
    const tabs = buildWorkspaceTabs(false);
    expect(tabs.map((item) => item.id)).toEqual([
      WorkspaceTab.STUDIO,
      WorkspaceTab.READER,
      WorkspaceTab.NOVEL,
      WorkspaceTab.CHARACTERS,
      WorkspaceTab.HISTORY,
    ]);
    expect(tabs.some((item) => item.id === WorkspaceTab.READER && item.label === 'Reader')).toBe(true);
  });

  it('appends admin only for admin users', () => {
    const tabs = buildWorkspaceTabs(true);
    expect(tabs.at(-1)?.id).toBe(WorkspaceTab.ADMIN);
  });
});
