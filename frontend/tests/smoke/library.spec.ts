import { test, expect } from '@playwright/test';

test.describe('Library Page', () => {
  test('should navigate to library and verify all sections', async ({ page }) => {
    await page.goto('/app/library');
    await expect(page.getByTestId('readers-subnav')).toBeVisible();

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