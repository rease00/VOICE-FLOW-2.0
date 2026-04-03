import { expect, test } from '@playwright/test';
import { ensureStudioSmokeAuthenticated } from './smokeAuth';

const ROUTE_TIMEOUT_MS = 120_000;
const CREDENTIALS = {
  email: 'admin1@voiceflow.local',
  password: 'rease1999',
};

test('reader opens inside the shared workspace shell and can switch to Studio', async ({ page }) => {
  await ensureStudioSmokeAuthenticated(page, CREDENTIALS);

  await expect(page).toHaveURL(/\/app\/reader(?:\/|$|\?)/, { timeout: ROUTE_TIMEOUT_MS });
  await page.waitForTimeout(1500);

  const sidebar = page.locator('.vf-sidebar-shell');
  const studioTab = sidebar.getByRole('button', { name: /^Studio$/i }).first();
  const readerTab = sidebar.getByRole('button', { name: /^Reader$/i }).first();
  await expect(studioTab).toBeVisible({ timeout: ROUTE_TIMEOUT_MS });
  await expect(readerTab).toBeVisible({ timeout: ROUTE_TIMEOUT_MS });

  await studioTab.click({ timeout: ROUTE_TIMEOUT_MS });

  await expect(page).toHaveURL(/\/app\/studio(?:\/|$|\?)/, { timeout: ROUTE_TIMEOUT_MS });
  await expect(page.locator('.vf-studio-toolbar').first()).toBeVisible({ timeout: ROUTE_TIMEOUT_MS });
});
