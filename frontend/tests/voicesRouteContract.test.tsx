import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { buildWorkspaceTabs, WorkspaceTab } from '../src/features/workspace/model/tabs';

const workspaceScreenMock = vi.hoisted(() => vi.fn(() => <div data-testid="workspace-screen-stub">Workspace Screen</div>));

vi.mock('../src/app/workspace/WorkspaceScreen', () => ({
  WorkspaceScreen: (...args: unknown[]) => workspaceScreenMock(...args),
}));

import VoicesRoutePage from '../app/(app)/app/voices/page';

describe('voices route contract', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('keeps the Voices workspace tab anchored to /app/voices', () => {
    const voicesTab = buildWorkspaceTabs(false).find((item) => item.id === WorkspaceTab.VOICE_CLONING);

    expect(voicesTab?.label).toBe('Voices');
    expect(voicesTab?.route).toBe('/app/voices');
  });

  it('routes /app/voices through WorkspaceScreen', () => {
    const html = renderToStaticMarkup(<VoicesRoutePage />);

    expect(html).toContain('Workspace Screen');
    expect(workspaceScreenMock).toHaveBeenCalledTimes(1);
  });
});
