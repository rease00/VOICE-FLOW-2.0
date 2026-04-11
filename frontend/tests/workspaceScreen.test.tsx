import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const useUserMock = vi.hoisted(() => vi.fn());
const mainAppMock = vi.hoisted(() => vi.fn(() => <div data-testid="main-app-stub">Main App</div>));
const pathnameMock = vi.hoisted(() => vi.fn());
const firebaseAuthMock = vi.hoisted(() => ({ currentUser: null as null | { uid: string } }));
const replaceMock = vi.fn();
const refreshMock = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    replace: replaceMock,
    refresh: refreshMock,
  }),
  usePathname: () => pathnameMock(),
}));

vi.mock('next/dynamic', () => ({
  default: () => (...args: unknown[]) => mainAppMock(...args),
}));

vi.mock('../src/features/auth/context/UserContext', () => ({
  useUser: () => useUserMock(),
}));

vi.mock('../services/firebaseClient', () => ({
  firebaseAuth: firebaseAuthMock,
}));

vi.mock('../src/app/workspace/MainApp', () => ({
  MainApp: (...args: unknown[]) => mainAppMock(...args),
}));

import { WorkspaceScreen } from '../src/app/workspace/WorkspaceScreen';
import { shouldTrackWorkspaceBootstrapElapsed } from '../src/app/workspace/workspaceBootstrap';

describe('WorkspaceScreen', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    firebaseAuthMock.currentUser = null;
    pathnameMock.mockReturnValue('/app');
    useUserMock.mockReturnValue({ authReady: false, isAuthenticated: false });
  });

  it('keeps non-root app routes on the lightweight handoff shell while auth is still resolving without a warm session', () => {
    pathnameMock.mockReturnValue('/app/studio');
    const html = renderToStaticMarkup(<WorkspaceScreen />);

    expect(html).toContain('Restoring your workspace');
    expect(html).not.toContain('Main App');
    expect(mainAppMock).not.toHaveBeenCalled();
  });

  it('hands non-root app routes straight to MainApp while auth is still resolving if Firebase already has a warm session', () => {
    pathnameMock.mockReturnValue('/app/studio');
    firebaseAuthMock.currentUser = { uid: 'warm-user' };

    const html = renderToStaticMarkup(<WorkspaceScreen />);

    expect(html).toContain('Main App');
    expect(mainAppMock).toHaveBeenCalledTimes(1);
  });

  it('shows the guided entry bootstrap copy on the root app route before auth resolves', () => {
    const html = renderToStaticMarkup(<WorkspaceScreen />);

    expect(html).toContain('Opening Studio');
    expect(html).toContain('overflow-hidden');
    expect(html).not.toContain('Main App');
    expect(mainAppMock).not.toHaveBeenCalled();
  });

  it('hands off to MainApp once auth bootstrap finishes', () => {
    pathnameMock.mockReturnValue('/app/studio');
    useUserMock.mockReturnValue({ authReady: true, isAuthenticated: true });

    const html = renderToStaticMarkup(<WorkspaceScreen />);

    expect(html).toContain('Main App');
    expect(mainAppMock).toHaveBeenCalledTimes(1);
  });

  it('shows the guided handoff state for signed-out users on /app', () => {
    useUserMock.mockReturnValue({ authReady: true, isAuthenticated: false });

    const html = renderToStaticMarkup(<WorkspaceScreen />);

    expect(html).toContain('Opening Studio');
    expect(html).toContain('Continue to onboarding');
    expect(html).toContain('overflow-hidden');
    expect(html).not.toContain('Main App');
    expect(mainAppMock).not.toHaveBeenCalled();
  });

  it('keeps authenticated writing paths on the workspace app shell handoff', () => {
    pathnameMock.mockReturnValue('/app/writing');
    useUserMock.mockReturnValue({ authReady: true, isAuthenticated: true });

    const html = renderToStaticMarkup(<WorkspaceScreen />);

    expect(html).toContain('Main App');
    expect(mainAppMock).toHaveBeenCalledTimes(1);
  });

  it('stops tracking bootstrap elapsed time once auth is ready', () => {
    expect(shouldTrackWorkspaceBootstrapElapsed(false)).toBe(true);
    expect(shouldTrackWorkspaceBootstrapElapsed(true)).toBe(false);
  });
});
