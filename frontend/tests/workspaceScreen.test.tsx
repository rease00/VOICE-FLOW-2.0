import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const useUserMock = vi.hoisted(() => vi.fn());
const mainAppMock = vi.hoisted(() => vi.fn(() => <div data-testid="main-app-stub">Main App</div>));
const pathnameMock = vi.hoisted(() => vi.fn());
const replaceMock = vi.fn();
const refreshMock = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    replace: replaceMock,
    refresh: refreshMock,
  }),
  usePathname: () => pathnameMock(),
}));

vi.mock('../src/features/auth/context/UserContext', () => ({
  useUser: () => useUserMock(),
}));

vi.mock('../views/MainApp', () => ({
  MainApp: (...args: unknown[]) => mainAppMock(...args),
}));

import { WorkspaceScreen } from '../src/app/workspace/WorkspaceScreen';

describe('WorkspaceScreen', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    pathnameMock.mockReturnValue('/app');
    useUserMock.mockReturnValue({ authReady: false, isAuthenticated: false });
  });

  it('keeps the workspace bootstrap screen visible on non-root app routes until auth is ready', () => {
    pathnameMock.mockReturnValue('/app/studio');
    const html = renderToStaticMarkup(<WorkspaceScreen />);

    expect(html).toContain('Restoring your workspace');
    expect(html).toContain('overflow-hidden');
    expect(html).not.toContain('Main App');
    expect(mainAppMock).not.toHaveBeenCalled();
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
});
