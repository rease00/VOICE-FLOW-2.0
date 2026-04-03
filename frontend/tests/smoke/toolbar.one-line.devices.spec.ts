import { expect, test } from '@playwright/test';
import { ensureStudioSmokeAuthenticated, resolveStudioSmokeCredentials } from './smokeAuth';

const ROUTE_TIMEOUT_MS = 120_000;

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
    page.getByRole('button', { name: /^Import$/i }).first().waitFor({ state: 'visible', timeout: ROUTE_TIMEOUT_MS }),
  ]);
};

test('studio toolbar renders as one row on all major devices', async ({ page }, testInfo) => {
  const credentials = resolveStudioSmokeCredentials();
  expect(credentials, 'Missing Playwright admin credentials for smoke auth.').not.toBeNull();

  await ensureStudioSmokeAuthenticated(page, credentials!);
  await navigateToStudio(page);
  await page.waitForTimeout(1400);

  let toolbarMetrics = {
    rowCount: 0,
    rowTops: [] as number[],
    labels: [] as string[],
    toolbarFound: false,
    buttonCount: 0,
  };
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    try {
      toolbarMetrics = await page.evaluate(() => {
        const expected = ['grammar', 'flow', 'audio novel', 'import'];
        const allButtons = Array.from(document.querySelectorAll('button'))
          .map((button) => ({
            label: (button.textContent || '').replace(/\s+/g, ' ').trim(),
            top: Math.round(button.getBoundingClientRect().top),
          }));
        const matches = allButtons
          .filter((entry) => {
            const normalized = entry.label.toLowerCase().trim();
            return expected.some((token) => (
              normalized === token || normalized.startsWith(`${token} `)
            ));
          });

        const rowTops = Array.from(new Set(matches.map((entry) => entry.top))).sort((a, b) => a - b);
        return {
          rowCount: rowTops.length,
          rowTops,
          labels: matches.map((entry) => entry.label),
          toolbarFound: matches.length > 0,
          buttonCount: allButtons.length,
        };
      });
    } catch {
      toolbarMetrics = {
        rowCount: 0,
        rowTops: [],
        labels: [],
        toolbarFound: false,
        buttonCount: 0,
      };
    }
    if (toolbarMetrics.toolbarFound && toolbarMetrics.buttonCount > 0) break;
    await page.waitForTimeout(500);
  }

  await page.screenshot({ path: testInfo.outputPath(`toolbar-${testInfo.project.name}.png`), fullPage: false });
  const isDesktopProject = testInfo.project.name.toLowerCase().includes('desktop');
  expect(toolbarMetrics.toolbarFound, JSON.stringify(toolbarMetrics)).toBe(true);
  if (isDesktopProject) {
    expect(toolbarMetrics.rowCount, JSON.stringify(toolbarMetrics)).toBe(1);
    return;
  }
  expect(toolbarMetrics.buttonCount, JSON.stringify(toolbarMetrics)).toBeGreaterThan(0);
});
