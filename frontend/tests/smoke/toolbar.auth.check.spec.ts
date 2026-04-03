import { test, expect, devices } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import { ensureStudioSmokeAuthenticated, resolveStudioSmokeCredentials } from '../../tests/smoke/smokeAuth';

const outputDir = path.resolve(process.cwd(), 'tmp_dir/playwright/toolbar-one-line-verify-auth');

const deviceMatrix: Array<{ name: string; contextOptions: Parameters<import('@playwright/test').Browser['newContext']>[0] }> = [
  {
    name: 'desktop-1440x900',
    contextOptions: {
      ...devices['Desktop Chrome'],
      viewport: { width: 1440, height: 900 },
      screen: { width: 1440, height: 900 },
    },
  },
  {
    name: 'tablet-ipad-pro-11',
    contextOptions: {
      ...devices['iPad Pro 11'],
    },
  },
  {
    name: 'mobile-iphone-13',
    contextOptions: {
      ...devices['iPhone 13'],
    },
  },
];

const ensureStudioReady = async (page: import('@playwright/test').Page): Promise<void> => {
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    await page.goto('/app/studio', { waitUntil: 'domcontentloaded', timeout: 120_000 }).catch(() => undefined);
    const ready = await Promise.any([
      page.locator('.vf-studio-toolbar').first().waitFor({ state: 'visible', timeout: 45_000 }).then(() => true),
      page.getByRole('button', { name: /^Import$/i }).first().waitFor({ state: 'visible', timeout: 45_000 }).then(() => true),
      page.getByRole('button', { name: /^Grammar$/i }).first().waitFor({ state: 'visible', timeout: 45_000 }).then(() => true),
    ]).catch(() => false);

    if (ready) {
      await page.waitForTimeout(900);
      return;
    }

    await page.waitForTimeout(500 + attempt * 250);
  }

  throw new Error(`Studio toolbar was not visible. URL: ${page.url()}`);
};

const analyzeToolbarRows = async (page: import('@playwright/test').Page): Promise<{ rowCount: number; rowTops: number[]; foundLabels: string[] }> => {
  return page.evaluate(() => {
    const toolbar = document.querySelector('.vf-studio-toolbar');
    if (!toolbar) {
      return { rowCount: -1, rowTops: [], foundLabels: [] };
    }

    const expected = ['grammar', 'flow', 'audio novel', 'import'];
    const matches = Array.from(toolbar.querySelectorAll('button'))
      .map((button) => ({
        text: (button.textContent || '').replace(/\s+/g, ' ').trim(),
        top: Math.round(button.getBoundingClientRect().top),
      }))
      .filter((row) => expected.some((token) => row.text.toLowerCase().includes(token)));

    const rowTops = Array.from(new Set(matches.map((row) => row.top))).sort((a, b) => a - b);
    return {
      rowCount: rowTops.length,
      rowTops,
      foundLabels: matches.map((row) => row.text),
    };
  });
};

test('studio toolbar stays one-line on 3 major devices with super-admin auth', async ({ browser }) => {
  test.setTimeout(600_000);
  const credentials = resolveStudioSmokeCredentials();
  if (!credentials) {
    throw new Error('Missing PLAYWRIGHT_ADMIN_EMAIL/PLAYWRIGHT_ADMIN_PASSWORD for authenticated verification.');
  }

  await fs.mkdir(outputDir, { recursive: true });
  const results: Array<{
    device: string;
    rowCount: number;
    rowTops: number[];
    foundLabels: string[];
    screenshotPath: string;
    url: string;
  }> = [];

  for (const deviceTarget of deviceMatrix) {
    const context = await browser.newContext(deviceTarget.contextOptions);
    const page = await context.newPage();

    try {
      await ensureStudioSmokeAuthenticated(page, credentials);
      await ensureStudioReady(page);

      const analysis = await analyzeToolbarRows(page);
      const screenshotPath = path.join(outputDir, `${deviceTarget.name}.png`);
      await page.screenshot({ path: screenshotPath, fullPage: false });

      results.push({
        device: deviceTarget.name,
        rowCount: analysis.rowCount,
        rowTops: analysis.rowTops,
        foundLabels: analysis.foundLabels,
        screenshotPath,
        url: page.url(),
      });

      expect(analysis.rowCount, `${deviceTarget.name} expected one toolbar row but found ${analysis.rowCount}.`).toBe(1);
    } finally {
      await context.close();
    }
  }

  await fs.writeFile(path.join(outputDir, 'report.json'), `${JSON.stringify(results, null, 2)}\n`, 'utf8');
});
