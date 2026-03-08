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
    await page.getByRole('button', { name: 'Get Started' }).waitFor({ state: 'visible', timeout: ROUTE_TIMEOUT_MS });
    await page.getByRole('button', { name: 'Get Started' }).click({ force: true });
    await page.getByText('Secure sign-in for your VoiceFlow workspace.').waitFor({
      state: 'visible',
      timeout: ROUTE_TIMEOUT_MS,
    });

    await page.goto(`${baseUrl}/?vf-screen=main&vf-tab=READER`, {
      waitUntil: 'domcontentloaded',
      timeout: ROUTE_TIMEOUT_MS,
    });
    await page.getByRole('button', { name: 'Open Reader tools' }).waitFor({
      state: 'visible',
      timeout: ROUTE_TIMEOUT_MS,
    });
  } finally {
    await browser.close();
  }
}
