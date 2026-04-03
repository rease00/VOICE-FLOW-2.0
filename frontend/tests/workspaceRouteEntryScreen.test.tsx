import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const useUserMock = vi.hoisted(() => vi.fn());
const pathnameMock = vi.hoisted(() => vi.fn());
const firebaseAuthMock = vi.hoisted(() => ({ currentUser: null as null | { uid: string } }));
const replaceMock = vi.fn();
const workspaceMainAppMock = vi.hoisted(() => vi.fn(() => <div data-testid="workspace-main-app-stub">Workspace Main App</div>));

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    replace: replaceMock,
  }),
  usePathname: () => pathnameMock(),
}));

vi.mock('../src/features/auth/context/UserContext', () => ({
  useUser: () => useUserMock(),
}));

vi.mock('../services/firebaseClient', () => ({
  firebaseAuth: firebaseAuthMock,
}));

vi.mock('../src/app/workspace/WorkspaceMainApp', () => ({
  WorkspaceMainApp: (...args: unknown[]) => workspaceMainAppMock(...args),
}));

import { WorkspaceRouteEntryScreen } from '../src/app/workspace/WorkspaceRouteEntryScreen';

describe('WorkspaceRouteEntryScreen', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    pathnameMock.mockReturnValue('/app/studio');
    firebaseAuthMock.currentUser = null;
    useUserMock.mockReturnValue({ authReady: false, isAuthenticated: false });
  });

  it('shows the lightweight handoff shell for cold signed-out sessions', () => {
    const html = renderToStaticMarkup(
      <WorkspaceRouteEntryScreen
        eyebrow="Studio workspace"
        loadingLabel="Opening Studio"
        loadingDescription="Checking your session before loading the full production workspace."
        signInTitle="Sign in to open Studio"
        signInDescription="Drafts, engine controls, and generation history stay inside your secure workspace session."
      />
    );

    expect(html).toContain('Opening Studio');
    expect(html).not.toContain('Workspace Main App');
    expect(workspaceMainAppMock).not.toHaveBeenCalled();
  });

  it('loads the full workspace immediately when Firebase already has a warm session', () => {
    firebaseAuthMock.currentUser = { uid: 'warm-user' };

    const html = renderToStaticMarkup(
      <WorkspaceRouteEntryScreen
        eyebrow="Studio workspace"
        loadingLabel="Opening Studio"
        loadingDescription="Checking your session before loading the full production workspace."
        signInTitle="Sign in to open Studio"
        signInDescription="Drafts, engine controls, and generation history stay inside your secure workspace session."
      />
    );

    expect(html).toContain('Workspace Main App');
    expect(workspaceMainAppMock).toHaveBeenCalledTimes(1);
  });

  it('loads the full workspace once auth is ready for an authenticated user', () => {
    useUserMock.mockReturnValue({ authReady: true, isAuthenticated: true });

    const html = renderToStaticMarkup(
      <WorkspaceRouteEntryScreen
        eyebrow="Voices workspace"
        loadingLabel="Opening Voices"
        loadingDescription="Checking your session before loading voice cloning, library tools, and cast presets."
        signInTitle="Sign in to open Voices"
        signInDescription="Voice library filters, clone tools, and cast presets stay behind secure workspace access."
      />
    );

    expect(html).toContain('Workspace Main App');
    expect(workspaceMainAppMock).toHaveBeenCalledTimes(1);
  });

  it('shows the sign-in gate once auth resolves for a signed-out user', () => {
    pathnameMock.mockReturnValue('/app/voices');
    useUserMock.mockReturnValue({ authReady: true, isAuthenticated: false });

    const html = renderToStaticMarkup(
      <WorkspaceRouteEntryScreen
        eyebrow="Voices workspace"
        loadingLabel="Opening Voices"
        loadingDescription="Checking your session before loading voice cloning, library tools, and cast presets."
        signInTitle="Sign in to open Voices"
        signInDescription="Voice library filters, clone tools, and cast presets stay behind secure workspace access."
      />
    );

    expect(html).toContain('Sign in to open Voices');
    expect(html).toContain('Open secure sign-in');
    expect(html).toContain('Create account');
    expect(html).not.toContain('Workspace Main App');
    expect(workspaceMainAppMock).not.toHaveBeenCalled();
  });
});
