import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { ensureStudioSmokeAuthenticated, resolveStudioSmokeCredentials } from './smokeAuth';
import { getLegalDocuments } from '../../src/features/legal/legalContent';

const ROUTE_TIMEOUT_MS = 20_000;
const MOBILE_VIEWPORT = { width: 390, height: 844 };

type RouteAssertion = {
  path: string;
  title: string;
  expect: (page: Page, testInfo: TestInfo) => Promise<void>;
  trackRouteHealth?: boolean;
  requiresAuth?: boolean;
};

const resolveWritingViewport = (projectName: string) => {
  const normalized = projectName.toLowerCase();
  if (normalized.includes('mobile')) return { width: 390, height: 844 };
  if (normalized.includes('tablet')) return { width: 820, height: 1180 };
  return { width: 1366, height: 768 };
};

const waitForAnyVisible = async (page: Page, labels: string[]): Promise<void> => {
  await Promise.any(
    labels.map((label) => page.getByText(label, { exact: true }).waitFor({ state: 'visible', timeout: ROUTE_TIMEOUT_MS }))
  );
};

const resolveRouteUrl = (page: Page, path: string): string => {
  try {
    const current = new URL(page.url());
    if (current.protocol.startsWith('http')) {
      return new URL(path, current.origin).toString();
    }
  } catch {
    // Fall back to Playwright baseURL-relative navigation.
  }
  return path;
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

const LANDING_SURFACE_TEST_IDS = [
  'landing-home',
  'landing-single-speaker',
  'landing-multi-speaker',
  'landing-ai-director',
] as const;

const expectLandingChrome = async (page: Page): Promise<void> => {
  await expect(page.getByTestId('brand-logo').first()).toBeVisible({ timeout: ROUTE_TIMEOUT_MS });
  await expect(page.getByTestId('marketing-landing')).toBeVisible({ timeout: ROUTE_TIMEOUT_MS });
  await expect(page.getByRole('navigation', { name: /Landing navigation/i })).toBeVisible({ timeout: ROUTE_TIMEOUT_MS });
  await expect(page.getByTestId('landing-next-nav')).toBeVisible({ timeout: ROUTE_TIMEOUT_MS });
  await expectNoHorizontalBleed(page);
};

const expectLoginSurface = async (page: Page): Promise<void> => {
  await expect(page.getByRole('heading', { name: /Welcome back/i })).toBeVisible({ timeout: ROUTE_TIMEOUT_MS });
  await expect(page.getByText('Sign in to continue to your workspace.', { exact: true })).toBeVisible({ timeout: ROUTE_TIMEOUT_MS });
  await expect(page.getByText(/^Login$/i)).toBeVisible({ timeout: ROUTE_TIMEOUT_MS });
  await expect(page.getByText(/^Signup\s*\(Paused\)$/i)).toBeVisible({ timeout: ROUTE_TIMEOUT_MS });
  await expect(page.getByRole('button', { name: 'Sign In', exact: true })).toBeVisible({ timeout: ROUTE_TIMEOUT_MS });
};

const expectLibrarySurface = async (page: Page): Promise<void> => {
  await Promise.any([
    page.getByTestId('readers-subnav').first().waitFor({ state: 'visible', timeout: ROUTE_TIMEOUT_MS }),
    page.getByRole('heading', { name: /^Library$/i }).first().waitFor({ state: 'visible', timeout: ROUTE_TIMEOUT_MS }),
  ]);
};

const expectAdminSurface = async (page: Page): Promise<void> => {
  await expect(page.getByRole('heading', { name: /Admin Console/i })).toBeVisible({ timeout: ROUTE_TIMEOUT_MS });
};

const legalRouteCases: RouteAssertion[] = getLegalDocuments().map((document) => ({
  path: document.path,
  title: `legal ${document.id}`,
  expect: async (page: Page) => {
    await expect(page.getByRole('heading', { name: document.title, exact: true })).toBeVisible({ timeout: ROUTE_TIMEOUT_MS });
    await expect(page.getByText(`Last updated ${document.lastUpdated}`, { exact: true })).toBeVisible({ timeout: ROUTE_TIMEOUT_MS });
  },
}));

const expectOnlyActiveLandingSurface = async (
  page: Page,
  activeSurface: (typeof LANDING_SURFACE_TEST_IDS)[number],
): Promise<void> => {
  for (const testId of LANDING_SURFACE_TEST_IDS) {
    const locator = page.getByTestId(testId);
    if (testId === activeSurface) {
      await expect(locator).toBeVisible({ timeout: ROUTE_TIMEOUT_MS });
      continue;
    }
    await expect(locator).toHaveCount(0);
  }
};

const expectNoLandingMediaRequestsBeforeInteraction = async (page: Page): Promise<void> => {
  const mediaRequests = await page.evaluate(() => (
    performance
      .getEntriesByType('resource')
      .map((entry) => entry.name)
      .filter((name) => /\.(wav|mp3|ogg|m4a)(\?|$)/i.test(name))
  ));

  expect(mediaRequests).toEqual([]);
};

const isKnownConsoleNoise = (message: string): boolean => {
  const lowered = message.toLowerCase();

  // Google telemetry calls are sometimes blocked by CSP in mobile smoke runs.
  // Ignore only the explicit gen_204 noise so genuine CSP breaks still fail.
  if (
    lowered.includes('apis.google.com/js/gen_204') &&
    (lowered.includes('content security policy') || lowered.includes('csp'))
  ) {
    return true;
  }

  if (
    lowered.includes('failed to load resource') &&
    (
      lowered.includes('err_connection_refused')
      || lowered.includes('status of 502')
      || lowered.includes('status of 401')
      || lowered.includes('status of 403')
      || lowered.includes('status of 404')
    )
  ) {
    return true;
  }

  // The app falls back to offline mode when Firestore is temporarily unreachable during
  // local smoke runs. That transient console error should not fail route rendering checks.
  return (
    lowered.includes('@firebase/firestore') &&
    lowered.includes('could not reach cloud firestore backend') &&
    lowered.includes('offline mode')
  );
};

const trackRouteHealth = (page: Page) => {
  const consoleIssues: string[] = [];
  const pageErrors: string[] = [];

  page.on('console', (message) => {
    const text = message.text().trim();
    if (!text) return;
    const lowered = text.toLowerCase();
    if (isKnownConsoleNoise(text)) return;
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
    title: 'billing premium page',
    expect: async (page) => {
      await expect(page.getByTestId('brand-logo').first()).toBeVisible({ timeout: ROUTE_TIMEOUT_MS });
      await expect(page.getByRole('heading', { name: /Pricing is coming soon/i })).toBeVisible({ timeout: ROUTE_TIMEOUT_MS });
      await expect(page.getByText('Plans are blurred until launch.')).toBeVisible({ timeout: ROUTE_TIMEOUT_MS });
    },
  },
  {
    path: '/landing',
    title: 'landing overview page',
    expect: async (page) => {
      await expectLandingChrome(page);
      await expectOnlyActiveLandingSurface(page, 'landing-home');
      await expect(page.getByTestId('landing-home-hero')).toBeVisible({ timeout: ROUTE_TIMEOUT_MS });
      await expect(page.getByRole('heading', { name: /Audition voices/i })).toBeVisible({ timeout: ROUTE_TIMEOUT_MS });
      await expect(page.getByRole('link', { name: /Start free/i }).first()).toBeVisible({ timeout: ROUTE_TIMEOUT_MS });
      await expectNoLandingMediaRequestsBeforeInteraction(page);
    },
  },
  {
    path: '/landing/single-voice',
    title: 'landing single voice page',
    expect: async (page) => {
      await expectLandingChrome(page);
      await expectOnlyActiveLandingSurface(page, 'landing-single-speaker');
      await expect(page.getByText('Hear short reads before you commit the scene.', { exact: true })).toBeVisible({ timeout: ROUTE_TIMEOUT_MS });
      await expect(page.getByRole('link', { name: /Next: Prime Scenes/i })).toBeVisible({ timeout: ROUTE_TIMEOUT_MS });
      await expectNoLandingMediaRequestsBeforeInteraction(page);
    },
  },
  {
    path: '/landing/prime-scenes',
    title: 'landing prime scenes page',
    expect: async (page) => {
      await expectLandingChrome(page);
      await expectOnlyActiveLandingSurface(page, 'landing-multi-speaker');
      await expect(page.getByText('Prime Scenes are where Voice Flow stops sounding like isolated clips and starts sounding like a finished scene.')).toBeVisible({ timeout: ROUTE_TIMEOUT_MS });
      await expect(page.getByRole('link', { name: /Next: AI Direction/i })).toBeVisible({ timeout: ROUTE_TIMEOUT_MS });
      await expectNoLandingMediaRequestsBeforeInteraction(page);
    },
  },
  {
    path: '/landing/direction',
    title: 'landing ai direction page',
    expect: async (page) => {
      await expectLandingChrome(page);
      await expectOnlyActiveLandingSurface(page, 'landing-ai-director');
      await expect(page.getByTestId('landing-ai-director-prompt')).toBeVisible({ timeout: ROUTE_TIMEOUT_MS });
      await expect(page.getByRole('link', { name: /Open the Studio/i })).toBeVisible({ timeout: ROUTE_TIMEOUT_MS });
      await expectNoLandingMediaRequestsBeforeInteraction(page);
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
    path: '/app/writing',
    title: 'writing workspace responsive',
    requiresAuth: true,
    expect: async (page, testInfo) => {
      const viewport = resolveWritingViewport(testInfo.project.name);
      await page.setViewportSize(viewport);
      await expect(page).toHaveURL(/\/app\/writing(?:\/|$|\?)/);
      await Promise.any([
        page.getByTestId('novel-workspace').first().waitFor({ state: 'visible', timeout: ROUTE_TIMEOUT_MS }),
        page.getByTestId('novel-editor-tabs').first().waitFor({ state: 'visible', timeout: ROUTE_TIMEOUT_MS }),
        page.getByTestId('novel-library-tabs').first().waitFor({ state: 'visible', timeout: ROUTE_TIMEOUT_MS }),
      ]);
      await expect(page.getByTestId('novel-workspace').first()).toBeVisible({ timeout: ROUTE_TIMEOUT_MS });
      await expectNoHorizontalBleed(page);
    },
  },
  {
    path: '/app/admin',
    title: 'admin route canary',
    requiresAuth: true,
    expect: async (page) => {
      await expect(page).toHaveURL(/\/app\/admin(?:\/|$|\?)/);
      await expectAdminSurface(page);
    },
  },
  {
    path: '/app/login',
    title: 'login',
    expect: async (page) => {
      await expectLoginSurface(page);
    },
  },
  {
    path: '/app/onboarding',
    title: 'onboarding',
    expect: async (page) => {
      await expect(page).toHaveURL(/\/app\/login(?:\?.*next=%2Fapp%2Fonboarding.*)?$/);
      await expectLoginSurface(page);
    },
  },
  {
    path: '/app/profile',
    title: 'profile',
    expect: async (page) => {
      await expect(page).toHaveURL(/\/app\/login(?:\?.*next=%2Fapp%2Fprofile.*)?$/);
      await expectLoginSurface(page);
    },
  },
  {
    path: '/app/user-id-setup',
    title: 'user id setup',
    expect: async (page) => {
      await expect(page).toHaveURL(/\/app\/login(?:\?.*)?$/);
      await expectLoginSurface(page);
    },
  },
  {
    path: '/app/account',
    title: 'account redirect',
    requiresAuth: true,
    expect: async (page) => {
      await expect(page).toHaveURL(/\/app\/profile(?:\/|$|\?)/);
      await expect(page.getByRole('heading', { name: /Account Center/i })).toBeVisible({ timeout: ROUTE_TIMEOUT_MS });
    },
  },
  {
    path: '/app/billing',
    title: 'billing app surface',
    requiresAuth: true,
    expect: async (page) => {
      await expect(page).toHaveURL(/\/app\/billing(?:\/|$|\?)/);
      await expect(page.getByRole('heading', { name: /Manage billing, credits, and checkout/i })).toBeVisible({ timeout: ROUTE_TIMEOUT_MS });
    },
  },
  {
    path: '/app/reader',
    title: 'reader redirect',
    requiresAuth: true,
    expect: async (page) => {
      await expect(page).toHaveURL(/\/app\/library(?:\/|$|\?)/);
      await expectLibrarySurface(page);
    },
  },
  {
    path: '/app/library',
    title: 'library surface',
    expect: async (page) => {
      await expectLibrarySurface(page);
    },
  },
  ...legalRouteCases,
];

for (const routeCase of routeSmokeCases) {
  test(routeCase.title, async ({ page }, testInfo) => {
    if (routeCase.requiresAuth) {
      test.setTimeout(120_000);
    }
    const assertRouteHealth = routeCase.trackRouteHealth === false ? null : trackRouteHealth(page);
    if (routeCase.requiresAuth) {
      const credentials = resolveStudioSmokeCredentials();
      test.skip(!credentials, 'Missing Playwright admin credentials for authenticated smoke coverage.');
      await ensureStudioSmokeAuthenticated(page, credentials!, { preloadWritingSurface: false });
    }

    const currentPath = new URL(page.url()).pathname || '';
    if (currentPath !== routeCase.path) {
      await page.goto(resolveRouteUrl(page, routeCase.path), {
        waitUntil: 'domcontentloaded',
        timeout: ROUTE_TIMEOUT_MS,
      });
    }
    await routeCase.expect(page, testInfo);
    await expect(page.locator('body')).toBeVisible();

    assertRouteHealth?.();
  });
}

