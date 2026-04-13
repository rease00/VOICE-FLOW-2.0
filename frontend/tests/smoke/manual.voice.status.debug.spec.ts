import { test } from '@playwright/test';
import { ensureStudioSmokeAuthenticated, resolveStudioSmokeCredentials } from './smokeAuth';

test('manual voice clone status debug', async ({ page }) => {
  test.setTimeout(240_000);
  const credentials = resolveStudioSmokeCredentials();
  test.skip(!credentials, 'PLAYWRIGHT_ADMIN_EMAIL and PLAYWRIGHT_ADMIN_PASSWORD are required.');

  const responseLog: Array<{ status: number; url: string; body: string }> = [];
  page.on('response', async (response) => {
    const url = String(response.url() || '');
    if (!/\/api\/v1\/voice-clone\/status/i.test(url)) return;
    responseLog.push({
      status: response.status(),
      url,
      body: await response.text().catch(() => ''),
    });
  });

  await ensureStudioSmokeAuthenticated(page, credentials);
  const statusResponsePromise = page.waitForResponse(
    (response) => /\/api\/v1\/voice-clone\/status/i.test(String(response.url() || '')),
    { timeout: 120_000 }
  );
  await page.goto('/app/voices', { waitUntil: 'domcontentloaded', timeout: 120_000 });
  const statusResponse = await statusResponsePromise;
  const statusPayload = {
    status: statusResponse.status(),
    url: statusResponse.url(),
    requestHeaders: statusResponse.request().headers(),
    body: await statusResponse.text(),
    responseLog,
    cloneTabText: await page.getByRole('tab', { name: /Voice Cloning/i }).first().textContent(),
  };

  console.log(JSON.stringify(statusPayload, null, 2));
});
