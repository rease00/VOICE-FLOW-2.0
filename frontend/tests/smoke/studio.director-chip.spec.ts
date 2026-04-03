import fs from 'node:fs/promises';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { ensureStudioSmokeAuthenticated, resolveStudioSmokeCredentials } from './smokeAuth';

const ROUTE_TIMEOUT_MS = 120_000;
const outputDir = path.resolve(process.cwd(), 'tmp_dir/playwright/director-chip-check');

const navigateToStudio = async (page: Parameters<typeof test>[0]['page']): Promise<void> => {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      await page.goto('/app/studio', { waitUntil: 'domcontentloaded', timeout: ROUTE_TIMEOUT_MS });
      break;
    } catch (error) {
      const message = String((error as Error)?.message || error || '');
      if (!/ERR_ABORTED/i.test(message) || attempt === 3) {
        throw error;
      }
      await page.waitForTimeout(450 + attempt * 200);
    }
  }

  await Promise.any([
    page.locator('.vf-studio-toolbar').first().waitFor({ state: 'visible', timeout: ROUTE_TIMEOUT_MS }),
    page.locator('.vf-topbar').first().waitFor({ state: 'visible', timeout: ROUTE_TIMEOUT_MS }),
    page.getByRole('button', { name: /^AI Director$/i }).first().waitFor({ state: 'visible', timeout: ROUTE_TIMEOUT_MS }),
  ]);
};

test('studio AI Director chip stays balanced and unclipped', async ({ page }, testInfo) => {
  const credentials = resolveStudioSmokeCredentials();
  expect(credentials, 'Missing Playwright admin credentials for smoke auth.').not.toBeNull();

  await fs.mkdir(outputDir, { recursive: true });
  await ensureStudioSmokeAuthenticated(page, credentials!);
  await navigateToStudio(page);

  const directorChip = page.locator('.vf-studio-director-cluster .vf-toolbar-ai--director-live').first();
  await expect(directorChip).toBeVisible({ timeout: ROUTE_TIMEOUT_MS });
  await page.waitForTimeout(800);

  const metrics = await directorChip.evaluate((button) => {
    if (!(button instanceof HTMLButtonElement)) {
      return {
        text: '',
        width: 0,
        height: 0,
        overflowX: 999,
        overflowY: 999,
        labelFits: false,
        iconFits: false,
        borderRadius: '',
      };
    }

    const rect = button.getBoundingClientRect();
    const label = button.querySelector('.vf-toolbar-ai__label');
    const icon = button.querySelector('svg');
    const labelRect = label?.getBoundingClientRect();
    const iconRect = icon?.getBoundingClientRect();
    const style = window.getComputedStyle(button);

    return {
      text: (label?.textContent || button.textContent || '').replace(/\s+/g, ' ').trim(),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
      overflowX: Math.max(0, button.scrollWidth - Math.ceil(button.clientWidth)),
      overflowY: Math.max(0, button.scrollHeight - Math.ceil(button.clientHeight)),
      labelFits: Boolean(
        labelRect
        && labelRect.left >= rect.left + 8
        && labelRect.right <= rect.right - 8
        && labelRect.top >= rect.top + 4
        && labelRect.bottom <= rect.bottom - 4
      ),
      iconFits: Boolean(
        iconRect
        && iconRect.left >= rect.left + 8
        && iconRect.top >= rect.top + 4
        && iconRect.bottom <= rect.bottom - 4
        && (!labelRect || iconRect.right <= labelRect.left - 4)
      ),
      borderRadius: style.borderRadius,
    };
  });

  const screenshotPath = path.join(outputDir, `${testInfo.project.name}-director-chip.png`);
  await directorChip.screenshot({ path: screenshotPath });
  await page.screenshot({ path: path.join(outputDir, `${testInfo.project.name}-studio-layout.png`), fullPage: false });

  if (testInfo.project.name.toLowerCase().includes('desktop')) {
    await expect(page.getByRole('tab', { name: /^Queue$/i })).toHaveCount(0);
  }

  expect(metrics.text).toBe('AI Director');
  expect(metrics.width, JSON.stringify(metrics)).toBeGreaterThanOrEqual(92);
  expect(metrics.height, JSON.stringify(metrics)).toBeGreaterThanOrEqual(32);
  expect(metrics.height, JSON.stringify(metrics)).toBeLessThanOrEqual(42);
  expect(metrics.overflowX, JSON.stringify(metrics)).toBeLessThanOrEqual(1);
  expect(metrics.overflowY, JSON.stringify(metrics)).toBeLessThanOrEqual(1);
  expect(metrics.labelFits, JSON.stringify(metrics)).toBe(true);
  expect(metrics.iconFits, JSON.stringify(metrics)).toBe(true);
  expect(metrics.borderRadius, JSON.stringify(metrics)).not.toBe('0px');
});
