import { chromium, type FullConfig } from '@playwright/test';

const ROUTE_TIMEOUT_MS = 120_000;

const normalizeBaseUrl = (config: FullConfig): string => {
  const projectBaseUrl = config.projects[0]?.use?.baseURL;
  return String(projectBaseUrl || 'http://localhost:3000').replace(/\/+$/, '');
};

export default async function globalSetup(config: FullConfig): Promise<void> {
  const baseUrl = normalizeBaseUrl(config);
  const browser = await chromium.launch();
  const page = await browser.newPage();

  try {
    await page.goto(`${baseUrl}/app/login`, {
      waitUntil: 'domcontentloaded',
      timeout: ROUTE_TIMEOUT_MS,
    });
    const loginShell = page.locator('.auth-shell').first();
    const loginHeading = page.getByRole('heading', { name: /Welcome back/i }).first();
    const loginSubtitle = page.getByText('Sign in to continue to your workspace.', { exact: true }).first();
    const loginTabs = page.getByRole('tablist', { name: /Authentication mode/i }).first();
    await Promise.any([
      loginShell.waitFor({ state: 'visible', timeout: ROUTE_TIMEOUT_MS }),
      loginHeading.waitFor({ state: 'visible', timeout: ROUTE_TIMEOUT_MS }),
      loginSubtitle.waitFor({ state: 'visible', timeout: ROUTE_TIMEOUT_MS }),
      loginTabs.waitFor({ state: 'visible', timeout: ROUTE_TIMEOUT_MS }),
      page.waitForURL(/\/app\/login(?:\/|$|\?)/, { timeout: ROUTE_TIMEOUT_MS }),
    ]);
  } finally {
    await browser.close();
  }
}


