import { expect, test } from '@playwright/test';

const ROUTE_TIMEOUT_MS = 45_000;
const READER_SMOKE_BOOK_ID = '1342';
const READER_SELECTED_BOOK_STORAGE_KEY = `vf-library-selected-book:${READER_SMOKE_BOOK_ID}`;
const READER_SMOKE_BOOK = {
  id: READER_SMOKE_BOOK_ID,
  title: 'Pride and Prejudice',
  authors: [{ name: 'Austen, Jane' }],
  translators: [],
  subjects: ['Courtship -- Fiction'],
  bookshelves: ['Best Books Ever Listings'],
  languages: ['en'],
  copyright: false,
  media_type: 'Text',
  formats: {
    'text/plain; charset=utf-8': 'https://www.gutenberg.org/cache/epub/1342/pg1342.txt',
    'text/plain': 'https://www.gutenberg.org/cache/epub/1342/pg1342.txt',
  },
  download_count: 0,
  source: 'gutenberg',
} as const;

test('studio route entry renders secure handoff messaging', async ({ page }) => {
  await page.goto('/app/studio', {
    waitUntil: 'domcontentloaded',
    timeout: ROUTE_TIMEOUT_MS,
  });

  await Promise.any([
    page.getByRole('heading', { name: /Opening Studio/i }).waitFor({ state: 'visible', timeout: ROUTE_TIMEOUT_MS }),
    page.getByRole('heading', { name: /Sign in to open Studio/i }).waitFor({ state: 'visible', timeout: ROUTE_TIMEOUT_MS }),
    page.getByRole('heading', { name: /Welcome back/i }).waitFor({ state: 'visible', timeout: ROUTE_TIMEOUT_MS }),
  ]);

  await expect(page.locator('body')).toBeVisible();
});

test('public readers library launches', async ({ page }) => {
  await page.goto('/library', {
    waitUntil: 'domcontentloaded',
    timeout: ROUTE_TIMEOUT_MS,
  });

  await expect(
    page.getByRole('heading', {
      name: /Browse books, save favorites, and step into Writer without leaving Readers\./i,
    }),
  ).toBeVisible({ timeout: ROUTE_TIMEOUT_MS });
});

test('reader route loads dock controls and flash runtime details', async ({ page }) => {
  await page.addInitScript(({ storageKey, book }) => {
    window.localStorage.setItem(storageKey, JSON.stringify(book));
  }, {
    storageKey: READER_SELECTED_BOOK_STORAGE_KEY,
    book: READER_SMOKE_BOOK,
  });

  await page.goto(`/app/library/${READER_SMOKE_BOOK_ID}/read?source=gutenberg`, {
    waitUntil: 'domcontentloaded',
    timeout: ROUTE_TIMEOUT_MS,
  });

  await expect(page.getByTestId('reader-root')).toBeVisible({ timeout: ROUTE_TIMEOUT_MS });
  await expect(page.getByTestId('reader-dock')).toBeVisible({ timeout: ROUTE_TIMEOUT_MS });
  await expect(page.getByTestId('reader-compact-transport')).toBeVisible({ timeout: ROUTE_TIMEOUT_MS });

  await page.getByTestId('dock-action-tts').click();
  await expect(page.getByTestId('reader-dock-popup')).toBeVisible({ timeout: ROUTE_TIMEOUT_MS });
  await expect(page.getByTestId('reader-tts-runtime-card')).toBeVisible({ timeout: ROUTE_TIMEOUT_MS });
  await expect(page.getByText(/gemini-2\.5-flash-tts/i)).toBeVisible({ timeout: ROUTE_TIMEOUT_MS });
});
