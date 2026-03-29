import { chromium, type FullConfig } from '@playwright/test';

const ROUTE_TIMEOUT_MS = 120_000;

const normalizeBaseUrl = (config: FullConfig): string => {
  const projectBaseUrl = config.projects[0]?.use?.baseURL;
  return String(projectBaseUrl || 'http://127.0.0.1:42173').replace(/\/+$/, '');
};

export default async function globalSetup(config: FullConfig): Promise<void> {
  const baseUrl = normalizeBaseUrl(config);
  const browser = await chromium.launch();
  const page = await browser.newPage();

  try {
    await page.goto(`${baseUrl}/`, { waitUntil: 'domcontentloaded', timeout: ROUTE_TIMEOUT_MS });
    const brandLogo = page.getByTestId('brand-logo').first();
    const landingHeading = page.getByRole('heading', { level: 1 });
    const primaryAction = page
      .getByRole('button', { name: /Get Started|Sign In|Create Account|Test Drive/i })
      .first();

    const visiblePrimaryAction = await primaryAction.isVisible().catch(() => false);
    if (visiblePrimaryAction) {
      await primaryAction.click({ force: true });
    }

    await Promise.any([
      brandLogo.waitFor({ state: 'visible', timeout: ROUTE_TIMEOUT_MS }),
      landingHeading.waitFor({ state: 'visible', timeout: ROUTE_TIMEOUT_MS }),
      primaryAction.waitFor({ state: 'visible', timeout: ROUTE_TIMEOUT_MS }),
    ]).catch(() => undefined);

    await page.goto(`${baseUrl}/?vf-screen=main&vf-tab=READER`, {
      waitUntil: 'domcontentloaded',
      timeout: ROUTE_TIMEOUT_MS,
    });
    const readerHome = page.getByTestId('reader-browse-home');
    const authScreen = page.getByTestId('brand-logo').first();
    const onboardingCta = page
      .getByRole('button', { name: /Get Started|Sign In|Create Account|Test Drive/i })
      .or(page.getByRole('link', { name: /Get Started|Sign In|Create Account|Test Drive/i }));
    await Promise.any([
      readerHome.waitFor({ state: 'visible', timeout: ROUTE_TIMEOUT_MS }),
      authScreen.waitFor({ state: 'visible', timeout: ROUTE_TIMEOUT_MS }),
      onboardingCta.waitFor({ state: 'visible', timeout: ROUTE_TIMEOUT_MS }),
    ]).catch(() => undefined);
  } finally {
    await browser.close();
  }
}

