import { test } from '@playwright/test';
import { ensureStudioSmokeAuthenticated, resolveStudioSmokeCredentials } from './smokeAuth';

test('manual studio selector inspection', async ({ page }) => {
  test.setTimeout(240_000);
  const credentials = resolveStudioSmokeCredentials();
  test.skip(!credentials, 'PLAYWRIGHT_ADMIN_EMAIL and PLAYWRIGHT_ADMIN_PASSWORD are required.');

  await ensureStudioSmokeAuthenticated(page, credentials);
  await page.goto('/app/studio', { waitUntil: 'domcontentloaded', timeout: 120_000 });
  await page.locator('.vf-studio-grid, .vf-editor-shell').first().waitFor({ state: 'visible', timeout: 60_000 });

  const buttonTexts = (await page.locator('button:visible').allTextContents())
    .map((value) => String(value || '').replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .slice(0, 120);
  const tabs = (await page.locator('[role="tab"]:visible').allTextContents())
    .map((value) => String(value || '').replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .slice(0, 80);
  const fields = await page.locator('input, textarea, select').evaluateAll((nodes) => nodes.slice(0, 120).map((node) => ({
    tag: node.tagName.toLowerCase(),
    id: String(node.id || ''),
    type: 'type' in node ? String(node.type || '') : '',
    name: String(node.getAttribute('name') || ''),
    placeholder: String(node.getAttribute('placeholder') || ''),
    ariaLabel: String(node.getAttribute('aria-label') || ''),
  })));

  console.log(JSON.stringify({
    url: page.url(),
    buttons: buttonTexts,
    tabs,
    fields,
  }, null, 2));
});
