import { expect, test, type Page } from '@playwright/test';
import { ensureStudioSmokeAuthenticated, resolveStudioSmokeCredentials } from './smokeAuth';
import type { ReaderCatalogItem, ReaderLibrary } from '../../types';

type StudioSmokeCredentials = NonNullable<ReturnType<typeof resolveStudioSmokeCredentials>>;
type ReaderSmokeHomeTab = 'novels' | 'library' | 'imported';

const gotoWithRetry = async (page: Page, url: string): Promise<void> => {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120_000 });
      return;
    } catch (error) {
      const message = String((error as Error)?.message || error || '');
      const aborted = /ERR_ABORTED/i.test(message);
      if (!aborted || attempt === 3) throw error;
      await page.waitForTimeout(400);
    }
  }
};

const waitForReaderSurface = async (page: Page): Promise<void> => {
  await Promise.any([
    page.getByTestId('reader-browse-home').waitFor({ state: 'visible', timeout: 30_000 }),
    page.getByTestId('reader-home').waitFor({ state: 'visible', timeout: 30_000 }),
    page.locator('.vf-reader-v2-shell').first().waitFor({ state: 'visible', timeout: 30_000 }),
  ]);
};

const normalizeReaderPathname = (pathname: string): string => {
  const safePath = String(pathname || '').trim().replace(/\/+$/, '') || '/';
  if (safePath === '/reader' || safePath.startsWith('/reader/')) {
    return safePath.replace(/^\/reader/, '/app/reader');
  }
  return safePath;
};

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

const makeReaderCatalogItem = (
  index: number,
  overrides: Partial<ReaderCatalogItem> = {}
): ReaderCatalogItem => ({
  id: `reader-item-${index}`,
  title: `Reader Title ${index}`,
  author: `Author ${index}`,
  regionId: 'english',
  contentKind: 'book',
  surface: 'books',
  provider: 'catalog',
  license: 'public-domain',
  summary: `Reader shelf item ${index}.`,
  coverUrl: '',
  ...overrides,
});

const buildReaderShelfShowcaseLibrary = (): ReaderLibrary => {
  const trendingTitles = Array.from({ length: 18 }, (_, index) =>
    makeReaderCatalogItem(index + 1, {
      ...(index < 6
        ? {
            resume: {
              hasProgress: true,
              consumedChars: 180 + index,
              currentPanelIndex: 0,
              progressPct: 35 + index,
            },
          }
        : {}),
    })
  );
  const importedTitles = Array.from({ length: 6 }, (_, index) =>
    makeReaderCatalogItem(100 + index, {
      id: `imported-item-${index + 1}`,
      title: `Imported Title ${index + 1}`,
      author: `Uploader ${index + 1}`,
      surface: 'uploads',
      provider: 'voiceflow_upload',
      license: 'user_responsible',
    })
  );
  const items = [...trendingTitles, ...importedTitles];

  return {
    surface: 'all',
    regionId: 'english',
    regions: [
      {
        id: 'english',
        label: 'English',
        locale: 'en',
        languageCodes: ['en'],
        sharedCount: items.length,
        emptyState: '',
      },
    ],
    items,
    activeSession: null,
    activeSessions: [],
    counts: {
      all: items.length,
      visible: items.length,
      books: trendingTitles.length,
      comics: 0,
      uploads: importedTitles.length,
      resumable: 6,
    },
    facets: {
      providers: [],
      collections: [],
      progressStates: [],
    },
    shelves: {
      continueReading: trendingTitles.slice(0, 6),
      trending: trendingTitles,
      newArrivals: [...trendingTitles.slice(2), ...importedTitles.slice(0, 2)],
      recentlyImported: importedTitles,
    },
  };
};

const installReaderSmokeRouteStubs = async (
  page: Page,
  readerLibrary: ReaderLibrary,
  homeTab: ReaderSmokeHomeTab = 'novels'
): Promise<void> => {
  await page.route('**/reader/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const pathname = url.pathname;
    const method = request.method().toUpperCase();

    if (pathname.endsWith('/reader/preferences')) {
      if (method === 'GET' || method === 'PATCH') {
        await route.fulfill({
          status: 200,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            ok: true,
            preferences: { uid: 'reader-smoke', homeTab, updatedAt: new Date().toISOString() },
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
};

const getReaderFilterRowMetrics = async (page: Page): Promise<{
  rowCount: number;
  rowTops: number[];
  labels: string[];
}> => page.evaluate(() => {
  const filterGroup = document.querySelector('.vf-reader-v2-home__chips');
  if (!(filterGroup instanceof HTMLElement)) {
    return { rowCount: -1, rowTops: [], labels: [] };
  }

  const buttons = Array.from(filterGroup.querySelectorAll('button')).map((button) => ({
    label: (button.textContent || '').replace(/\s+/g, ' ').trim(),
    top: Math.round(button.getBoundingClientRect().top),
  }));
  const rowTops = Array.from(new Set(buttons.map((button) => button.top))).sort((left, right) => left - right);

  return {
    rowCount: rowTops.length,
    rowTops,
    labels: buttons.map((button) => button.label),
  };
});

const getReaderShelfRailMetrics = async (page: Page): Promise<{
  rowCount: number;
  totalCards: number;
  visibleCards: number;
}> => page.evaluate(() => {
  const shelfGrid = document.querySelector('.vf-reader-v2-home__shelf-grid');
  if (!(shelfGrid instanceof HTMLElement)) {
    return { rowCount: -1, totalCards: 0, visibleCards: 0 };
  }

  const shelfRect = shelfGrid.getBoundingClientRect();
  const cards = Array.from(shelfGrid.querySelectorAll('.vf-reader-v2-home__card')).map((card) => card.getBoundingClientRect());
  const rowTops = Array.from(new Set(cards.map((card) => Math.round(card.top)))).sort((left, right) => left - right);
  const visibleCards = cards.filter((card) => (
    Math.round(card.left) >= Math.floor(shelfRect.left) - 1
    && Math.round(card.right) <= Math.ceil(shelfRect.right) + 1
  )).length;

  return {
    rowCount: rowTops.length,
    totalCards: cards.length,
    visibleCards,
  };
});

test('Reader dock stays within the viewport', async ({ page }) => {
  test.setTimeout(300_000);
  const credentials = resolveStudioSmokeCredentials();
  test.skip(!credentials, 'Set PLAYWRIGHT_ADMIN_EMAIL and PLAYWRIGHT_ADMIN_PASSWORD for Reader smoke.');
  if (!credentials) return;

  await ensureStudioSmokeAuthenticated(page, credentials);
  const readerLibrary = buildReaderSmokeLibrary();
  await installReaderSmokeRouteStubs(page, readerLibrary);

  await gotoWithRetry(page, '/app/reader');
  await waitForReaderSurface(page);
  await page.waitForTimeout(2000);

  const dock = page.getByTestId('reader-sticky-dock').first();
  const importInput = page.locator('.vf-reader-v2-dock__import-input');
  const expandButton = page.getByLabel('Expand reader dock');
  const collapseButton = page.getByLabel('Collapse dock to compact circle');

  await expect(dock).toBeVisible({ timeout: 30_000 });
  const dockClassAnchor = page.locator('.vf-reader-v2-dock').first();
  if (await dockClassAnchor.isVisible().catch(() => false)) {
    await expect(dockClassAnchor).toBeVisible({ timeout: 30_000 });
  }
  await expect(importInput).toBeHidden({ timeout: 30_000 });
  const hasExpandButton = await expandButton.isVisible().catch(() => false);
  const viewportAnchorButton = hasExpandButton ? expandButton : collapseButton;
  await expect(viewportAnchorButton).toBeVisible({ timeout: 30_000 });

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

  const buttonBox = await viewportAnchorButton.boundingBox();
  if (buttonBox) {
    expect(Math.ceil(buttonBox.x + buttonBox.width)).toBeLessThanOrEqual(viewport.innerWidth + 1);
  }
});

test('Reader home filters stay in one row across major viewport sizes', async ({ page }) => {
  test.setTimeout(300_000);
  const credentials = resolveStudioSmokeCredentials();
  test.skip(!credentials, 'Set PLAYWRIGHT_ADMIN_EMAIL and PLAYWRIGHT_ADMIN_PASSWORD for Reader smoke.');
  if (!credentials) return;

  await ensureStudioSmokeAuthenticated(page, credentials);
  const readerLibrary = buildReaderSmokeLibrary();
  await installReaderSmokeRouteStubs(page, readerLibrary);

  const viewportMatrix = [
    { name: 'desktop', width: 1440, height: 900 },
    { name: 'tablet', width: 834, height: 1194 },
    { name: 'mobile', width: 390, height: 844 },
  ];

  for (const viewport of viewportMatrix) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await gotoWithRetry(page, '/app/reader');
    await waitForReaderSurface(page);
    await expect(page.locator('.vf-reader-v2-home__chips').first()).toBeVisible({ timeout: 30_000 });

    const rowMetrics = await getReaderFilterRowMetrics(page);
    expect(
      rowMetrics.rowCount,
      `${viewport.name} should keep the reader home filters on one row. Labels: ${rowMetrics.labels.join(', ')}`
    ).toBe(1);

    const viewportMetrics = await page.evaluate(() => ({
      innerWidth: window.innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
    }));
    expect(
      viewportMetrics.scrollWidth,
      `${viewport.name} should not introduce horizontal overflow`
    ).toBeLessThanOrEqual(viewportMetrics.innerWidth);
  }
});

test('Reader home shelves stay store-like across major viewport sizes', async ({ page }) => {
  test.setTimeout(300_000);
  const credentials = resolveStudioSmokeCredentials();
  test.skip(!credentials, 'Set PLAYWRIGHT_ADMIN_EMAIL and PLAYWRIGHT_ADMIN_PASSWORD for Reader smoke.');
  if (!credentials) return;

  await ensureStudioSmokeAuthenticated(page, credentials);
  await installReaderSmokeRouteStubs(page, buildReaderShelfShowcaseLibrary(), 'novels');

  const viewportMatrix = [
    { name: 'desktop', width: 1440, height: 900, expectedVisibleCards: 8, expectedRenderedCards: 15 },
    { name: 'tablet', width: 834, height: 1194, expectedVisibleCards: 6, expectedRenderedCards: 12 },
    { name: 'mobile', width: 390, height: 844, expectedVisibleCards: 4, expectedRenderedCards: 10 },
  ];

  for (const viewport of viewportMatrix) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await gotoWithRetry(page, '/app/reader');
    await waitForReaderSurface(page);

    await expect(page.getByText('Continue Reading', { exact: true })).toHaveCount(0);
    await expect(page.locator('.vf-reader-v2-home__shelf-grid').first()).toBeVisible({ timeout: 30_000 });

    const railMetrics = await getReaderShelfRailMetrics(page);
    expect(
      railMetrics.rowCount,
      `${viewport.name} should keep the shelf as a single horizontal rail`
    ).toBe(1);
    expect(
      railMetrics.totalCards,
      `${viewport.name} should render the viewport shelf limit`
    ).toBe(viewport.expectedRenderedCards);
    expect(
      railMetrics.visibleCards,
      `${viewport.name} should show the requested compact card density`
    ).toBeGreaterThanOrEqual(viewport.expectedVisibleCards);
  }

  await page.setViewportSize({ width: 1440, height: 900 });
  await gotoWithRetry(page, '/app/reader');
  await waitForReaderSurface(page);
  await page.getByRole('button', { name: /Library/i }).first().click();
  await expect(page.getByText('Continue Reading', { exact: true })).toBeVisible({ timeout: 30_000 });
});

test('Reader alias route matches canonical workspace shell', async ({ page }) => {
  test.setTimeout(300_000);
  const credentials = resolveStudioSmokeCredentials();
  test.skip(!credentials, 'Set PLAYWRIGHT_ADMIN_EMAIL and PLAYWRIGHT_ADMIN_PASSWORD for Reader smoke.');
  if (!credentials) return;

  await ensureStudioSmokeAuthenticated(page, credentials);
  await installReaderSmokeRouteStubs(page, buildReaderSmokeLibrary());

  await gotoWithRetry(page, '/app/reader');
  await waitForReaderSurface(page);
  const canonicalPath = new URL(page.url()).pathname;
  expect(normalizeReaderPathname(canonicalPath)).toMatch(/^\/app\/reader(?:\/|$)/);

  await gotoWithRetry(page, '/reader');
  await waitForReaderSurface(page);

  const aliasPath = new URL(page.url()).pathname;
  expect(normalizeReaderPathname(aliasPath)).toBe(normalizeReaderPathname(canonicalPath));
  await expect(page.getByTestId('reader-sticky-dock').first()).toBeVisible({ timeout: 30_000 });
});
