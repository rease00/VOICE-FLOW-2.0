import path from 'node:path';
import { expect, test } from '@playwright/test';
import { resolveStudioSmokeCredentials } from './smokeAuth';

async function loginViaUi(page, credentials) {
  await page.goto('/app/login', { waitUntil: 'domcontentloaded', timeout: 120_000 });
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(1500);
  const emailInput = page.locator('input#auth-email');
  const passwordInput = page.locator('input#auth-password');
  const signInButton = page.getByRole('button', { name: /^Sign In$/i });
  await expect(emailInput).toBeVisible({ timeout: 20_000 });
  await expect(passwordInput).toBeVisible({ timeout: 20_000 });
  await expect(signInButton).toBeVisible({ timeout: 20_000 });
  await emailInput.fill(credentials.email);
  await passwordInput.fill(credentials.password);
  await page.waitForTimeout(500);
  await signInButton.click();
  await Promise.race([
    page.waitForURL((url) => {
      const pathname = url.pathname || '';
      return /^\/(app|reader)(?:\/|\?|$)/.test(pathname) && !/^\/app\/login(?:\/|\?|$)/.test(pathname);
    }, { timeout: 60_000 }),
    page.getByTestId('reader-home').waitFor({ state: 'visible', timeout: 60_000 }).catch(() => {}),
    page.getByText('Reader Rights Notice').waitFor({ state: 'visible', timeout: 60_000 }).catch(() => {}),
  ]);
}

test('Reader dock stays within the viewport', async ({ page }) => {
  test.setTimeout(300_000);
  const credentials = resolveStudioSmokeCredentials();
  test.skip(!credentials, 'Set PLAYWRIGHT_ADMIN_EMAIL and PLAYWRIGHT_ADMIN_PASSWORD for Reader smoke.');
  if (!credentials) return;

  await loginViaUi(page, credentials);
  await page.goto('/reader', { waitUntil: 'domcontentloaded', timeout: 120_000 });
  await page.waitForTimeout(2000);

  const dock = page.locator('.vf-reader-v2-dock');
  const importInput = page.locator('.vf-reader-v2-dock__import-input');
  const quickTools = page.locator('.vf-reader-v2-dock__quick-tools');
  const collapseButton = page.getByLabel('Collapse dock to compact circle');

  await expect(dock).toBeVisible({ timeout: 30_000 });
  await expect(importInput).toBeHidden({ timeout: 30_000 });

  const viewport = await page.evaluate(() => ({
    innerWidth: window.innerWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(viewport.scrollWidth).toBeLessThanOrEqual(viewport.innerWidth);

  const dockBox = await dock.boundingBox();
  expect(dockBox).not.toBeNull();
  if (dockBox) {
    expect(Math.ceil(dockBox.x + dockBox.width)).toBeLessThanOrEqual(viewport.innerWidth + 1);
  }

  const quickToolsBox = await quickTools.boundingBox().catch(() => null);
  if (quickToolsBox) {
    expect(Math.ceil(quickToolsBox.x + quickToolsBox.width)).toBeLessThanOrEqual(viewport.innerWidth + 1);
  }

  const collapseBox = await collapseButton.boundingBox().catch(() => null);
  if (collapseBox) {
    expect(Math.ceil(collapseBox.x + collapseBox.width)).toBeLessThanOrEqual(viewport.innerWidth + 1);
  }

  const shotDir = path.resolve(process.cwd(), '..', 'tmp_dir', 'playwright', 'reader-device-check');
  await page.screenshot({
    path: path.join(shotDir, `${test.info().project.name}.png`),
    fullPage: true,
  });
});
