import { test } from '@playwright/test';
import { ensureStudioSmokeAuthenticated, resolveStudioSmokeCredentials } from './smokeAuth';

test('manual voices selector inspection', async ({ page }) => {
  test.setTimeout(240_000);
  const credentials = resolveStudioSmokeCredentials();
  test.skip(!credentials, 'PLAYWRIGHT_ADMIN_EMAIL and PLAYWRIGHT_ADMIN_PASSWORD are required.');

  await ensureStudioSmokeAuthenticated(page, credentials);
  await page.goto('/app/voices', { waitUntil: 'domcontentloaded', timeout: 120_000 });
  await Promise.any([
    page.getByRole('heading', { name: /Voice Cloning/i }).first().waitFor({ state: 'visible', timeout: 60_000 }),
    page.locator('[data-testid="voices-workspace"]').first().waitFor({ state: 'visible', timeout: 60_000 }),
  ]);

  const buttonTexts = (await page.locator('button:visible').allTextContents())
    .map((value) => String(value || '').replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .slice(0, 140);
  const tabs = (await page.locator('[role="tab"]:visible').allTextContents())
    .map((value) => String(value || '').replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .slice(0, 80);
  const fields = await page.locator('input, textarea, select').evaluateAll((nodes) => nodes.slice(0, 140).map((node) => ({
    tag: node.tagName.toLowerCase(),
    id: String(node.id || ''),
    type: 'type' in node ? String(node.type || '') : '',
    name: String(node.getAttribute('name') || ''),
    placeholder: String(node.getAttribute('placeholder') || ''),
    ariaLabel: String(node.getAttribute('aria-label') || ''),
  })));

  const separateTab = page.getByRole('tab', { name: /^Extract Voice \+ BG/i }).first();
  if (await separateTab.isVisible().catch(() => false)) {
    await separateTab.click({ force: true });
    await page.waitForTimeout(800);
  }

  const separateButtons = (await page.locator('button:visible').allTextContents())
    .map((value) => String(value || '').replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .slice(0, 140);
  const separateFields = await page.locator('input, textarea, select').evaluateAll((nodes) => nodes.slice(0, 140).map((node) => ({
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
    separateButtons,
    separateFields,
  }, null, 2));
});
