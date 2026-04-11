import { chromium } from 'playwright';

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3000';
const EMAIL = process.env.PLAYWRIGHT_ADMIN_EMAIL || 'admin1@voiceflow.local';
const PASSWORD = process.env.PLAYWRIGHT_ADMIN_PASSWORD || 'rease1999';

const LOGIN_PATH_RE = /^\/app\/login(?:\/|$)/i;

const isLoginPath = (url) => {
  try {
    return LOGIN_PATH_RE.test(new URL(String(url || BASE_URL)).pathname || '');
  } catch {
    return false;
  }
};

const toAppUrl = (path) => new URL(String(path || '/'), BASE_URL).toString();

const fillInput = async (locator, value) => {
  const text = String(value || '');
  await locator.click({ force: true });
  await locator.fill('');
  await locator.type(text, { delay: 20 });
};

const ensureLoggedIn = async (page) => {
  await page.goto(toAppUrl('/app/login?vf-screen=login'), { waitUntil: 'domcontentloaded', timeout: 120_000 });
  if (!isLoginPath(page.url())) return;

  const emailInput = page.locator('input#auth-email, input[type="email"]').first();
  const passwordInput = page.locator('input#auth-password, input[type="password"]').first();
  const signInButton = page.locator('button[type="submit"]').first();

  await emailInput.waitFor({ state: 'visible', timeout: 60_000 });
  await passwordInput.waitFor({ state: 'visible', timeout: 60_000 });
  await fillInput(emailInput, EMAIL);
  await fillInput(passwordInput, PASSWORD);
  await signInButton.click({ force: true });

  await page.waitForURL((url) => !LOGIN_PATH_RE.test(url.pathname || ''), { timeout: 120_000 });
};

const run = async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  try {
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 120_000 });
    await ensureLoggedIn(page);

    await page.goto(toAppUrl('/app/studio'), { waitUntil: 'domcontentloaded', timeout: 120_000 });
    await Promise.any([
      page.locator('.vf-studio-grid').first().waitFor({ state: 'visible', timeout: 60_000 }),
      page.locator('.vf-editor-shell').first().waitFor({ state: 'visible', timeout: 60_000 }),
      page.locator('[data-testid="voices-workspace"]').first().waitFor({ state: 'visible', timeout: 60_000 }),
    ]);

    const buttonTexts = (await page.locator('button:visible').allTextContents())
      .map((value) => String(value || '').replace(/\s+/g, ' ').trim())
      .filter(Boolean)
      .slice(0, 80);
    const inputMeta = await page.locator('input, textarea, select').evaluateAll((nodes) => nodes.slice(0, 80).map((node) => ({
      tag: node.tagName.toLowerCase(),
      type: 'type' in node ? String(node.type || '') : '',
      id: String(node.id || ''),
      name: String(node.getAttribute('name') || ''),
      placeholder: String(node.getAttribute('placeholder') || ''),
      ariaLabel: String(node.getAttribute('aria-label') || ''),
    })));
    const tabTexts = (await page.locator('[role="tab"]:visible').allTextContents())
      .map((value) => String(value || '').replace(/\s+/g, ' ').trim())
      .filter(Boolean)
      .slice(0, 50);

    console.log(JSON.stringify({
      currentUrl: page.url(),
      buttons: buttonTexts,
      tabs: tabTexts,
      inputs: inputMeta,
    }, null, 2));
  } finally {
    await browser.close();
  }
};

run().catch((error) => {
  console.error(error?.stack || String(error));
  process.exitCode = 1;
});
