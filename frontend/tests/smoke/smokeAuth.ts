import { expect, type Page } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

interface StudioSmokeCredentials {
  email: string;
  password: string;
}

interface EnsureStudioSmokeAuthenticatedOptions {
  preloadWritingSurface?: boolean;
}

const LOGIN_PATH_RE = /^\/app\/login(?:\/|$)/;
const LOGIN_HEADING_RE = /Open Studio in three simple steps|Welcome back|Create your V FLOW AI account/i;
const WORKSPACE_HANDOFF_HEADING_RE = /Workspace handoff/i;
const APP_HANDOFF_PATH_RE = /^\/app(?:\/|$)/;
const WRITING_PATH_RE = /^\/app\/writing(?:\/|$)/;
const STUDIO_PATH_RE = /^\/app\/studio(?:\/|$)/;
const LOGIN_UI_READY_TIMEOUT_MS = 12_000;
const WORKSPACE_HANDOFF_TIMEOUT_MS = 12_000;
const LOGIN_RECOVERY_WAIT_MS = 650;
const LOGIN_HYDRATION_TIMEOUT_MS = 20_000;
const AUTH_INPUT_TYPE_DELAY_MS = 18;
const AUTH_INPUT_SETTLE_TIMEOUT_MS = 120;
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

const resolveCredentialPair = (
  sourceName: string,
  source: Record<string, string | undefined>,
): StudioSmokeCredentials | null => {
  const email = String(source.PLAYWRIGHT_ADMIN_EMAIL || '').trim();
  const password = String(source.PLAYWRIGHT_ADMIN_PASSWORD || '').trim();
  const hasEmail = email.length > 0;
  const hasPassword = password.length > 0;
  if (!hasEmail && !hasPassword) return null;
  if (!hasEmail || !hasPassword) {
    throw new Error(
      `Smoke auth credentials are partially configured in ${sourceName}. ` +
      'Set both PLAYWRIGHT_ADMIN_EMAIL and PLAYWRIGHT_ADMIN_PASSWORD in the same source.',
    );
  }
  return { email, password };
};

const resolveEnvCredentialCandidates = (): StudioSmokeCredentials[] => {
  const cwd = process.cwd();
  const localEnv = parseEnvFile(path.resolve(cwd, '.env.local'));
  const workspaceEnv = parseEnvFile(path.resolve(cwd, '..', '.env.local'));
  const processPair = resolveCredentialPair('process.env', {
    PLAYWRIGHT_ADMIN_EMAIL: process.env.PLAYWRIGHT_ADMIN_EMAIL,
    PLAYWRIGHT_ADMIN_PASSWORD: process.env.PLAYWRIGHT_ADMIN_PASSWORD,
  });
  const localEnvPair = resolveCredentialPair('.env.local (frontend)', localEnv);
  const workspaceEnvPair = resolveCredentialPair('.env.local (workspace)', workspaceEnv);

  return [
    processPair,
    localEnvPair,
    workspaceEnvPair,
  ].filter((candidate): candidate is StudioSmokeCredentials => Boolean(candidate));
};

const resolveCredentialsFixturePath = (): string | null => {
  const configured = String(process.env.PLAYWRIGHT_SMOKE_AUTH_FIXTURE_PATH || '').trim();
  if (!configured) return null;
  return path.resolve(process.cwd(), configured);
};

const readStudioSmokeCredentialsFixture = (fixturePath: string): StudioSmokeCredentials | null => {
  if (!existsSync(fixturePath)) {
    throw new Error(`Smoke auth fixture path does not exist: ${fixturePath}`);
  }
  try {
    const parsed = JSON.parse(readFileSync(fixturePath, 'utf8')) as Partial<StudioSmokeCredentials>;
    const email = String(parsed.email || '').trim();
    const password = String(parsed.password || '').trim();
    if ((email && !password) || (!email && password)) {
      throw new Error(
        `Smoke auth fixture is partially configured at ${fixturePath}. Set both email and password.`,
      );
    }
    if (!email || !password) return null;
    return { email, password };
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error(`Smoke auth fixture is invalid JSON: ${fixturePath}`);
    }
    if (error instanceof Error) {
      throw error;
    }
    throw new Error(`Smoke auth fixture is unreadable: ${fixturePath}`);
  }
};

const isLoginPath = (urlValue: string): boolean => {
  try {
    const pathname = new URL(urlValue).pathname || '';
    return LOGIN_PATH_RE.test(pathname);
  } catch {
    return false;
  }
};

const hasFallbackCredentialsInQuery = (urlValue: string): boolean => {
  try {
    const url = new URL(urlValue);
    if (!LOGIN_PATH_RE.test(url.pathname || '')) return false;
    return url.searchParams.has('email') || url.searchParams.has('password');
  } catch {
    return false;
  }
};

export const resolveStudioSmokeCredentials = (): StudioSmokeCredentials | null => {
  const [candidate] = resolveEnvCredentialCandidates();
  if (candidate) return candidate;
  const fixturePath = resolveCredentialsFixturePath();
  if (!fixturePath) return null;
  return readStudioSmokeCredentialsFixture(fixturePath);
};

export const ensureStudioSmokeAuthenticated = async (
  page: Page,
  credentials: StudioSmokeCredentials,
  options: EnsureStudioSmokeAuthenticatedOptions = {},
): Promise<void> => {
  const preloadWritingSurface = options.preloadWritingSurface !== false;
  const requireWritingAuth = String(process.env.PLAYWRIGHT_REQUIRE_WRITING_AUTH || '1').trim() !== '0';
  const loginRetryAttempts = Math.max(2, Number.parseInt(String(process.env.PLAYWRIGHT_AUTH_LOGIN_RETRIES || '5'), 10) || 5);
  const loginEntryPath = '/app/login?vf-screen=login';
  const selectAllShortcut = process.platform === 'darwin' ? 'Meta+A' : 'Control+A';
  const resolveAppUrl = (pathname: string): string => {
    try {
      const current = new URL(page.url());
      if (current.protocol.startsWith('http')) {
        return new URL(pathname, current.origin).toString();
      }
    } catch {
      // Fall back to Playwright baseURL-relative navigation.
    }
    return pathname;
  };
  const navigateToLoginEntry = async (): Promise<void> => {
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        await page.goto(resolveAppUrl(loginEntryPath), { waitUntil: 'domcontentloaded', timeout: 120_000 });
        return;
      } catch (error) {
        const message = String((error as Error)?.message || error || '');
        const aborted = /ERR_ABORTED/i.test(message);
        if (!aborted || attempt === 3) {
          throw error;
        }
        await page.waitForTimeout(350 + (attempt * 200));
      }
    }
  };

  const resetToLoginEntry = async (attempt: number): Promise<void> => {
    try {
      await navigateToLoginEntry();
    } catch (error) {
      const message = String((error as Error)?.message || error || '');
      if (!/ERR_ABORTED/i.test(message)) {
        throw error;
      }
    }
    await page.waitForURL((url) => (
      LOGIN_PATH_RE.test(url.pathname || '')
      && !url.searchParams.has('email')
      && !url.searchParams.has('password')
    ), { timeout: LOGIN_HYDRATION_TIMEOUT_MS }).catch(() => undefined);
    await page
      .locator('[data-testid="auth-shell"][data-auth-hydrated="true"]')
      .first()
      .waitFor({ state: 'visible', timeout: LOGIN_HYDRATION_TIMEOUT_MS })
      .catch(() => undefined);
    await page.waitForTimeout(LOGIN_RECOVERY_WAIT_MS + (attempt * 180));
  };

  await page.context().clearCookies();
  await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 120_000 }).catch(() => undefined);
  await page.evaluate(() => {
    try {
      localStorage.clear();
      sessionStorage.clear();
    } catch {
      // ignore origin/storage edge cases
    }
  }).catch(() => undefined);

  await navigateToLoginEntry();

  if (isLoginPath(page.url())) {
    const fillLoginInput = async (
      input: ReturnType<Page['locator']>,
      value: string,
    ): Promise<void> => {
      const normalizedValue = String(value || '');
      await input.click({ force: true });
      await input.press(selectAllShortcut).catch(() => undefined);
      await input.press('Delete').catch(() => undefined);
      await input.press('Backspace').catch(() => undefined);
      await input.pressSequentially(normalizedValue, { delay: AUTH_INPUT_TYPE_DELAY_MS });
      await page.waitForTimeout(AUTH_INPUT_SETTLE_TIMEOUT_MS);
      const afterType = String(await input.inputValue().catch(() => '')).trim();
      if (afterType === normalizedValue) {
        await expect(input).toHaveValue(normalizedValue, { timeout: 5_000 });
        return;
      }
      await input.evaluate((node, nextValue) => {
        if (!(node instanceof HTMLInputElement)) return;
        node.focus();
        const descriptor = Object.getOwnPropertyDescriptor(
          Object.getPrototypeOf(node),
          'value',
        );
        descriptor?.set?.call(node, String(nextValue || ''));
        node.dispatchEvent(new InputEvent('input', {
          bubbles: true,
          data: String(nextValue || ''),
          inputType: 'insertText',
        }));
        node.dispatchEvent(new Event('change', { bubbles: true }));
      }, normalizedValue);
      await expect(input).toHaveValue(value, { timeout: 5_000 });
    };

    const ensureLoginUiReady = async (): Promise<{
      emailInput: ReturnType<Page['locator']>;
      passwordInput: ReturnType<Page['locator']>;
      signInButton: ReturnType<Page['locator']>;
    } | null> => {
      if (!isLoginPath(page.url())) return null;

      const loginShell = page.locator('[data-testid="auth-shell"]').first();
      const hydratedLoginShell = page.locator('[data-testid="auth-shell"][data-auth-hydrated="true"]').first();
      const loginCard = page.locator('[data-testid="auth-card"]').first();
      const emailInput = page.locator('input#auth-email').first();
      const passwordInput = page.locator('input#auth-password').first();
      const handoffHeading = page.getByRole('heading', { name: WORKSPACE_HANDOFF_HEADING_RE }).first();

      const readinessSignals = [
        loginShell.waitFor({ state: 'visible', timeout: LOGIN_UI_READY_TIMEOUT_MS }),
        hydratedLoginShell.waitFor({ state: 'visible', timeout: LOGIN_HYDRATION_TIMEOUT_MS }),
        loginCard.waitFor({ state: 'visible', timeout: LOGIN_UI_READY_TIMEOUT_MS }),
        page.getByRole('heading', { name: LOGIN_HEADING_RE }).waitFor({ state: 'visible', timeout: LOGIN_UI_READY_TIMEOUT_MS }),
        emailInput.waitFor({ state: 'visible', timeout: LOGIN_UI_READY_TIMEOUT_MS }),
        passwordInput.waitFor({ state: 'visible', timeout: LOGIN_UI_READY_TIMEOUT_MS }),
        handoffHeading.waitFor({ state: 'visible', timeout: LOGIN_UI_READY_TIMEOUT_MS }),
        page.waitForURL((url) => !LOGIN_PATH_RE.test(url.pathname || ''), { timeout: LOGIN_UI_READY_TIMEOUT_MS }),
      ];

      const loginSurfaceDetected = await Promise.any(readinessSignals)
        .then(() => true)
        .catch(() => false);
      if (!loginSurfaceDetected) return null;

      if (!isLoginPath(page.url())) return null;
      if (!await hydratedLoginShell.isVisible().catch(() => false)) return null;

      if (await handoffHeading.isVisible().catch(() => false)) {
        await Promise.any([
          page.waitForURL((url) => !LOGIN_PATH_RE.test(url.pathname || ''), { timeout: WORKSPACE_HANDOFF_TIMEOUT_MS }),
          page.getByTestId('voices-workspace').waitFor({ state: 'visible', timeout: WORKSPACE_HANDOFF_TIMEOUT_MS }),
          page.locator('.vf-studio-grid').first().waitFor({ state: 'visible', timeout: WORKSPACE_HANDOFF_TIMEOUT_MS }),
          page.locator('.vf-editor-shell').first().waitFor({ state: 'visible', timeout: WORKSPACE_HANDOFF_TIMEOUT_MS }),
        ]).catch(() => undefined);

        if (!isLoginPath(page.url())) return null;
      }

      const loginTabButton = page.getByRole('button', { name: /^Login$/i }).first();
      if (await loginTabButton.isVisible().catch(() => false)) {
        const isPressed = String(await loginTabButton.getAttribute('aria-pressed').catch(() => 'false')) === 'true';
        if (!isPressed) {
          await loginTabButton.click({ force: true }).catch(() => undefined);
          await page.waitForTimeout(300);
        }
      }

      await expect(emailInput).toBeVisible({ timeout: 20_000 });
      await expect(passwordInput).toBeVisible({ timeout: 20_000 });

      const signInForm = emailInput.locator('xpath=ancestor::form[1]');
      const signInButton = signInForm.locator('button[type="submit"]:visible').first();
      await expect(signInButton).toBeVisible({ timeout: 20_000 });

      const signInButtonDisabled = await signInButton.isDisabled().catch(() => false);
      if (signInButtonDisabled) {
        const busyText = String(await signInButton.textContent().catch(() => '')).trim();
        const ariaBusy = String(await signInButton.getAttribute('aria-busy').catch(() => 'false'));
        const appearsBusy = /please wait/i.test(busyText) || ariaBusy === 'true';
        if (appearsBusy) {
          await Promise.any([
            page.waitForURL((url) => !LOGIN_PATH_RE.test(url.pathname || ''), { timeout: 30_000 }),
            page.locator('[role="alert"]').filter({ hasText: /\S/ }).first().waitFor({ state: 'visible', timeout: 30_000 }),
          ]).catch(() => undefined);
          if (!isLoginPath(page.url())) return null;
          return null;
        }
      }

      await expect(signInButton).toBeEnabled({ timeout: 20_000 });

      return { emailInput, passwordInput, signInButton };
    };

    let signedIn = false;
    for (let attempt = 1; attempt <= loginRetryAttempts; attempt += 1) {
      if (!isLoginPath(page.url())) {
        signedIn = true;
        break;
      }

      const preAttemptUrl = new URL(page.url());
      const hasLeakedCredentialsInQuery = preAttemptUrl.searchParams.has('email') || preAttemptUrl.searchParams.has('password');
      if (hasLeakedCredentialsInQuery) {
        await resetToLoginEntry(attempt);
      }

      let loginUi: Awaited<ReturnType<typeof ensureLoginUiReady>> = null;
      try {
        loginUi = await ensureLoginUiReady();
      } catch {
        loginUi = null;
      }
      if (!loginUi) {
        if (!isLoginPath(page.url())) {
          signedIn = true;
          break;
        }
        if (attempt < loginRetryAttempts) {
          await resetToLoginEntry(attempt);
          continue;
        }
        break;
      }

      const { emailInput, passwordInput, signInButton } = loginUi;
      await fillLoginInput(emailInput, credentials.email);
      await fillLoginInput(passwordInput, credentials.password);
      await expect(emailInput).toHaveValue(credentials.email, { timeout: 3_000 });
      await expect(passwordInput).toHaveValue(credentials.password, { timeout: 3_000 });
      await signInButton.click();

      await Promise.any([
        page.waitForURL((url) => !LOGIN_PATH_RE.test(url.pathname || ''), { timeout: 30_000 }),
        page.waitForURL((url) => (
          LOGIN_PATH_RE.test(url.pathname || '')
          && (url.searchParams.has('email') || url.searchParams.has('password'))
        ), { timeout: 30_000 }),
        page.locator('[role="alert"]').filter({ hasText: /\S/ }).first().waitFor({ state: 'visible', timeout: 30_000 }),
      ]).catch(() => undefined);

      if (!isLoginPath(page.url())) {
        signedIn = true;
        break;
      }

      if (hasFallbackCredentialsInQuery(page.url()) && attempt < loginRetryAttempts) {
        await resetToLoginEntry(attempt);
        continue;
      }

      const authError = (await page.locator('[role="alert"]').allTextContents().catch(() => []))
        .map((value) => String(value || '').trim())
        .filter(Boolean)
        .join(' | ');
      if (authError) {
        const transientAuthError = /cannot reach authentication service|cannot connect to backend service|network/i.test(authError.toLowerCase());
        if (transientAuthError && attempt < loginRetryAttempts) {
          await page.waitForTimeout(400 + attempt * 200);
          await resetToLoginEntry(attempt);
          continue;
        }
        const retryableValidationError = /full email address|valid email|required/i.test(authError.toLowerCase());
        if (retryableValidationError && attempt < loginRetryAttempts) {
          await resetToLoginEntry(attempt);
          continue;
        }
        throw new Error(`Smoke auth sign-in failed: ${authError}. Current URL: ${page.url()}`);
      }

      const current = new URL(page.url());
      const nativeSubmitFallbackDetected = current.searchParams.has('email') || current.searchParams.has('password');
      if (nativeSubmitFallbackDetected && attempt < loginRetryAttempts) {
        await resetToLoginEntry(attempt);
        continue;
      }

      if (attempt < loginRetryAttempts) {
        await page.waitForTimeout(LOGIN_RECOVERY_WAIT_MS);
      }
    }

    if (!signedIn) {
      throw new Error(`Smoke auth did not establish a signed-in session. Current URL: ${page.url()}`);
    }
  }

  const navigateToWriting = async (): Promise<void> => {
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        await page.goto(resolveAppUrl('/app/writing'), { waitUntil: 'domcontentloaded', timeout: 120_000 });
        return;
      } catch (error) {
        const message = String((error as Error)?.message || error || '');
        const aborted = /ERR_ABORTED/i.test(message);
        if (!aborted || attempt === 3) throw error;
        await page.waitForTimeout(400);
      }
    }
  };

  const navigateToStudio = async (): Promise<void> => {
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        await page.goto(resolveAppUrl('/app/studio'), { waitUntil: 'domcontentloaded', timeout: 120_000 });
        return;
      } catch (error) {
        const message = String((error as Error)?.message || error || '');
        const aborted = /ERR_ABORTED/i.test(message);
        if (!aborted || attempt === 3) throw error;
        await page.waitForTimeout(350 + (attempt * 150));
      }
    }
  };

  const waitForWorkspaceHandoffToSettle = async (): Promise<void> => {
    const currentPath = (() => {
      try {
        return new URL(page.url()).pathname || '';
      } catch {
        return '';
      }
    })();
    if (!APP_HANDOFF_PATH_RE.test(currentPath) || LOGIN_PATH_RE.test(currentPath)) {
      return;
    }

    const handoffHeading = page.getByRole('heading', { name: /Loading workspace|Workspace handoff/i }).first();
    await Promise.any([
      handoffHeading.waitFor({ state: 'visible', timeout: 5_000 }).catch(() => undefined),
      page.waitForURL((url) => {
        const pathname = url.pathname || '';
        return !APP_HANDOFF_PATH_RE.test(pathname) || WRITING_PATH_RE.test(pathname) || STUDIO_PATH_RE.test(pathname);
      }, { timeout: 35_000 }),
      page.locator('.vf-studio-grid').first().waitFor({ state: 'visible', timeout: 35_000 }),
      page.locator('.vf-editor-shell').first().waitFor({ state: 'visible', timeout: 35_000 }),
      page.getByTestId('novel-workspace').first().waitFor({ state: 'visible', timeout: 35_000 }),
      page.getByTestId('novel-editor-tabs').first().waitFor({ state: 'visible', timeout: 35_000 }),
    ]).catch(() => undefined);

    const settledPath = (() => {
      try {
        return new URL(page.url()).pathname || '';
      } catch {
        return '';
      }
    })();
    if (APP_HANDOFF_PATH_RE.test(settledPath) && !LOGIN_PATH_RE.test(settledPath)) {
      await Promise.any([
        page.waitForURL((url) => {
          const pathname = url.pathname || '';
          return !APP_HANDOFF_PATH_RE.test(pathname) || WRITING_PATH_RE.test(pathname) || STUDIO_PATH_RE.test(pathname);
        }, { timeout: 30_000 }),
        page.locator('.vf-studio-grid').first().waitFor({ state: 'visible', timeout: 30_000 }),
        page.locator('.vf-editor-shell').first().waitFor({ state: 'visible', timeout: 30_000 }),
        page.getByTestId('novel-workspace').first().waitFor({ state: 'visible', timeout: 30_000 }),
        page.getByTestId('novel-editor-tabs').first().waitFor({ state: 'visible', timeout: 30_000 }),
      ]).catch(() => undefined);
    }
  };

  const ensureStudioRouteAuthenticated = async (): Promise<void> => {
    await waitForWorkspaceHandoffToSettle();
    await navigateToStudio();

    if (isLoginPath(page.url())) {
      throw new Error(`Smoke auth did not persist to the Studio route. Current URL: ${page.url()}`);
    }

    await Promise.any([
      page.locator('.vf-studio-grid').first().waitFor({ state: 'visible', timeout: 35_000 }),
      page.locator('.vf-editor-shell').first().waitFor({ state: 'visible', timeout: 35_000 }),
      page.getByRole('button', { name: /^Generate Audio$/i }).first().waitFor({ state: 'visible', timeout: 35_000 }),
    ]).catch(async () => {
      const pathname = new URL(page.url()).pathname || '';
      if (isLoginPath(page.url()) || !STUDIO_PATH_RE.test(pathname)) {
        throw new Error(`Smoke auth did not reach the Studio workspace after sign-in. Current URL: ${page.url()}`);
      }
      throw new Error(`Smoke auth reached /app/studio but the workspace UI did not appear. Current URL: ${page.url()}`);
    });
  };

  if (!preloadWritingSurface) {
    await ensureStudioRouteAuthenticated();
    return;
  }

  await ensureStudioRouteAuthenticated();
  await navigateToWriting();
  const waitForWritingSurfaceState = async (timeoutMs: number): Promise<'ready' | 'error' | 'timeout'> => {
    const resolveState = (
      promise: Promise<unknown>,
      state: 'ready' | 'error',
    ): Promise<'ready' | 'error'> => promise.then(() => state);

    return Promise.any([
      resolveState(page.getByRole('heading', { name: /Novel Workspace/i }).first().waitFor({ state: 'visible', timeout: timeoutMs }), 'ready'),
      resolveState(page.getByTestId('novel-workspace').first().waitFor({ state: 'visible', timeout: timeoutMs }), 'ready'),
      resolveState(page.getByTestId('novel-editor-tabs').first().waitFor({ state: 'visible', timeout: timeoutMs }), 'ready'),
      resolveState(page.getByTestId('novel-library-tabs').first().waitFor({ state: 'visible', timeout: timeoutMs }), 'ready'),
      resolveState(page.locator('.vf-topbar').first().waitFor({ state: 'visible', timeout: timeoutMs }), 'ready'),
      resolveState(page.locator('.vf-editor-shell').first().waitFor({ state: 'visible', timeout: timeoutMs }), 'ready'),
      resolveState(page.locator('.vf-studio-grid').first().waitFor({ state: 'visible', timeout: timeoutMs }), 'ready'),
      resolveState(page.getByRole('heading', { name: /Sign in to open Writing/i }).first().waitFor({ state: 'visible', timeout: timeoutMs }), 'ready'),
      resolveState(page.getByRole('button', { name: /^Retry now$/i }).first().waitFor({ state: 'visible', timeout: timeoutMs }), 'error'),
    ]).catch(() => 'timeout');
  };

  let writingSurfaceState = await waitForWritingSurfaceState(35_000);
  if (writingSurfaceState === 'timeout') {
    const loadingHeading = page.getByRole('heading', { name: /Loading workspace|Workspace handoff/i }).first();
    const loadingVisible = await loadingHeading.isVisible().catch(() => false);
    if (loadingVisible) {
      await page.reload({ waitUntil: 'domcontentloaded', timeout: 120_000 }).catch(() => undefined);
      writingSurfaceState = await waitForWritingSurfaceState(25_000);
    }
  }

  for (let retryAttempt = 0; retryAttempt < 2 && writingSurfaceState === 'error'; retryAttempt += 1) {
    const retryWritingButton = page.getByRole('button', { name: /^Retry now$/i }).first();
    if (await retryWritingButton.isVisible().catch(() => false)) {
      await retryWritingButton.click({ force: true }).catch(() => undefined);
      writingSurfaceState = await waitForWritingSurfaceState(20_000);
      if (writingSurfaceState === 'ready') break;
    }
  }

  if (writingSurfaceState !== 'ready') {
    const retryUiButton = page.getByRole('button', { name: /^Retry UI$/i }).first();
    if (await retryUiButton.isVisible().catch(() => false)) {
      await retryUiButton.click({ force: true }).catch(() => undefined);
      writingSurfaceState = await waitForWritingSurfaceState(20_000);
    }
  }

  if (writingSurfaceState !== 'ready') {
    const retryWritingButton = page.getByRole('button', { name: /^Retry now$/i }).first();
    if (await retryWritingButton.isVisible().catch(() => false)) {
      await retryWritingButton.click({ force: true }).catch(() => undefined);
      writingSurfaceState = await waitForWritingSurfaceState(20_000);
    }
  }
  if (writingSurfaceState !== 'ready') {
    const currentUrl = page.url();
    throw new Error(`Smoke auth could not load Writing workspace. Current URL: ${currentUrl}`);
  }

  const writingPath = new URL(page.url()).pathname || '';
  if (!WRITING_PATH_RE.test(writingPath)) {
    throw new Error(`Smoke auth did not land on the Writing workspace route. Current URL: ${page.url()}`);
  }

  const authGate = page.getByRole('heading', { name: /Sign in to open Writing/i }).first();
  const authGateVisible = await authGate.isVisible().catch(() => false);
  if (authGateVisible && requireWritingAuth) {
    await authGate.waitFor({ state: 'hidden', timeout: 20_000 }).catch(async () => {
      throw new Error(`Smoke auth resolved to the writing sign-in gate instead of authenticated workspace. Current URL: ${page.url()}`);
    });
  }
};

