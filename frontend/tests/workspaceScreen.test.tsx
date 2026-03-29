import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const useUserMock = vi.hoisted(() => vi.fn());
const mainAppMock = vi.hoisted(() => vi.fn(() => <div data-testid="main-app-stub">Main App</div>));
const replaceMock = vi.fn();
const refreshMock = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    replace: replaceMock,
    refresh: refreshMock,
  }),
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
    useUserMock.mockReturnValue({ authReady: false });
  });

  it('keeps the bootstrap screen visible until auth is ready', () => {
    const html = renderToStaticMarkup(<WorkspaceScreen />);

    expect(html).toContain('Restoring workspace...');
    expect(html).not.toContain('Main App');
    expect(mainAppMock).not.toHaveBeenCalled();
  });

  it('hands off to MainApp once auth bootstrap finishes', () => {
    useUserMock.mockReturnValue({ authReady: true });

    const html = renderToStaticMarkup(<WorkspaceScreen />);

    expect(html).toContain('Main App');
    expect(mainAppMock).toHaveBeenCalledTimes(1);
  });
});
