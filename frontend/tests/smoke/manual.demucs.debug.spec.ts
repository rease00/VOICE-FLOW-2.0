import { test } from '@playwright/test';
import { ensureStudioSmokeAuthenticated, resolveStudioSmokeCredentials } from './smokeAuth';

const VC_DEMUCS_SOURCE_AUDIO = 'C:/Users/1wasi/OneDrive/Desktop/test vc/use for demuse only for vocal extract.mp3';

test('manual demucs debug', async ({ page }) => {
  test.setTimeout(480_000);
  const credentials = resolveStudioSmokeCredentials();
  test.skip(!credentials, 'PLAYWRIGHT_ADMIN_EMAIL and PLAYWRIGHT_ADMIN_PASSWORD are required.');

  const requestLog: Array<{ method: string; url: string }> = [];
  const responseLog: Array<{ status: number; url: string; body: string }> = [];

  page.on('request', (request) => {
    const url = String(request.url() || '');
    if (!/\/voice-clone\/separate/i.test(url)) return;
    requestLog.push({ method: request.method(), url });
  });
  page.on('response', async (response) => {
    const url = String(response.url() || '');
    if (!/\/voice-clone\/separate/i.test(url)) return;
    responseLog.push({
      status: response.status(),
      url,
      body: await response.text().catch(() => ''),
    });
  });

  await ensureStudioSmokeAuthenticated(page, credentials);
  await page.goto('/app/voices', { waitUntil: 'domcontentloaded', timeout: 120_000 });
  const separateTab = page.getByRole('tab', { name: /^Extract Voice \+ BG/i }).first();
  await separateTab.click({ force: true });

  await page.getByLabel('Drop source mix audio').first().setInputFiles(VC_DEMUCS_SOURCE_AUDIO);
  await page.waitForTimeout(500);

  const applyTrimButton = page.getByRole('button', { name: /Apply source trim/i }).first();
  if (await applyTrimButton.isVisible().catch(() => false)) {
    await applyTrimButton.click({ force: true });
  }

  const extractButton = page.getByRole('button', { name: /Extract Voice \+ BG Music/i }).first();
  const extractVisible = await extractButton.isVisible().catch(() => false);
  const extractEnabled = await extractButton.isEnabled().catch(() => false);
  if (extractVisible && extractEnabled) {
    await extractButton.click({ force: true });
    await page.waitForTimeout(35_000);
  }

  const alerts = (await page.locator('[role="alert"]').allTextContents().catch(() => []))
    .map((value) => String(value || '').replace(/\s+/g, ' ').trim())
    .filter(Boolean);

  console.log(JSON.stringify({
    url: page.url(),
    extractVisible,
    extractEnabled,
    alerts,
    requestLog,
    responseLog,
  }, null, 2));
});
