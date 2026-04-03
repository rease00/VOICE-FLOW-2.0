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
    await page.goto(`${baseUrl}/app/reader`, {
      waitUntil: 'domcontentloaded',
      timeout: ROUTE_TIMEOUT_MS,
    });
    const readerHome = page.getByTestId('reader-browse-home');
    const authScreen = page.getByTestId('brand-logo').first();
    const onboardingCta = page
      .getByRole('button', { name: /Get Started|Sign In|Create Account|Test Drive|Create Your First Scene|Listen to Live Demos/i })
      .or(page.getByRole('link', { name: /Get Started|Sign In|Create Account|Test Drive|Create Your First Scene|Listen to Live Demos/i }));
    await Promise.any([
      readerHome.waitFor({ state: 'visible', timeout: ROUTE_TIMEOUT_MS }),
      authScreen.waitFor({ state: 'visible', timeout: ROUTE_TIMEOUT_MS }),
      onboardingCta.waitFor({ state: 'visible', timeout: ROUTE_TIMEOUT_MS }),
    ]).catch(() => undefined);
  } finally {
    await browser.close();
  }
}

