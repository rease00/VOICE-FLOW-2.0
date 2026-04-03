import { test, expect, devices, type Page } from '@playwright/test';
import { ensureStudioSmokeAuthenticated, resolveStudioSmokeCredentials } from './smokeAuth';

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

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const navigateToStudio = async (page: Page): Promise<void> => {
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

const engineLabel = (name: string): string => {
  const normalized = String(name || '').trim().toLowerCase();
  if (normalized === 'duno') return 'Duno';
  if (normalized === 'vector') return 'Vector';
  if (normalized === 'prime') return 'Prime';
  return name;
};

const waitForEnabled = async (locator: ReturnType<Page['locator']>, label: string, profileName: string): Promise<void> => {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 30_000) {
    const visible = await locator.isVisible().catch(() => false);
    const disabled = await locator.isDisabled().catch(() => false);
    if (visible && !disabled) return;
    await sleep(250);
  }
  throw new Error(`[${profileName}] ${label} switch did not become enabled.`);
};

const openConfigurationPanelIfNeeded = async (page: Page, profileName: string) => {
  const panel = page.getByRole('dialog', { name: /Configuration panel/i }).first();
  if (await panel.isVisible().catch(() => false)) return panel;

  const trigger = page.getByRole('button', { name: /Open configuration/i }).first();
  await trigger.waitFor({ state: 'visible', timeout: 30_000 });
  await trigger.click({ force: true });
  await panel.waitFor({ state: 'visible', timeout: 30_000 }).catch(async () => {
    throw new Error(`[${profileName}] configuration panel did not open. URL: ${page.url()}`);
  });
  return panel;
};

const getActiveEngine = async (page: Page): Promise<string> => {
  return page.evaluate(() => {
    const active = Array.from(document.querySelectorAll('button[aria-pressed="true"]')).find((button) =>
      String(button.getAttribute('aria-label') || '').includes('runtime')
    );
    const label = String(active?.getAttribute('aria-label') || '').toLowerCase();
    if (label.includes('duno runtime')) return 'DUNO';
    if (label.includes('vector runtime')) return 'VECTOR';
    if (label.includes('prime runtime')) return 'PRIME';
    return '';
  });
};

const waitForActiveEngine = async (page: Page, targetEngine: string, profileName: string): Promise<string> => {
  const target = engineLabel(targetEngine).toLowerCase();
  await page.waitForFunction(
    (normalizedTarget) => {
      const activeButtons = Array.from(document.querySelectorAll('button[aria-pressed="true"]'));
      return activeButtons.some((button) => {
        const label = String(button.getAttribute('aria-label') || '').toLowerCase();
        return label.includes(`${normalizedTarget} runtime`) && label.includes('active');
      });
    },
    target,
    { timeout: 120_000 }
  );

  const activeLabel = await page.evaluate(() => {
    const active = Array.from(document.querySelectorAll('button[aria-pressed="true"]')).find((button) =>
      String(button.getAttribute('aria-label') || '').includes('runtime')
    );
    return active?.getAttribute('aria-label') || '';
  });

  if (!activeLabel.toLowerCase().includes(`${target} runtime`)) {
    throw new Error(`[${profileName}] expected ${engineLabel(targetEngine)} to be active, but saw: ${activeLabel}`);
  }

  return activeLabel;
};

const clickEngine = async (page: Page, targetEngine: string, profileName: string): Promise<void> => {
  const label = engineLabel(targetEngine);
  const topbarButton = page.locator(`.vf-runtime-strip button[aria-label^="${label} runtime"]`).first();
  if (await topbarButton.isVisible().catch(() => false)) {
    await waitForEnabled(topbarButton, label, profileName);
    await topbarButton.click();
    await waitForActiveEngine(page, targetEngine, profileName);
    return;
  }

  const panel = await openConfigurationPanelIfNeeded(page, profileName);
  const panelButton = panel.getByRole('button', { name: new RegExp(`${label} Runtime`, 'i') }).first();
  await panelButton.waitFor({ state: 'visible', timeout: 30_000 });
  await waitForEnabled(panelButton, label, profileName);
  await panelButton.click();
  await waitForActiveEngine(page, targetEngine, profileName);
};

test('DUNO switches to other engines on 3 major devices', async ({ browser }) => {
  test.setTimeout(900_000);
  const credentials = resolveStudioSmokeCredentials();
  expect(credentials, 'Missing PLAYWRIGHT_ADMIN_EMAIL/PLAYWRIGHT_ADMIN_PASSWORD for authenticated verification.').not.toBeNull();

  for (const deviceTarget of deviceMatrix) {
    const context = await browser.newContext(deviceTarget.contextOptions);
    const page = await context.newPage();

    try {
      await ensureStudioSmokeAuthenticated(page, credentials!);
      await navigateToStudio(page);

      await page.waitForTimeout(3_000);
      const startingEngine = await getActiveEngine(page);
      if (startingEngine !== 'DUNO') {
        await clickEngine(page, 'DUNO', deviceTarget.name);
      }

      await clickEngine(page, 'VECTOR', deviceTarget.name);
      await clickEngine(page, 'DUNO', deviceTarget.name);
    } finally {
      await context.close();
    }
  }
});
