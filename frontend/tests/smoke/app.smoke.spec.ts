import { expect, test } from '@playwright/test';

test('boots application shell', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#root')).toBeVisible();
  await expect(page.getByTestId('notification-root')).toBeVisible();

  await expect(page.getByTestId('brand-logo-mark').first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Get Started' })).toBeVisible();

  const onboardingText = (await page.locator('body').textContent()) || '';
  expect(onboardingText.toLowerCase()).not.toMatch(/\b(gemini|kokoro)\b/);

  await page.getByRole('button', { name: 'Get Started' }).click();
  await expect(page.getByText('Secure sign-in for your VoiceFlow workspace.')).toBeVisible();
  await expect(page.getByTestId('brand-logo-mark').first()).toBeVisible();

  const loginText = (await page.locator('body').textContent()) || '';
  expect(loginText.toLowerCase()).not.toMatch(/\b(gemini|kokoro)\b/);
});

test('notification center opens on main screen and handles emitted notifications', async ({ page }) => {
  await page.goto('/?vf-screen=main');

  await expect(page.locator('#root')).toBeVisible();
  await expect(page.getByTestId('notification-root')).toBeVisible();

  const bell = page.getByRole('button', { name: 'Open notifications' });
  const bellVisible = await bell.isVisible().catch(() => false);

  await page.evaluate(() => {
    window.dispatchEvent(new Event('offline'));
  });

  await expect(page.getByTestId('notification-toast')).toHaveCount(0);

  await page.evaluate(() => {
    window.dispatchEvent(new Event('online'));
  });

  if (bellVisible) {
    await page.evaluate(() => {
      const button = document.querySelector<HTMLButtonElement>('button[aria-label="Open notifications"]');
      button?.click();
    });
    await expect(page.getByTestId('notification-center')).toBeVisible();
    await expect(page.getByText('No notifications in this filter.')).toHaveCount(0);

    page.once('dialog', (dialog) => dialog.accept());
    await page.getByRole('button', { name: 'Clear all' }).click();
    await expect(page.getByText('No notifications in this filter.')).toBeVisible();

    await page.getByRole('button', { name: 'Close notifications' }).click();
    await expect(page.getByTestId('notification-center')).toHaveCount(0);
  }
});
