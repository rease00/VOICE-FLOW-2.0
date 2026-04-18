import { test } from '@playwright/test';
import { ensureStudioSmokeAuthenticated, resolveStudioSmokeCredentials } from './smokeAuth';

test('manual single generation debug', async ({ page }) => {
  test.setTimeout(300_000);
  const credentials = resolveStudioSmokeCredentials();
  test.skip(!credentials, 'PLAYWRIGHT_ADMIN_EMAIL and PLAYWRIGHT_ADMIN_PASSWORD are required.');

  const requestLog: Array<{ method: string; url: string }> = [];
  const responseLog: Array<{ status: number; url: string }> = [];

  page.on('request', (request) => {
    const url = String(request.url() || '');
    if (/\/tts\//i.test(url) || /\/api\/v1\//i.test(url)) {
      requestLog.push({ method: request.method(), url });
    }
  });
  page.on('response', (response) => {
    const url = String(response.url() || '');
    if (/\/tts\//i.test(url) || /\/api\/v1\//i.test(url)) {
      responseLog.push({ status: response.status(), url });
    }
  });

  await ensureStudioSmokeAuthenticated(page, credentials);
  await page.goto('/app/studio', { waitUntil: 'domcontentloaded', timeout: 120_000 });
  await page.locator('.vf-studio-grid, .vf-editor-shell').first().waitFor({ state: 'visible', timeout: 60_000 });

  const editor = page.getByLabel(/Studio script editor/i).first();
  await editor.fill('');
  await editor.type('Debug generation test for launch readiness.', { delay: 8 });

  const generateButton = page.getByRole('button', { name: /^Generate Audio$/i }).first();
  const beforeEnabled = await generateButton.isEnabled().catch(() => false);
  await generateButton.click({ force: true });
  await page.waitForTimeout(20_000);
  const afterEnabled = await generateButton.isEnabled().catch(() => false);

  const alerts = (await page.locator('[role="alert"]').allTextContents().catch(() => []))
    .map((item) => String(item || '').replace(/\s+/g, ' ').trim())
    .filter(Boolean);

  console.log(JSON.stringify({
    beforeEnabled,
    afterEnabled,
    alerts,
    requestLog,
    responseLog,
  }, null, 2));
});
