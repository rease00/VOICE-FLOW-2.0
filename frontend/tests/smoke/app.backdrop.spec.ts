import { expect, test, type Page } from '@playwright/test';
import { STORAGE_KEYS } from '../../src/shared/storage/keys';

const ROUTE_TIMEOUT_MS = 20_000;

type StoredBackdropPreferences = {
  theme: 'light' | 'dark' | 'system';
  brandTheme: 'neon' | 'aurora' | 'sunset' | 'emerald';
  motion: 'off' | 'balanced' | 'rich';
};

const seedBackdropPreferences = async (page: Page, preferences: StoredBackdropPreferences): Promise<void> => {
  await page.addInitScript(({ storageKeys, storedPreferences }) => {
    localStorage.setItem(storageKeys.uiTheme, storedPreferences.theme);
    localStorage.setItem(storageKeys.uiBrandTheme, storedPreferences.brandTheme);
    localStorage.setItem(storageKeys.uiMotionLevel, storedPreferences.motion);
  }, {
    storageKeys: {
      uiTheme: STORAGE_KEYS.uiTheme,
      uiBrandTheme: STORAGE_KEYS.uiBrandTheme,
      uiMotionLevel: STORAGE_KEYS.uiMotionLevel,
    },
    storedPreferences: preferences,
  });
};

const expectBackdropAnimation = async (page: Page, expected: 'running' | 'stopped'): Promise<void> => {
  const state = await page.locator('.vf-live-wallpaper').evaluate((element) => {
    const before = getComputedStyle(element, '::before');
    const after = getComputedStyle(element, '::after');
    return {
      beforeAnimation: before.animationName,
      afterAnimation: after.animationName,
    };
  });

  if (expected === 'running') {
    expect(state.beforeAnimation).toBe('wallpaper-pan');
    expect(state.afterAnimation).toBe('aura-float');
    return;
  }

  expect(state.beforeAnimation).toBe('none');
  expect(state.afterAnimation).toBe('none');
};

const expectBackdropState = async (page: Page, preferences: StoredBackdropPreferences, expectedAnimation: 'running' | 'stopped'): Promise<void> => {
  const resolvedTheme = preferences.theme === 'system'
    ? 'dark'
    : preferences.theme;

  await expect(page.locator('.vf-live-wallpaper')).toHaveCount(1);
  await expect(page.locator('.vf-live-wallpaper')).toBeVisible();
  await expect(page.locator('body')).toHaveAttribute('data-vf-theme-mode', preferences.theme);
  await expect(page.locator('body')).toHaveAttribute('data-vf-resolved-theme', resolvedTheme);
  await expect(page.locator('body')).toHaveAttribute('data-vf-brand-theme', preferences.brandTheme);
  await expect(page.locator('body')).toHaveAttribute('data-motion', preferences.motion);
  await expectBackdropAnimation(page, expectedAnimation);
};

test('workspace backdrop animates with stored theme state', async ({ page }) => {
  await seedBackdropPreferences(page, {
    theme: 'light',
    brandTheme: 'aurora',
    motion: 'rich',
  });

  await page.goto('/app', { waitUntil: 'domcontentloaded', timeout: ROUTE_TIMEOUT_MS });
  await Promise.any([
    page.getByText('Opening Studio', { exact: true }).waitFor({ state: 'visible', timeout: ROUTE_TIMEOUT_MS }),
    page.getByText('Restoring your workspace', { exact: true }).waitFor({ state: 'visible', timeout: ROUTE_TIMEOUT_MS }),
    page.getByText('Workspace handoff', { exact: true }).waitFor({ state: 'visible', timeout: ROUTE_TIMEOUT_MS }),
  ]);

  await expectBackdropState(page, {
    theme: 'light',
    brandTheme: 'aurora',
    motion: 'rich',
  }, 'running');
});

test('login backdrop respects motion-off storage', async ({ page }) => {
  await seedBackdropPreferences(page, {
    theme: 'dark',
    brandTheme: 'sunset',
    motion: 'off',
  });

  await page.goto('/app/login', { waitUntil: 'domcontentloaded', timeout: ROUTE_TIMEOUT_MS });
  await expect(page.getByRole('heading', { name: /Welcome back/i })).toBeVisible({ timeout: ROUTE_TIMEOUT_MS });

  await expectBackdropState(page, {
    theme: 'dark',
    brandTheme: 'sunset',
    motion: 'off',
  }, 'stopped');
});

test('login backdrop disables animation when the OS requests reduced motion', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await seedBackdropPreferences(page, {
    theme: 'light',
    brandTheme: 'emerald',
    motion: 'rich',
  });

  await page.goto('/app/login', { waitUntil: 'domcontentloaded', timeout: ROUTE_TIMEOUT_MS });
  await expect(page.getByRole('heading', { name: /Welcome back/i })).toBeVisible({ timeout: ROUTE_TIMEOUT_MS });

  await expectBackdropState(page, {
    theme: 'light',
    brandTheme: 'emerald',
    motion: 'rich',
  }, 'stopped');
});
