import { expect, test } from '@playwright/test';

test('boots application shell', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#root')).toBeVisible();
});
