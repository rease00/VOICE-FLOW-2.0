import { expect, test, type Page } from '@playwright/test';
import { ensureStudioSmokeAuthenticated, resolveStudioSmokeCredentials } from './smokeAuth';

const typeIntoControlledInput = async (
  page: Page,
  locator: ReturnType<Page['locator']>,
  value: string,
): Promise<void> => {
  const selectAllShortcut = process.platform === 'darwin' ? 'Meta+A' : 'Control+A';
  const safeValue = String(value || '');
  await locator.click({ force: true });
  await locator.press(selectAllShortcut).catch(() => undefined);
  await locator.press('Delete').catch(() => undefined);
  await locator.press('Backspace').catch(() => undefined);
  await locator.pressSequentially(safeValue, { delay: 18 });
  await page.waitForTimeout(120);
  await expect(locator).toHaveValue(safeValue, { timeout: 10_000 });
};

const gotoNovels = async (page: Page): Promise<void> => {
  await page.goto('/app/novels', { waitUntil: 'domcontentloaded', timeout: 120_000 });
};

const waitForNovelsSurface = async (page: Page): Promise<void> => {
  await Promise.any([
    page.getByTestId('reader-browse-home').waitFor({ state: 'visible', timeout: 45_000 }),
    page.getByTestId('reader-home').waitFor({ state: 'visible', timeout: 45_000 }),
    page.getByTestId('reader-playback-stage').waitFor({ state: 'visible', timeout: 45_000 }),
  ]);
};

const backToHomeIfNeeded = async (page: Page): Promise<void> => {
  const playbackStage = page.getByTestId('reader-playback-stage');
  if (await playbackStage.isVisible().catch(() => false)) {
    const backButton = page.getByRole('button', { name: /^Back To Home$/i }).first();
    if (await backButton.isVisible().catch(() => false)) {
      await backButton.click({ force: true });
    }
  }
  await Promise.any([
    page.getByTestId('reader-browse-home').waitFor({ state: 'visible', timeout: 30_000 }),
    page.getByTestId('reader-home').waitFor({ state: 'visible', timeout: 30_000 }),
  ]);
};

const expandDock = async (page: Page): Promise<void> => {
  const dock = page.getByTestId('reader-sticky-dock').first();
  const expandButton = page.getByLabel('Expand reader dock').first();
  if (await dock.getAttribute('data-reader-dock-mode') === 'full') return;
  await expect(expandButton).toBeVisible({ timeout: 30_000 });
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    await expandButton.click({ force: true });
    await page.waitForTimeout(350);
    if (await dock.getAttribute('data-reader-dock-mode') === 'full') return;
    await expandButton.press('Enter').catch(() => undefined);
    await page.waitForTimeout(250);
    if (await dock.getAttribute('data-reader-dock-mode') === 'full') return;
  }
  await expect(dock).toHaveAttribute('data-reader-dock-mode', 'full', { timeout: 30_000 });
};

const ensureNoHorizontalOverflow = async (page: Page): Promise<void> => {
  const metrics = await page.evaluate(() => ({
    innerWidth: window.innerWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.innerWidth);
};

const closeNovelsSettingsIfOpen = async (page: Page): Promise<void> => {
  const settingsDialog = page.getByRole('dialog', { name: /^Novels settings$/i }).first();
  if (!await settingsDialog.isVisible().catch(() => false)) return;
  const closeButton = settingsDialog.getByRole('button', { name: /^Close settings$/i }).first();
  if (await closeButton.isVisible().catch(() => false)) {
    await closeButton.click({ force: true }).catch(() => undefined);
  }
  if (await settingsDialog.isVisible().catch(() => false)) {
    await page.keyboard.press('Escape').catch(() => undefined);
  }
  if (await settingsDialog.isVisible().catch(() => false)) {
    await page.locator('.vf-reader-v2-modal-backdrop').first().click({ force: true }).catch(() => undefined);
  }
  await expect(settingsDialog).toBeHidden({ timeout: 30_000 });
};

test('novels workspace keeps shelf filters and dock-only settings healthy', async ({ page }) => {
  test.setTimeout(300_000);
  const credentials = resolveStudioSmokeCredentials();
  test.skip(!credentials, 'Set PLAYWRIGHT_ADMIN_EMAIL and PLAYWRIGHT_ADMIN_PASSWORD for authenticated Novels smoke.');
  if (!credentials) return;

  await ensureStudioSmokeAuthenticated(page, credentials);
  await gotoNovels(page);
  await waitForNovelsSurface(page);
  await backToHomeIfNeeded(page);

  await expect(page).toHaveURL(/\/app\/(?:novels|reader)(?:\/|$|\?)/, { timeout: 30_000 });
  await expect(page.getByRole('button', { name: /^Admin Uploads\b/i }).first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('button', { name: /^Your Uploads\b/i }).first()).toBeVisible({ timeout: 30_000 });

  await expandDock(page);
  const openSettingsButton = page.getByLabel('Open settings').first();
  await expect(openSettingsButton).toBeVisible({ timeout: 30_000 });
  await openSettingsButton.click({ force: true });

  const settingsDialog = page.getByRole('dialog', { name: /^Novels settings$/i }).first();
  await expect(settingsDialog).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('.vf-reader-v2-home__settings-surface')).toHaveCount(0);
  await expect(settingsDialog.getByText('Novels Settings')).toBeVisible({ timeout: 30_000 });
  await closeNovelsSettingsIfOpen(page);

  await ensureNoHorizontalOverflow(page);
});

test('desktop novels flow supports import, one-time verification, publish, and unlock', async ({ page }, testInfo) => {
  test.setTimeout(300_000);
  test.skip(testInfo.project.name !== 'chromium-desktop', 'Publish and unlock smoke runs on desktop only.');
  const credentials = resolveStudioSmokeCredentials();
  test.skip(!credentials, 'Set PLAYWRIGHT_ADMIN_EMAIL and PLAYWRIGHT_ADMIN_PASSWORD for authenticated Novels smoke.');
  if (!credentials) return;

  const novelTitle = `Playwright Novel ${Date.now().toString(36)}`;
  const fileName = `${novelTitle.replace(/\s+/g, '_')}.txt`;
  const escapedNovelTitle = novelTitle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const escapedFileName = fileName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const escapedReadableFileName = fileName.replace(/_/g, ' ').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const openTitlePattern = new RegExp(
    `^Open (${escapedNovelTitle}|${escapedFileName}|${escapedReadableFileName})$`,
    'i',
  );

  await ensureStudioSmokeAuthenticated(page, credentials);
  await gotoNovels(page);
  await waitForNovelsSurface(page);
  await backToHomeIfNeeded(page);
  await closeNovelsSettingsIfOpen(page);
  await expandDock(page);

  const importButton = page.getByLabel('Import content').first();
  await expect(importButton).toBeVisible({ timeout: 30_000 });
  await importButton.click({ force: true });

  const importTermsDialog = page.getByRole('dialog', { name: /^Reader import terms$/i }).first();
  if (await importTermsDialog.isVisible().catch(() => false)) {
    await importTermsDialog.getByRole('button', { name: /^Accept & Continue$/i }).click({ force: true });
    await expect(importTermsDialog).toBeHidden({ timeout: 30_000 });
  }

  const importInput = page.locator('.vf-reader-v2-dock__import-input').first();
  await importInput.setInputFiles({
    name: fileName,
    mimeType: 'text/plain',
    buffer: Buffer.from(`${novelTitle}\n\nChapter 1\nA short smoke novel for publish and unlock verification.`),
  });

  await expect(page.getByTestId('reader-playback-stage')).toBeVisible({ timeout: 60_000 });
  await backToHomeIfNeeded(page);

  const yourUploadsButton = page.getByRole('button', { name: /^Your Uploads\b/i }).first();
  await yourUploadsButton.click({ force: true });
  await expect(yourUploadsButton).toHaveAttribute('aria-pressed', 'true', { timeout: 30_000 });

  const search = page.getByLabel('Search reader catalog').first();
  await typeIntoControlledInput(page, search, novelTitle);
  const openButton = page.getByRole('button', { name: openTitlePattern }).first();
  await expect(openButton).toBeVisible({ timeout: 60_000 });
  await openButton.click({ force: true });

  const previewDialog = page.getByRole('dialog', { name: openTitlePattern }).first();
  await expect(previewDialog).toBeVisible({ timeout: 30_000 });

  const verifyButton = previewDialog.getByRole('button', { name: /^(Verify Creator|Verified)$/i }).first();
  await expect(verifyButton).toBeVisible({ timeout: 30_000 });
  if ((await verifyButton.textContent())?.trim()?.toLowerCase() !== 'verified') {
    await verifyButton.click({ force: true });
  }
  await expect(previewDialog.getByRole('button', { name: /^Verified$/i }).first()).toBeVisible({ timeout: 30_000 });

  await previewDialog.getByLabel('Full Novel Unlock (VF)').fill('12');
  await previewDialog.getByLabel('Default Chapter Unlock (VF)').fill('4');
  await previewDialog.getByRole('button', { name: /^Save Setup$/i }).click({ force: true });
  await previewDialog.getByRole('button', { name: /^Publish Novel$/i }).click({ force: true });
  await expect(previewDialog).toContainText(/Unlock Status/i, { timeout: 30_000 });
  await expect(previewDialog).not.toContainText(/Publish Setup/i, { timeout: 30_000 });
  await previewDialog.getByRole('button', { name: /^Back$/i }).click({ force: true });
  await expect(previewDialog).toBeHidden({ timeout: 30_000 });

  const adminUploadsButton = page.getByRole('button', { name: /^Admin Uploads\b/i }).first();
  await adminUploadsButton.click({ force: true });
  await expect(adminUploadsButton).toHaveAttribute('aria-pressed', 'true', { timeout: 30_000 });
  await typeIntoControlledInput(page, search, '');
  await typeIntoControlledInput(page, search, novelTitle);
  const publishedOpenButton = page.getByRole('button', { name: openTitlePattern }).first();
  await expect(publishedOpenButton).toBeVisible({ timeout: 60_000 });
  await publishedOpenButton.click({ force: true });

  const publishedDialog = page.getByRole('dialog', { name: openTitlePattern }).first();
  await expect(publishedDialog).toBeVisible({ timeout: 30_000 });
  const unlockNovelButton = publishedDialog.getByRole('button', { name: /^(Unlock Novel|Unlocked)$/i }).first();
  await expect(unlockNovelButton).toBeVisible({ timeout: 30_000 });
  if ((await unlockNovelButton.textContent())?.trim()?.toLowerCase() !== 'unlocked') {
    await unlockNovelButton.click({ force: true });
  }
  await expect(publishedDialog.getByRole('button', { name: /^Unlocked$/i }).first()).toBeVisible({ timeout: 30_000 });
  await publishedDialog.getByRole('button', { name: /^Read$/i }).click({ force: true });
  await expect(page.getByTestId('reader-playback-stage')).toBeVisible({ timeout: 60_000 });
});
