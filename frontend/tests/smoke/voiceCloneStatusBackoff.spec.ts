import { expect, test } from '@playwright/test';
import { ensureStudioSmokeAuthenticated, resolveStudioSmokeCredentials } from './smokeAuth';

const ROUTE_TIMEOUT_MS = 60_000;
const STATUS_BACKOFF_WINDOW_MS = 18_000;

test('voice clone status polling backs off after a 503 on desktop and mobile', async ({ page }) => {
  test.setTimeout(180_000);

  const credentials = resolveStudioSmokeCredentials();
  test.skip(!credentials, 'PLAYWRIGHT_ADMIN_EMAIL and PLAYWRIGHT_ADMIN_PASSWORD are required for this smoke flow.');

  let armed = false;
  let statusRequestCount = 0;

  await page.route(/\/voice-clone\/status(?:\?.*)?$/, async (route) => {
    if (route.request().method() !== 'GET') {
      await route.continue();
      return;
    }

    if (armed) {
      statusRequestCount += 1;
    }

    await route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: false,
        ready: false,
        state: 'unavailable',
        detail: 'Voice Clone runtime unavailable',
        device: 'GPU',
        supportsVC: false,
      }),
    });
  });

  await ensureStudioSmokeAuthenticated(page, credentials);

  armed = true;
  await page.goto('/app/voices', { waitUntil: 'domcontentloaded', timeout: 120_000 });

  const voiceCloneHeading = page.getByRole('heading', { name: /Voice Cloning/i }).first();
  await expect(voiceCloneHeading).toBeVisible({ timeout: ROUTE_TIMEOUT_MS });

  const referenceDropzoneButton = page.getByRole('button', { name: 'Drop reference audio' }).first();
  const referenceVisibleInitially = await referenceDropzoneButton.isVisible().catch(() => false);
  if (!referenceVisibleInitially) {
    const cloneTab = page.getByRole('tab', { name: /Voice Cloning/i }).first();
    const cloneButton = page.getByRole('button', { name: /Voice Cloning/i }).first();
    if (await cloneTab.isVisible().catch(() => false)) {
      await cloneTab.click({ force: true }).catch(() => undefined);
    } else if (await cloneButton.isVisible().catch(() => false)) {
      await cloneButton.click({ force: true }).catch(() => undefined);
    }
  }

  await expect.poll(() => statusRequestCount, { timeout: ROUTE_TIMEOUT_MS }).toBe(1);

  await page.waitForTimeout(STATUS_BACKOFF_WINDOW_MS);

  expect(statusRequestCount).toBe(1);
});
