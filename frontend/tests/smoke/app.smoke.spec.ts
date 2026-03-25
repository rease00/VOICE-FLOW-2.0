import { expect, test, type Page } from '@playwright/test';

const ROUTE_TIMEOUT_MS = 20_000;

type RouteAssertion = {
  path: string;
  title: string;
  expect: (page: Page) => Promise<void>;
};

const waitForAnyVisible = async (page: Page, labels: string[]): Promise<void> => {
  await Promise.race(
    labels.map((label) => page.getByText(label, { exact: true }).waitFor({ state: 'visible', timeout: ROUTE_TIMEOUT_MS }).catch(() => undefined))
  );
};

const trackRouteHealth = (page: Page) => {
  const consoleIssues: string[] = [];
  const pageErrors: string[] = [];

  page.on('console', (message) => {
    const text = message.text().trim();
    if (!text) return;
    const lowered = text.toLowerCase();
    if (message.type() === 'error' || lowered.includes('hydration failed') || lowered.includes('text content does not match server-rendered html')) {
      consoleIssues.push(`[console:${message.type()}] ${text}`);
    }
  });

  page.on('pageerror', (error) => {
    pageErrors.push(error.message);
  });

  return () => {
    const problems = [...consoleIssues.map((message) => `- ${message}`), ...pageErrors.map((message) => `- [pageerror] ${message}`)];
    expect(problems, problems.join('\n')).toEqual([]);
  };
};

const routeSmokeCases: RouteAssertion[] = [
  {
    path: '/',
    title: 'marketing landing',
    expect: async (page) => {
      await expect(page.getByTestId('brand-logo')).toBeVisible({ timeout: ROUTE_TIMEOUT_MS });
      await expect(page.getByRole('heading', { name: /Create voice content that sounds production-ready from day one\./i })).toBeVisible({ timeout: ROUTE_TIMEOUT_MS });
      await expect(page.getByRole('banner').getByRole('link', { name: 'Start Free' })).toBeVisible({ timeout: ROUTE_TIMEOUT_MS });
    },
  },
  {
    path: '/billing',
    title: 'billing landing',
    expect: async (page) => {
      await expect(page.getByTestId('brand-logo')).toBeVisible({ timeout: ROUTE_TIMEOUT_MS });
      await expect(page.getByText('Billing Center', { exact: true })).toBeVisible({ timeout: ROUTE_TIMEOUT_MS });
      await expect(page.getByRole('heading', { name: /Subscription, Token Buy, and Credit Rules/i })).toBeVisible({ timeout: ROUTE_TIMEOUT_MS });
    },
  },
  {
    path: '/legal',
    title: 'legal index',
    expect: async (page) => {
      await expect(page.getByRole('heading', { name: /Legal Center/i })).toBeVisible({ timeout: ROUTE_TIMEOUT_MS });
      await expect(page.getByText('All policy pages', { exact: true })).toBeVisible({ timeout: ROUTE_TIMEOUT_MS });
    },
  },
  {
    path: '/legal/privacy',
    title: 'legal privacy document',
    expect: async (page) => {
      await expect(page.getByRole('heading', { name: /Privacy Policy/i })).toBeVisible({ timeout: ROUTE_TIMEOUT_MS });
      await expect(page.getByText(/Last updated/i)).toBeVisible({ timeout: ROUTE_TIMEOUT_MS });
    },
  },
  {
    path: '/app',
    title: 'workspace root',
    expect: async (page) => {
      await waitForAnyVisible(page, ['Restoring workspace...', 'Secure sign-in for your VoiceFlow workspace.', 'Get Started']);
      await expect(page.locator('body')).toBeVisible();
    },
  },
  {
    path: '/app/login',
    title: 'login',
    expect: async (page) => {
      await expect(page.getByText('Secure sign-in for your VoiceFlow workspace.', { exact: true })).toBeVisible({ timeout: ROUTE_TIMEOUT_MS });
      await expect(page.getByRole('button', { name: /Sign In|Create Account/i })).toBeVisible({ timeout: ROUTE_TIMEOUT_MS });
    },
  },
  {
    path: '/app/onboarding',
    title: 'onboarding',
    expect: async (page) => {
      await expect(page.getByRole('button', { name: /Get Started/i })).toBeVisible({ timeout: ROUTE_TIMEOUT_MS });
    },
  },
  {
    path: '/app/profile',
    title: 'profile',
    expect: async (page) => {
      await waitForAnyVisible(page, ['Account Center', 'Restoring workspace...']);
      await expect(page.getByText(/Back to workspace/i)).toBeVisible({ timeout: ROUTE_TIMEOUT_MS });
    },
  },
  {
    path: '/app/user-id-setup',
    title: 'user id setup',
    expect: async (page) => {
      await expect(page).toHaveURL(/\/app\/login(?:\?.*)?$/);
      await expect(page.getByText('Secure sign-in for your VoiceFlow workspace.', { exact: true })).toBeVisible({ timeout: ROUTE_TIMEOUT_MS });
      await expect(page.getByRole('button', { name: /Sign In/i })).toBeVisible({ timeout: ROUTE_TIMEOUT_MS });
    },
  },
];

for (const routeCase of routeSmokeCases) {
  test(routeCase.title, async ({ page }) => {
    const assertRouteHealth = trackRouteHealth(page);

    await page.goto(routeCase.path, { waitUntil: 'domcontentloaded', timeout: ROUTE_TIMEOUT_MS });
    await routeCase.expect(page);
    await expect(page.locator('body')).toBeVisible();

    assertRouteHealth();
  });
}
