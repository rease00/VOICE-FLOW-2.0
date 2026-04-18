import { expect, test, type Page } from '@playwright/test';
import { STORAGE_KEYS } from '../../src/shared/storage/keys';
import { ensureStudioSmokeAuthenticated, resolveStudioSmokeCredentials } from './smokeAuth';

const ROUTE_TIMEOUT_MS = 45_000;
const DESKTOP_THEME_STATE = {
  theme: 'dark',
  brandTheme: 'neon',
  motion: 'off',
} as const;

const seedWorkspaceThemeState = async (page: Page): Promise<void> => {
  await page.addInitScript(({ storageKeys, storedPreferences }) => {
    localStorage.setItem(storageKeys.uiTheme, storedPreferences.theme);
    localStorage.setItem(storageKeys.uiBrandTheme, storedPreferences.brandTheme);
    localStorage.setItem(storageKeys.uiMotionLevel, storedPreferences.motion);
  }, {
    storageKeys: {
      uiTheme: STORAGE_KEYS.uiTheme,
      uiBrandTheme: STORAGE_KEYS.uiBrandTheme,
      uiMotionLevel: STORAGE_KEYS.uiMotionLevel,
    },
    storedPreferences: DESKTOP_THEME_STATE,
  });
};

const expectNoHorizontalBleed = async (page: Page): Promise<void> => {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const metrics = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        innerWidth: window.innerWidth,
      }));
      expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.innerWidth);
      return;
    } catch (error) {
      const message = String((error as Error)?.message || error || '');
      const contextDestroyed = /Execution context was destroyed/i.test(message);
      if (!contextDestroyed || attempt === 3) throw error;
      await page.waitForTimeout(250);
    }
  }
};

const trackRouteHealth = (page: Page) => {
  const consoleIssues: string[] = [];
  const pageErrors: string[] = [];
  const isKnownConsoleNoise = (message: string): boolean => {
    const lowered = message.toLowerCase();
    if (
      lowered.includes('@firebase/firestore') &&
      lowered.includes('could not reach cloud firestore backend') &&
      lowered.includes('offline mode')
    ) {
      return true;
    }
    return (
      lowered.includes('failed to load resource') &&
      (
        lowered.includes('err_connection_refused')
        || lowered.includes('status of 502')
        || lowered.includes('status of 401')
        || lowered.includes('status of 403')
        || lowered.includes('status of 404')
      )
    );
  };

  page.on('console', (message) => {
    const text = message.text().trim();
    if (!text) return;
    const lowered = text.toLowerCase();
    if (isKnownConsoleNoise(text)) return;
    if (
      message.type() === 'error' ||
      lowered.includes('hydration failed') ||
      lowered.includes('text content does not match server-rendered html')
    ) {
      consoleIssues.push(`[console:${message.type()}] ${text}`);
    }
  });

  page.on('pageerror', (error) => {
    pageErrors.push(error.message);
  });

  return () => {
    const problems = [
      ...consoleIssues.map((message) => `- ${message}`),
      ...pageErrors.map((message) => `- [pageerror] ${message}`),
    ];
    expect(problems, problems.join('\n')).toEqual([]);
  };
};

const waitForStudioWorkspace = async (page: Page): Promise<void> => {
  await Promise.any([
    page.locator('.vf-studio-grid').first().waitFor({ state: 'visible', timeout: ROUTE_TIMEOUT_MS }),
    page.locator('.vf-editor-shell').first().waitFor({ state: 'visible', timeout: ROUTE_TIMEOUT_MS }),
    page.getByRole('button', { name: /^Import$/i }).first().waitFor({ state: 'visible', timeout: ROUTE_TIMEOUT_MS }),
  ]);
};

const waitForVoicesWorkspace = async (page: Page): Promise<void> => {
  await page.waitForURL(/\/app\/voices(?:\/|$|\?)/, { timeout: ROUTE_TIMEOUT_MS }).catch(() => undefined);
  await Promise.any([
    page.getByTestId('voices-workspace').waitFor({ state: 'visible', timeout: ROUTE_TIMEOUT_MS }),
    page.locator('.vf-voices-shell').first().waitFor({ state: 'visible', timeout: ROUTE_TIMEOUT_MS }),
    page.locator('.vf-voice-clone-shell').first().waitFor({ state: 'visible', timeout: ROUTE_TIMEOUT_MS }),
    page.locator('.vf-topbar').first().waitFor({ state: 'visible', timeout: ROUTE_TIMEOUT_MS }),
    page.getByRole('heading', { name: /Voice Cloning/i }).first().waitFor({ state: 'visible', timeout: ROUTE_TIMEOUT_MS }),
    page.getByText('Library', { exact: true }).first().waitFor({ state: 'visible', timeout: ROUTE_TIMEOUT_MS }),
    page.getByRole('button', { name: /Create .* Clone|Start Cloning|Import/i }).first().waitFor({ state: 'visible', timeout: ROUTE_TIMEOUT_MS }),
  ]);
};

const waitForWritingWorkspace = async (page: Page): Promise<void> => {
  await page.waitForURL(/\/app\/writing(?:\/|$|\?)/, { timeout: ROUTE_TIMEOUT_MS }).catch(() => undefined);
  await Promise.any([
    page.getByTestId('novel-workspace').first().waitFor({ state: 'visible', timeout: ROUTE_TIMEOUT_MS }),
    page.getByTestId('novel-editor-tabs').first().waitFor({ state: 'visible', timeout: ROUTE_TIMEOUT_MS }),
    page.getByTestId('novel-library-tabs').first().waitFor({ state: 'visible', timeout: ROUTE_TIMEOUT_MS }),
    page.getByRole('heading', { name: /Novel Workspace/i }).first().waitFor({ state: 'visible', timeout: ROUTE_TIMEOUT_MS }),
    page.getByRole('button', { name: /^Retry now$/i }).first().waitFor({ state: 'visible', timeout: ROUTE_TIMEOUT_MS }),
    page.locator('.vf-topbar').first().waitFor({ state: 'visible', timeout: ROUTE_TIMEOUT_MS }),
    page.locator('.vf-editor-shell').first().waitFor({ state: 'visible', timeout: ROUTE_TIMEOUT_MS }),
    page.locator('.vf-studio-grid').first().waitFor({ state: 'visible', timeout: ROUTE_TIMEOUT_MS }),
  ]);
};

const routeCases: Array<{
  title: string;
  path: string;
  waitForReadyState: (page: Page) => Promise<void>;
  assert: (page: Page) => Promise<void>;
}> = [
  {
    title: 'studio desktop workspace launch',
    path: '/app/studio',
    waitForReadyState: waitForStudioWorkspace,
    assert: async (page) => {
      await expect(page.locator('.vf-editor-shell').first()).toBeVisible();
      await expect(page.locator('.vf-topbar').first()).toBeVisible();
    },
  },
  {
    title: 'voices desktop workspace launch',
    path: '/app/voices',
    waitForReadyState: waitForVoicesWorkspace,
    assert: async (page) => {
      const voicesWorkspace = page.getByTestId('voices-workspace');
      if (await voicesWorkspace.count()) {
        await expect(voicesWorkspace).toBeVisible();
        const layout = String(await voicesWorkspace.getAttribute('data-voices-layout') || '').trim().toLowerCase();
        expect(layout).toMatch(/desktop|tablet|phone/);
        const desktopShell = page.locator('.vf-voices-shell--desktop').first();
        if (layout === 'desktop' && await desktopShell.count()) {
          await expect(desktopShell).toBeVisible();
        }
        return;
      }

      await Promise.any([
        page.locator('.vf-voice-clone-shell').first().waitFor({ state: 'visible', timeout: ROUTE_TIMEOUT_MS }),
        page.locator('.vf-voices-shell').first().waitFor({ state: 'visible', timeout: ROUTE_TIMEOUT_MS }),
        page.getByRole('heading', { name: /Voice Cloning/i }).first().waitFor({ state: 'visible', timeout: ROUTE_TIMEOUT_MS }),
      ]);
    },
  },
  {
    title: 'writing desktop workspace launch',
    path: '/app/writing',
    waitForReadyState: waitForWritingWorkspace,
    assert: async (page) => {
      const novelWorkspace = page.getByTestId('novel-workspace').first();
      if (await novelWorkspace.isVisible().catch(() => false)) {
        await expect(novelWorkspace).toBeVisible();
        return;
      }

      await Promise.any([
        page.locator('.vf-topbar').first().waitFor({ state: 'visible', timeout: ROUTE_TIMEOUT_MS }),
        page.locator('.vf-editor-shell').first().waitFor({ state: 'visible', timeout: ROUTE_TIMEOUT_MS }),
        page.locator('.vf-studio-grid').first().waitFor({ state: 'visible', timeout: ROUTE_TIMEOUT_MS }),
      ]);
    },
  },
];

for (const routeCase of routeCases) {
  test(routeCase.title, async ({ page }) => {
    test.setTimeout(120_000);
    const assertRouteHealth = trackRouteHealth(page);
    await seedWorkspaceThemeState(page);
    const credentials = resolveStudioSmokeCredentials();
    test.skip(!credentials, 'Missing Playwright admin credentials for workspace launch smoke.');
    if (!credentials) return;
    await ensureStudioSmokeAuthenticated(page, credentials!);

    await page.goto(routeCase.path, {
      waitUntil: 'domcontentloaded',
      timeout: ROUTE_TIMEOUT_MS,
    });

    await routeCase.waitForReadyState(page);
    await page.waitForTimeout(350);
    await routeCase.assert(page);
    await expectNoHorizontalBleed(page);

    assertRouteHealth?.();
  });
}

