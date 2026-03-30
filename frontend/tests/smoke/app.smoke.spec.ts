import { expect, test, type Page } from '@playwright/test';

const ROUTE_TIMEOUT_MS = 20_000;
const MOBILE_VIEWPORT = { width: 390, height: 844 };

type RouteAssertion = {
  path: string;
  title: string;
  expect: (page: Page) => Promise<void>;
};

const waitForAnyVisible = async (page: Page, labels: string[]): Promise<void> => {
  await Promise.any(
    labels.map((label) => page.getByText(label, { exact: true }).waitFor({ state: 'visible', timeout: ROUTE_TIMEOUT_MS }))
  );
};

const expectNoHorizontalBleed = async (page: Page): Promise<void> => {
  const metrics = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }));

  expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.innerWidth);
};

const expectRailMetrics = async (page: Page, selector: string, requireOverflow = true): Promise<void> => {
  const metrics = await page.locator(selector).evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      scrollWidth: element.scrollWidth,
      clientWidth: element.clientWidth,
      overflowX: style.overflowX,
      scrollbarWidth: style.scrollbarWidth,
    };
  });

  if (requireOverflow) {
    expect(metrics.scrollWidth).toBeGreaterThan(metrics.clientWidth);
  } else {
    expect(metrics.scrollWidth).toBeGreaterThanOrEqual(metrics.clientWidth);
  }
  expect(metrics.overflowX).toMatch(/auto|scroll/);
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
    path: '/billing',
    title: 'billing public page',
    expect: async (page) => {
      await expect(page.getByTestId('brand-logo')).toBeVisible({ timeout: ROUTE_TIMEOUT_MS });
      await expect(page.getByText('Plans & Billing', { exact: true })).toBeVisible({ timeout: ROUTE_TIMEOUT_MS });
      await expect(page.getByRole('heading', { name: /Plans, credits, and billing/i })).toBeVisible({ timeout: ROUTE_TIMEOUT_MS });
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
      await page.setViewportSize(MOBILE_VIEWPORT);
      await waitForAnyVisible(page, ['Opening Studio', 'Restoring your workspace', 'Workspace handoff']);
      await expect(page.locator('body')).toBeVisible();
      await expectNoHorizontalBleed(page);
    },
  },
  {
    path: '/app/reader',
    title: 'reader smoke',
    expect: async (page) => {
      await page.setViewportSize(MOBILE_VIEWPORT);
      await Promise.any([
        page.getByTestId('reader-browse-home').waitFor({ state: 'visible', timeout: ROUTE_TIMEOUT_MS }),
        page.getByTestId('brand-logo').first().waitFor({ state: 'visible', timeout: ROUTE_TIMEOUT_MS }),
        page.getByRole('button', { name: /Get Started|Sign In|Create Account|Test Drive|Create Your First Scene|Listen to Live Demos/i }).waitFor({ state: 'visible', timeout: ROUTE_TIMEOUT_MS }),
      ]).catch(() => undefined);
      await expect(page.locator('body')).toBeVisible();
      const readerRail = page.locator('.vf-reader-v2-tray__tabs');
      if (await readerRail.count()) {
        await expectRailMetrics(page, '.vf-reader-v2-tray__tabs');
      }
      await expectNoHorizontalBleed(page);
    },
  },
  {
    path: '/app/login',
    title: 'login',
    expect: async (page) => {
      await expect(page.getByRole('heading', { name: /Welcome back/i })).toBeVisible({ timeout: ROUTE_TIMEOUT_MS });
      await expect(page.getByText('Secure access to your V FLOW AI account.', { exact: true })).toBeVisible({ timeout: ROUTE_TIMEOUT_MS });
      await expect(page.getByRole('button', { name: 'Sign In', exact: true })).toBeVisible({ timeout: ROUTE_TIMEOUT_MS });
      await expect(page.getByRole('button', { name: 'Sign Up', exact: true })).toBeVisible({ timeout: ROUTE_TIMEOUT_MS });
    },
  },
  {
    path: '/app/onboarding',
    title: 'onboarding',
    expect: async (page) => {
      await expect(page.getByRole('button', { name: /Create Account/i })).toBeVisible({ timeout: ROUTE_TIMEOUT_MS });
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
      await expect(page.getByText('Secure access to your V FLOW AI account.', { exact: true })).toBeVisible({ timeout: ROUTE_TIMEOUT_MS });
      await expect(page.getByRole('button', { name: 'Sign In', exact: true })).toBeVisible({ timeout: ROUTE_TIMEOUT_MS });
    },
  },
];

for (const routeCase of routeSmokeCases) {
  test(routeCase.title, async ({ page }) => {
    const assertRouteHealth = trackRouteHealth(page);

    await page.goto(routeCase.path, {
      waitUntil: 'domcontentloaded',
      timeout: ROUTE_TIMEOUT_MS,
    });
    await routeCase.expect(page);
    await expect(page.locator('body')).toBeVisible();

    assertRouteHealth();
  });
}
