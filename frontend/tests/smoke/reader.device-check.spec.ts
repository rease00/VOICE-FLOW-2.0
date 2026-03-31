import { expect, test } from '@playwright/test';
import { ensureStudioSmokeAuthenticated, resolveStudioSmokeCredentials } from './smokeAuth';
import type { ReaderLibrary } from '../../types';

type StudioSmokeCredentials = NonNullable<ReturnType<typeof resolveStudioSmokeCredentials>>;

const buildReaderSmokeLibrary = (): ReaderLibrary => ({
  surface: 'all',
  regionId: 'english',
  regions: [
    {
      id: 'english',
      label: 'English',
      locale: 'en',
      languageCodes: ['en'],
      sharedCount: 0,
      emptyState: '',
    },
  ],
  items: [],
  activeSession: null,
  activeSessions: [],
  counts: {
    all: 0,
    visible: 0,
    books: 0,
    comics: 0,
    uploads: 0,
    resumable: 0,
  },
  facets: {
    providers: [],
    collections: [],
    progressStates: [],
  },
  shelves: {
    continueReading: [],
    trending: [],
    newArrivals: [],
    recentlyImported: [],
  },
});

test('Reader dock stays within the viewport', async ({ page }) => {
  test.setTimeout(300_000);
  const credentials = resolveStudioSmokeCredentials();
  test.skip(!credentials, 'Set PLAYWRIGHT_ADMIN_EMAIL and PLAYWRIGHT_ADMIN_PASSWORD for Reader smoke.');
  if (!credentials) return;

  await page.setViewportSize({ width: 390, height: 844 });
  await ensureStudioSmokeAuthenticated(page, credentials);
  const readerLibrary = buildReaderSmokeLibrary();
  await page.route('**/reader/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const pathname = url.pathname;
    const method = request.method().toUpperCase();

    if (pathname.endsWith('/reader/preferences')) {
      if (method === 'GET') {
        await route.fulfill({
          status: 200,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            ok: true,
            preferences: { uid: 'reader-smoke', homeTab: 'novels', updatedAt: new Date().toISOString() },
          }),
        });
        return;
      }
      if (method === 'PATCH') {
        await route.fulfill({
          status: 200,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            ok: true,
            preferences: { uid: 'reader-smoke', homeTab: 'novels', updatedAt: new Date().toISOString() },
          }),
        });
        return;
      }
    }

    if (pathname.endsWith('/reader/legal/ack')) {
      await route.fulfill({
        status: 200,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          ok: true,
          ack: {
            accepted: true,
            acceptedAt: new Date().toISOString(),
            title: 'Reader Rights Notice',
            message: 'Smoke harness acknowledgement.',
          },
          billing: { vfPerChar: 1.0, rule: '1 char = 1 VF', label: '1 char = 1 VF' },
          commercial: {
            enabled: true,
            commercialPolicyVersion: 'smoke',
            policyVersion: 'smoke',
            blockedProviders: [],
            ownershipBasisOptions: [],
          },
        }),
      });
      return;
    }

    if (pathname.endsWith('/reader/dashboard') && method === 'GET') {
      await route.fulfill({
        status: 200,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ok: true, dashboard: readerLibrary }),
      });
      return;
    }

    if (pathname.endsWith('/reader/library') && method === 'GET') {
      await route.fulfill({
        status: 200,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ok: true, library: readerLibrary }),
      });
      return;
    }

    await route.continue();
  });

  await page.goto('/reader', { waitUntil: 'domcontentloaded', timeout: 120_000 });
  await page.waitForTimeout(2000);

  const dock = page.locator('.vf-reader-v2-dock');
  const importInput = page.locator('.vf-reader-v2-dock__import-input');
  const expandButton = page.getByLabel('Expand reader dock');

  await expect(dock).toBeVisible({ timeout: 30_000 });
  await expect(importInput).toBeHidden({ timeout: 30_000 });
  await expect(expandButton).toBeVisible({ timeout: 30_000 });

  const viewport = await page.evaluate(() => ({
    innerWidth: window.innerWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(viewport.scrollWidth).toBeLessThanOrEqual(viewport.innerWidth);

  const dockBox = await dock.boundingBox();
  expect(dockBox).not.toBeNull();
  if (dockBox) {
    expect(Math.ceil(dockBox.x + dockBox.width)).toBeLessThanOrEqual(viewport.innerWidth + 1);
  }

  const expandBox = await expandButton.boundingBox();
  if (expandBox) {
    expect(Math.ceil(expandBox.x + expandBox.width)).toBeLessThanOrEqual(viewport.innerWidth + 1);
  }
});
