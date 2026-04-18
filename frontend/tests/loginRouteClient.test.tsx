import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

const replaceMock = vi.fn();
const emitMock = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    replace: replaceMock,
  }),
  usePathname: () => '/app/login',
}));

vi.mock('../src/shared/notifications/NotificationProvider', () => ({
  NotificationProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useNotifications: () => ({
    emit: emitMock,
  }),
  useOptionalNotifications: () => ({
    emit: emitMock,
  }),
}));

vi.mock('../src/shared/notifications/NotificationUI', () => ({
  NotificationUI: () => null,
}));

import { AppProviders } from '../src/app/providers/AppProviders';
import { LoginRouteClient } from '../app/(app)/app/login/LoginRouteClient';

describe('LoginRouteClient', () => {
  it('renders under AppProviders without losing the shared user context', () => {
    const html = renderToStaticMarkup(
      <AppProviders>
        <LoginRouteClient initialMode="login" />
      </AppProviders>,
    );

    expect(html).toContain('Sign In');
    expect(html).toContain('route-login-email');
    expect(replaceMock).not.toHaveBeenCalled();
    expect(emitMock).not.toHaveBeenCalled();
  });
});
