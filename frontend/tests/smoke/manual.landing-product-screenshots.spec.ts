import fs from 'node:fs/promises';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { STORAGE_KEYS } from '../../src/shared/storage/keys';
import { ensureStudioSmokeAuthenticated, resolveStudioSmokeCredentials } from './smokeAuth';

const ROUTE_TIMEOUT_MS = 120_000;
const outputDir = path.resolve(process.cwd(), 'public/screenshots/landing');

const screenshotTargets = {
  studio: path.join(outputDir, 'audit-desktop-1440x900.png'),
  voices: path.join(outputDir, 'voices-auth-desktop-1440x900.png'),
} as const;

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

const stabilizeWorkspace = async (page: Page): Promise<void> => {
  await page.addStyleTag({
    content: `
      *, *::before, *::after {
        animation-duration: 0s !important;
        animation-delay: 0s !important;
        transition-duration: 0s !important;
        caret-color: transparent !important;
      }
      html {
        scroll-behavior: auto !important;
      }
    `,
  }).catch(() => undefined);
  await page.waitForTimeout(1600);
};

const waitForStudioWorkspace = async (page: Page): Promise<void> => {
  await Promise.any([
    page.locator('.vf-studio-grid').first().waitFor({ state: 'visible', timeout: ROUTE_TIMEOUT_MS }),
    page.locator('.vf-editor-shell').first().waitFor({ state: 'visible', timeout: ROUTE_TIMEOUT_MS }),
    page.locator('.vf-topbar').first().waitFor({ state: 'visible', timeout: ROUTE_TIMEOUT_MS }),
  ]);
  await expect(page.getByRole('button', { name: /^AI Director$/i }).first()).toBeVisible({ timeout: ROUTE_TIMEOUT_MS });
};

const waitForVoicesWorkspace = async (page: Page): Promise<void> => {
  await page.waitForURL(/\/app\/voices(?:\/|$|\?)/, { timeout: ROUTE_TIMEOUT_MS });
  await Promise.any([
    page.getByTestId('voices-workspace').first().waitFor({ state: 'visible', timeout: ROUTE_TIMEOUT_MS }),
    page.locator('.vf-voices-shell').first().waitFor({ state: 'visible', timeout: ROUTE_TIMEOUT_MS }),
    page.locator('.vf-voice-clone-shell').first().waitFor({ state: 'visible', timeout: ROUTE_TIMEOUT_MS }),
    page.getByRole('heading', { name: /Voice Cloning/i }).first().waitFor({ state: 'visible', timeout: ROUTE_TIMEOUT_MS }),
  ]);
};

test('capture authenticated landing screenshots', async ({ page }) => {
  test.setTimeout(300_000);

  const credentials = resolveStudioSmokeCredentials();
  test.skip(!credentials, 'PLAYWRIGHT_ADMIN_EMAIL and PLAYWRIGHT_ADMIN_PASSWORD are required.');

  await fs.mkdir(outputDir, { recursive: true });
  await seedWorkspaceThemeState(page);
  await ensureStudioSmokeAuthenticated(page, credentials!);

  await page.goto('/app/studio', { waitUntil: 'domcontentloaded', timeout: ROUTE_TIMEOUT_MS });
  await waitForStudioWorkspace(page);
  await stabilizeWorkspace(page);
  await page.screenshot({ path: screenshotTargets.studio, fullPage: false });

  await page.goto('/app/voices', { waitUntil: 'domcontentloaded', timeout: ROUTE_TIMEOUT_MS });
  await waitForVoicesWorkspace(page);
  await stabilizeWorkspace(page);
  await page.screenshot({ path: screenshotTargets.voices, fullPage: false });
});
