import path from 'node:path';
import { expect, test } from '@playwright/test';
import { ensureStudioSmokeAuthenticated, resolveStudioSmokeCredentials } from '../../frontend/tests/smoke/smokeAuth';

test('Reader dock stays within the viewport', async ({ page }) => {
  test.setTimeout(300_000);
  const credentials = resolveStudioSmokeCredentials();
  test.skip(!credentials, 'Set PLAYWRIGHT_ADMIN_EMAIL and PLAYWRIGHT_ADMIN_PASSWORD for Reader smoke.');
  if (!credentials) return;

  await ensureStudioSmokeAuthenticated(page, credentials);
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
