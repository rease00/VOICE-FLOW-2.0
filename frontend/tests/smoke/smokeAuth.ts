import { expect, type Page } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

interface StudioSmokeCredentials {
  email: string;
  password: string;
}

const parseEnvFile = (filePath: string): Record<string, string> => {
  if (!existsSync(filePath)) return {};
  const raw = readFileSync(filePath, 'utf8');
  const result: Record<string, string> = {};
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const separatorIndex = trimmed.indexOf('=');
    if (separatorIndex <= 0) continue;
    const key = trimmed.slice(0, separatorIndex).trim();
    if (!key) continue;
    const valueToken = trimmed.slice(separatorIndex + 1).trim();
    const unquoted = (
      (valueToken.startsWith('"') && valueToken.endsWith('"'))
      || (valueToken.startsWith('\'') && valueToken.endsWith('\''))
    )
      ? valueToken.slice(1, -1)
      : valueToken;
    result[key] = unquoted;
  }
  return result;
};

const resolveEnvFallback = (): Record<string, string> => {
  const cwd = process.cwd();
  return {
    ...parseEnvFile(path.resolve(cwd, '.env.local')),
    ...parseEnvFile(path.resolve(cwd, '..', '.env.local')),
  };
};

export const resolveStudioSmokeCredentials = (): StudioSmokeCredentials | null => {
  const fallbackEnv = resolveEnvFallback();
  const email = String(process.env.PLAYWRIGHT_ADMIN_EMAIL || fallbackEnv.PLAYWRIGHT_ADMIN_EMAIL || '').trim();
  const password = String(process.env.PLAYWRIGHT_ADMIN_PASSWORD || fallbackEnv.PLAYWRIGHT_ADMIN_PASSWORD || '').trim();
  if (!email || !password) return null;
  return { email, password };
};

export const ensureStudioSmokeAuthenticated = async (page: Page, credentials: StudioSmokeCredentials): Promise<void> => {
  await page.goto('/app/login', { waitUntil: 'domcontentloaded', timeout: 120_000 });
  try {
    const current = new URL(page.url());
    if (current.hostname === '127.0.0.1') {
      current.hostname = 'localhost';
      await page.goto(current.toString(), { waitUntil: 'domcontentloaded', timeout: 120_000 });
    }
  } catch {
    // no-op: keep current URL when parsing fails
  }
  const loginPathname = new URL(page.url()).pathname || '';
  if (!/^\/app\/login(?:\/|$)/.test(loginPathname)) {
    return;
  }
  await Promise.any([
    page.getByRole('heading', { name: /Welcome back|Create your V FLOW AI account/i }).waitFor({ state: 'visible', timeout: 20_000 }),
    page.locator('input#auth-email').waitFor({ state: 'visible', timeout: 20_000 }),
    page.getByRole('button', { name: /^Sign In$/i }).waitFor({ state: 'visible', timeout: 20_000 }),
  ]).catch(async () => {
    throw new Error(`Login UI did not render expected controls. Current URL: ${page.url()}`);
  });
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

