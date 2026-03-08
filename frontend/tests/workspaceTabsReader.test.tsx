import { describe, expect, it } from 'vitest';
import { buildWorkspaceTabs, WorkspaceTab } from '../src/features/workspace/model/tabs';

describe('workspace tabs reader contract', () => {
  it('includes the Reader tab for standard users', () => {
    const tabs = buildWorkspaceTabs(false);
    expect(tabs.some((item) => item.id === WorkspaceTab.READER && item.label === 'Reader')).toBe(true);
  });
});
