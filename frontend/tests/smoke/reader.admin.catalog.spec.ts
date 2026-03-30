import { expect, test } from '@playwright/test';
import { ensureStudioSmokeAuthenticated, resolveStudioSmokeCredentials } from './smokeAuth';

const PDF_1_PAGE = Buffer.from(
  'JVBERi0xLjQKMSAwIG9iago8PCAvVHlwZSAvQ2F0YWxvZyAvUGFnZXMgMiAwIFIgPj4KZW5kb2JqCjIgMCBvYmoKPDwgL1R5cGUgL1BhZ2VzIC9LaWRzIFszIDAgUl0gL0NvdW50IDEgPj4KZW5kb2JqCjMgMCBvYmoKPDwgL1R5cGUgL1BhZ2UgL1BhcmVudCAyIDAgUiAvTWVkaWFCb3ggWzAgMCAyMDAgMjAwXSAvQ29udGVudHMgNCAwIFIgL1Jlc291cmNlcyA8PCAvRm9udCA8PCAvRjEgNSAwIFIgPj4gPj4gPj4KZW5kb2JqCjQgMCBvYmoKPDwgL0xlbmd0aCA0MyA+PgpzdHJlYW0KQlQKL0YxIDI0IFRmCjUwIDEwMCBUZAooTWFuZ2EgU21va2UpIFRqCkVUCmVuZHN0cmVhbQplbmRvYmoKNSAwIG9iago8PCAvVHlwZSAvRm9udCAvU3VidHlwZSAvVHlwZTEgL0Jhc2VGb250IC9IZWx2ZXRpY2EgPj4KZW5kb2JqCnhyZWYKMCA2CjAwMDAwMDAwMDAgNjU1MzUgZiAKMDAwMDAwMDAwOSAwMDAwMCBuIAowMDAwMDAwMDU4IDAwMDAwIG4gCjAwMDAwMDAxMTUgMDAwMDAgbiAKMDAwMDAwMDI0MSAwMDAwMCBuIAowMDAwMDAwMzMzIDAwMDAwIG4gCnRyYWlsZXIKPDwgL1Jvb3QgMSAwIFIgL1NpemUgNiA+PgpzdGFydHhyZWYKNDAzCiUlRU9GCg==',
  'base64'
);

const buildTitle = (prefix: string): string => `${prefix} ${Date.now().toString(36)} ${Math.random().toString(36).slice(2, 8)}`;
const ADMIN_TOKEN_PROPAGATION_DELAY_MS = 5_000;

const escapeRegExp = (value: string): string => String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const openWorkspaceTab = async (page: Parameters<typeof test>[0]['page'], label: string): Promise<void> => {
  const button = page.locator('aside').getByRole('button', { name: new RegExp(`^${label}$`) }).first();
  if (await button.isVisible().catch(() => false)) {
    await button.scrollIntoViewIfNeeded().catch(() => undefined);
    try {
      await button.click({ timeout: 5_000 });
      return;
    } catch {
      // fall through to a direct DOM click
    }
    await button.evaluate((node) => {
      if (node instanceof HTMLButtonElement) node.click();
    }).catch(() => undefined);
    return;
  }

  const navToggle = page.getByRole('button', { name: /open navigation menu/i }).first();
  if (await navToggle.isVisible().catch(() => false)) {
    await navToggle.click({ force: true });
  }

  const fallbackButton = page.locator('aside').getByRole('button', { name: new RegExp(`^${label}$`) }).first();
  try {
    await expect(fallbackButton).toBeVisible({ timeout: 15_000 });
  } catch (error) {
    if (/^admin$/i.test(label)) {
      test.skip(
        true,
        'Authenticated smoke account does not expose the Admin workspace tab. '
          + 'Use an account with active admin actor permissions.'
      );
      return;
    }
    throw error;
  }
  await fallbackButton.scrollIntoViewIfNeeded().catch(() => undefined);
  try {
    await fallbackButton.click({ force: true, timeout: 10_000 });
  } catch {
    await fallbackButton.evaluate((node) => {
      if (node instanceof HTMLButtonElement) node.click();
    }).catch(() => undefined);
  }
};

const unlockAdminMutations = async (page: Parameters<typeof test>[0]['page']): Promise<void> => {
  await openWorkspaceTab(page, 'Admin');
  const unlockTab = page.getByRole('tab', { name: /^Unlock$/i }).first();
  await unlockTab.click({ force: true });
  await expect(unlockTab).toHaveAttribute('aria-selected', 'true', { timeout: 20_000 });

  let unlockIssuePayload: { unlockKey?: string } = {};
  let issueResolved = false;
  const maxUnlockIssueAttempts = 6;
  for (let attempt = 0; attempt < maxUnlockIssueAttempts; attempt += 1) {
    const unlockIssueResponse = page.waitForResponse(
      (response) => response.request().method() === 'POST' && response.url().includes('/admin/session-unlock/issue'),
      { timeout: 120_000 }
    );
    await page.getByRole('button', { name: /^Issue Key$/i }).click({ force: true });
    const issueResponse = await unlockIssueResponse;
    if (issueResponse.ok()) {
      unlockIssuePayload = await issueResponse.json() as { unlockKey?: string };
      issueResolved = true;
      break;
    }
    const status = issueResponse.status();
    const responseDetail = (await issueResponse.text().catch(() => '')).trim();
    const lowerDetail = responseDetail.toLowerCase();
    const isClockSkewRace = status === 401 && (
      lowerDetail.includes('not yet valid')
      || lowerDetail.includes('too early')
      || lowerDetail.includes('token used too early')
      || lowerDetail.includes('invalid auth token')
    );
    if ((isClockSkewRace || status === 401) && attempt < maxUnlockIssueAttempts - 1) {
      await page.waitForTimeout(2_500 + attempt * 1_000);
      continue;
    }
    if (status === 401 || status === 403) {
      test.skip(
        true,
        `Authenticated smoke account lacks admin unlock permission (${status}). `
          + 'Set PLAYWRIGHT_ADMIN_EMAIL/PLAYWRIGHT_ADMIN_PASSWORD to an admin-capable account.'
      );
      return;
    }
    expect(
      issueResponse.ok(),
      `Unexpected unlock issue response: ${status} ${issueResponse.url()} ${responseDetail}`
    ).toBe(true);
  }
  expect(issueResolved).toBe(true);
  const unlockKeyInput = page.getByPlaceholder('Enter unlock key');
  if (String(unlockIssuePayload?.unlockKey || '').trim()) {
    await expect(unlockKeyInput).toHaveValue(String(unlockIssuePayload?.unlockKey || '').trim(), { timeout: 15_000 });
  } else {
    await expect(unlockKeyInput).not.toHaveValue('', { timeout: 15_000 });
  }
  const verifyButton = page.getByRole('button', { name: /^Verify & Unlock$/i }).first();
  await expect(verifyButton).toBeAttached({ timeout: 15_000 });
  const verifyResponsePromise = page.waitForResponse(
    (response) => response.request().method() === 'POST' && response.url().includes('/admin/session-unlock/verify'),
    { timeout: 120_000 }
  );
  await verifyButton.evaluate((node) => {
    if (node instanceof HTMLButtonElement) node.click();
  }).catch(() => undefined);
  const verifyResponse = await verifyResponsePromise;
  const verifyDetail = (await verifyResponse.text().catch(() => '')).trim();
  expect(
    verifyResponse.ok(),
    `Unexpected unlock verify response: ${verifyResponse.status()} ${verifyResponse.url()} ${verifyDetail}`
  ).toBe(true);
  const verifyPayload = JSON.parse(verifyDetail || '{}') as { unlockToken?: string };
  expect(Boolean(String(verifyPayload.unlockToken || '').trim()), 'Unlock verify response missing unlockToken.').toBe(true);
  await expect(page.getByText('Unlocked', { exact: true }).first()).toBeVisible({ timeout: 20_000 });
};

const openAdminMainTab = async (page: Parameters<typeof test>[0]['page'], label: string): Promise<void> => {
  const tablist = page.getByRole('tablist', { name: /^Admin control sections$/i }).first();
  const button = tablist.getByRole('tab', { name: new RegExp(`^${label}$`, 'i') }).first();
  if (await button.isVisible().catch(() => false)) {
    await button.scrollIntoViewIfNeeded().catch(() => undefined);
    try {
      await button.click({ timeout: 10_000 });
    } catch {
      await button.evaluate((node) => {
        if (node instanceof HTMLButtonElement) node.click();
      }).catch(() => undefined);
    }
    await expect(button).toHaveAttribute('aria-selected', 'true', { timeout: 20_000 });
    return;
  }

  const fallbackButton = page.getByRole('tab', { name: new RegExp(`^${label}$`, 'i') }).first();
  await expect(fallbackButton).toBeVisible({ timeout: 15_000 });
  await fallbackButton.evaluate((node) => {
    if (node instanceof HTMLButtonElement) node.click();
  }).catch(() => undefined);
  await expect(fallbackButton).toHaveAttribute('aria-selected', 'true', { timeout: 20_000 });
};

const publishReaderItem = async (
  page: Parameters<typeof test>[0]['page'],
  input: {
    title: string;
    author: string;
    contentType: 'novel' | 'manga';
    fileName: string;
    mimeType: string;
    fileBuffer: Buffer;
  }
): Promise<void> => {
  await openAdminMainTab(page, 'Reader Library');
  const readerLibraryTab = page.getByRole('tab', { name: /^Reader Library$/i }).first();
  const readerLibraryPanel = page.getByRole('tabpanel', { name: /^Reader Library$/i });
  await expect(readerLibraryPanel.getByText('Loading catalog...')).toHaveCount(0, { timeout: 30_000 });
  await expect(readerLibraryPanel.getByRole('button', { name: /^New title$/i })).toBeVisible({ timeout: 15_000 });
  await readerLibraryPanel.getByRole('button', { name: /^New title$/i }).click({ force: true });
  await expect(readerLibraryPanel.getByText('Create Reader Library item')).toBeVisible({ timeout: 15_000 });

  await expect(readerLibraryPanel.getByLabel('Title')).toBeEditable({ timeout: 15_000 });
  await readerLibraryPanel.getByLabel('Title').fill(input.title);
  await readerLibraryPanel.getByLabel('Author').fill(input.author);
  await readerLibraryPanel.getByLabel('Content Type').selectOption(input.contentType);
  await readerLibraryPanel.getByLabel('Rights basis').selectOption('open_license');
  await readerLibraryPanel.getByLabel('Region').fill('english');
  await readerLibraryPanel.getByRole('textbox', { name: /^License$/i }).fill('CC BY 4.0');
  await readerLibraryPanel.getByLabel('Summary').fill(`Playwright smoke item for ${input.contentType}.`);
  await readerLibraryPanel.getByLabel('Collection').fill('Reader Library');

  if (input.contentType === 'manga') {
    await expect(readerLibraryPanel.getByLabel('Direction')).toHaveValue('manga', { timeout: 15_000 });
  }

  await readerLibraryPanel.locator('input[type="file"]').setInputFiles({
    name: input.fileName,
    mimeType: input.mimeType,
    buffer: input.fileBuffer,
  });

  await expect(page.getByRole('button', { name: /^Publish to Reader$/i })).toBeEnabled({ timeout: 15_000 });
  const publishResponsePromise = page.waitForResponse(
    (response) => response.request().method() === 'POST' && response.url().includes('/admin/reader/catalog/items'),
    { timeout: 120_000 }
  );
  await page.getByRole('button', { name: /^Publish to Reader$/i }).click({ force: true });
  const publishResponse = await publishResponsePromise;
  const publishDetail = (await publishResponse.text().catch(() => '')).trim();
  expect(
    publishResponse.ok(),
    `Unexpected reader catalog publish response: ${publishResponse.status()} ${publishResponse.url()} ${publishDetail}`
  ).toBe(true);
  await expect(page.getByRole('button', { name: new RegExp(input.title) }).first()).toBeVisible({ timeout: 180_000 });
};

const verifyReaderOpen = async (
  page: Parameters<typeof test>[0]['page'],
  title: string,
  contentType: 'novel' | 'manga'
): Promise<void> => {
  await openWorkspaceTab(page, 'Reader');
  const readerHome = page.getByTestId('reader-home');
  await expect(readerHome).toBeVisible({ timeout: 30_000 });
  const readerError = page.getByText(/Reader could not load right now|Could not load Reader catalog/i).first();
  if (await readerError.isVisible().catch(() => false)) {
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 120_000 });
    await expect(readerHome).toBeVisible({ timeout: 30_000 });
  }
  const shelfTab = page.getByRole('button', { name: contentType === 'manga' ? /^Library(?:\s+\d+)?$/i : /^Novels(?:\s+\d+)?$/i });
  await shelfTab.click({ force: true });
  await expect(shelfTab).toHaveAttribute('aria-pressed', 'true', { timeout: 15_000 });
  const search = page.getByLabel('Search reader catalog');
  await search.fill(title);
  await expect(page.getByText(title, { exact: true }).first()).toBeVisible({ timeout: 60_000 });
  const openButton = page.getByRole('button', { name: new RegExp(`^Open ${escapeRegExp(title)}$`, 'i') }).first();
  await expect(openButton).toBeVisible({ timeout: 60_000 });
  await openButton.evaluate((node) => {
    if (node instanceof HTMLButtonElement) node.click();
  }).catch(() => undefined);
  const readButton = page.getByRole('button', { name: /^Read$/i }).first();
  await expect(readButton).toBeVisible({ timeout: 30_000 });
  const createSessionResponsePromise = page.waitForResponse(
    (response) => response.request().method() === 'POST' && response.url().includes('/reader/sessions'),
    { timeout: 120_000 }
  );
  await readButton.evaluate((node) => {
    if (node instanceof HTMLButtonElement) node.click();
  }).catch(() => undefined);
  const createSessionResponse = await createSessionResponsePromise;
  const createSessionDetail = (await createSessionResponse.text().catch(() => '')).trim();
  const createSessionRequest = createSessionResponse.request();
  const createSessionHeaders = createSessionRequest.headers();
  const requestIdempotencyKey = String(
    createSessionHeaders['idempotency-key']
    || createSessionHeaders['Idempotency-Key']
    || ''
  ).trim();
  const createSessionBody = String(createSessionRequest.postData() || '').trim();
  expect(
    createSessionResponse.ok(),
    `Unexpected reader session create response: ${createSessionResponse.status()} ${createSessionResponse.url()} ${createSessionDetail}`
      + ` idempotency=${requestIdempotencyKey || 'missing'}`
      + ` payload=${createSessionBody || 'missing'}`
  ).toBe(true);
  await expect(page.getByTestId('reader-playback-stage')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('heading', { name: new RegExp(`^${escapeRegExp(title)}$`, 'i') }).first()).toBeVisible({ timeout: 30_000 });
};

test('admin can publish a novel reader title', async ({ page }) => {
  test.setTimeout(300_000);
  const credentials = resolveStudioSmokeCredentials();
  test.skip(!credentials, 'Set PLAYWRIGHT_ADMIN_EMAIL and PLAYWRIGHT_ADMIN_PASSWORD for authenticated smoke.');
  if (!credentials) return;

  const novelTitle = buildTitle('Playwright Reader Novel');

  await ensureStudioSmokeAuthenticated(page, credentials);
  await page.waitForTimeout(ADMIN_TOKEN_PROPAGATION_DELAY_MS);
  await openWorkspaceTab(page, 'Admin');
  await unlockAdminMutations(page);

  await publishReaderItem(page, {
    title: novelTitle,
    author: 'Playwright Smoke',
    contentType: 'novel',
    fileName: 'reader-novel.txt',
    mimeType: 'text/plain',
    fileBuffer: Buffer.from('Playwright smoke published novel content.'),
  });
  await verifyReaderOpen(page, novelTitle, 'novel');
});

test('admin can publish a manga reader title', async ({ page }) => {
  test.setTimeout(300_000);
  const credentials = resolveStudioSmokeCredentials();
  test.skip(!credentials, 'Set PLAYWRIGHT_ADMIN_EMAIL and PLAYWRIGHT_ADMIN_PASSWORD for authenticated smoke.');
  if (!credentials) return;

  const mangaTitle = buildTitle('Playwright Reader Manga');
  await ensureStudioSmokeAuthenticated(page, credentials);
  await page.waitForTimeout(ADMIN_TOKEN_PROPAGATION_DELAY_MS);
  await openWorkspaceTab(page, 'Admin');
  await unlockAdminMutations(page);
  await openAdminMainTab(page, 'Reader Library');

  await publishReaderItem(page, {
    title: mangaTitle,
    author: 'Playwright Smoke',
    contentType: 'manga',
    fileName: 'reader-manga.pdf',
    mimeType: 'application/pdf',
    fileBuffer: PDF_1_PAGE,
  });

  await verifyReaderOpen(page, mangaTitle, 'manga');
});
