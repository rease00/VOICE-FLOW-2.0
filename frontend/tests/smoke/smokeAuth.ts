import { expect, type Page } from '@playwright/test';

interface StudioSmokeCredentials {
  email: string;
  password: string;
}

export const resolveStudioSmokeCredentials = (): StudioSmokeCredentials | null => {
  const email = String(process.env.PLAYWRIGHT_ADMIN_EMAIL || '').trim();
  const password = String(process.env.PLAYWRIGHT_ADMIN_PASSWORD || '').trim();
  if (!email || !password) return null;
  return { email, password };
};

export const ensureStudioSmokeAuthenticated = async (page: Page, credentials: StudioSmokeCredentials): Promise<void> => {
  await page.goto('/app/login', { waitUntil: 'domcontentloaded', timeout: 120_000 });
  await expect(page.getByText('Secure sign-in for your V FLOW AI workspace.', { exact: true })).toBeVisible({ timeout: 20_000 });
  const emailInput = page.locator('input#auth-email');
  const passwordInput = page.locator('input#auth-password');
  const signInButton = page.getByRole('button', { name: /^Sign In$/i });

  await expect(emailInput).toBeVisible({ timeout: 20_000 });
  await expect(passwordInput).toBeVisible({ timeout: 20_000 });
  await expect(signInButton).toBeVisible({ timeout: 20_000 });

  await emailInput.fill(credentials.email);
  await passwordInput.fill(credentials.password);
  await signInButton.click();

  await Promise.race([
    page.waitForURL((url) => {
      const pathname = url.pathname || '';
      return /^\/(app|reader)(?:\/|\?|$)/.test(pathname) && !/^\/app\/login(?:\/|\?|$)/.test(pathname);
    }, { timeout: 60_000 }),
    page.getByTestId('reader-home').waitFor({ state: 'visible', timeout: 60_000 }),
    page.getByText('Reader Rights Notice').waitFor({ state: 'visible', timeout: 60_000 }),
  ]).catch(async () => {
    const currentUrl = page.url();
    throw new Error(`Smoke auth did not leave login flow. Current URL: ${currentUrl}`);
  });
};

