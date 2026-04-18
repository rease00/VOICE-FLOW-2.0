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
    await page.goto(`${baseUrl}/app/writing`, {
      waitUntil: 'domcontentloaded',
      timeout: ROUTE_TIMEOUT_MS,
    });
    const writingWorkspace = page.getByTestId('novel-workspace').first();
    const writingHeading = page.getByRole('heading', { name: /Novel Workspace/i }).first();
    const writingAuthGate = page.getByRole('heading', { name: /Sign in to open Writing/i }).first();
    const loginShell = page.locator('[data-testid="auth-shell"]').first();
    const loginHeading = page.getByRole('heading', { name: /Welcome back|Create your V FLOW AI account/i }).first();
    await Promise.any([
      writingWorkspace.waitFor({ state: 'visible', timeout: ROUTE_TIMEOUT_MS }),
      writingHeading.waitFor({ state: 'visible', timeout: ROUTE_TIMEOUT_MS }),
      page.locator('.vf-topbar').first().waitFor({ state: 'visible', timeout: ROUTE_TIMEOUT_MS }),
      page.locator('.vf-editor-shell').first().waitFor({ state: 'visible', timeout: ROUTE_TIMEOUT_MS }),
      page.locator('.vf-studio-grid').first().waitFor({ state: 'visible', timeout: ROUTE_TIMEOUT_MS }),
      writingAuthGate.waitFor({ state: 'visible', timeout: ROUTE_TIMEOUT_MS }),
      loginShell.waitFor({ state: 'visible', timeout: ROUTE_TIMEOUT_MS }),
      loginHeading.waitFor({ state: 'visible', timeout: ROUTE_TIMEOUT_MS }),
      page.waitForURL(/\/app\/login(?:\/|$|\?)/, { timeout: ROUTE_TIMEOUT_MS }),
    ]);
  } finally {
    await browser.close();
  }
}


