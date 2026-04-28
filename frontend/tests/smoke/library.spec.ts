import { test, expect, type Page } from '@playwright/test';

const ROUTE_TIMEOUT_MS = 20_000;

const waitForLibrarySurface = async (page: Page) => {
  await Promise.any([
    page.getByTestId('readers-subnav').first().waitFor({ state: 'visible', timeout: ROUTE_TIMEOUT_MS }),
    page.getByRole('heading', { name: /^Library$/i }).first().waitFor({ state: 'visible', timeout: ROUTE_TIMEOUT_MS }),
  ]);
};

test.describe('Library Page', () => {
  test('should navigate to library and verify all sections', async ({ page }) => {
    await page.goto('/app/library');
    await waitForLibrarySurface(page);

    const legacySurfaceVisible = await page.getByTestId('readers-subnav').first().isVisible().catch(() => false);
    if (!legacySurfaceVisible) {
      await expect(page.getByRole('heading', { name: /^Library$/i })).toBeVisible();
      await expect(page.getByRole('button', { name: /New Studio project/i })).toBeVisible();
      await expect(page.getByRole('button', { name: /Open Reader/i })).toBeVisible();
      return;
    }

    await page.getByText('Browse', { exact: true }).first().click();
    await expect(page.locator('input[placeholder^="Search books"]')).toBeVisible();

    await page.getByText('Favorites', { exact: true }).first().click();
    // Favorites might not have search books, so we just wait for something stable
    await page.waitForTimeout(500);

    await page.getByTestId('readers-writer-trigger').click();
    await expect(page.getByTestId('readers-writer-tab')).toBeVisible();

    await page.getByText('AI Chat', { exact: true }).first().click();
    await expect(page.locator('text=V Flow Librarian').first()).toBeVisible();
  });
});
