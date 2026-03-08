import { expect, test } from '@playwright/test';

const WAV_BASE64 = 'UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=';

const buildReaderItem = (overrides: Record<string, unknown> = {}) => ({
  id: 'item-1',
  title: 'Orbit Reader',
  author: 'VoiceFlow',
  regionId: 'english',
  regionLabel: 'English',
  sourceLanguage: 'en',
  contentKind: 'book',
  surface: 'books',
  provider: 'internet_archive',
  license: 'Public domain',
  summary: 'A premium Reader shelf fixture.',
  supportsReadHere: true,
  collectionLabel: 'Trending',
  readingModeDefault: 'document',
  resume: { hasProgress: true, consumedChars: 120, currentPanelIndex: 0, progressPct: 32 },
  readiness: { state: 'ready', label: 'Ready', playableItems: 2 },
  stats: { totalChars: 4200 },
  ...overrides,
});

const buildReaderSession = (overrides: Record<string, unknown> = {}) => ({
  id: 'session-1',
  title: 'Orbit Reader',
  contentKind: 'book',
  surface: 'books',
  regionId: 'english',
  direction: 'ltr',
  readingMode: 'document',
  sourceLanguage: 'en',
  targetLanguage: 'es',
  pageViewMode: 'translated',
  ttsLanguageMode: 'target',
  multiSpeakerEnabled: true,
  effectiveMultiSpeakerMode: 'studio_pair_groups',
  translationState: 'ready',
  workKey: 'catalog:item-1',
  sourceKind: 'catalog',
  musicTrackId: 'm_none',
  castMemory: {},
  consumedChars: 200,
  totalChars: 4200,
  currentPanelIndex: 0,
  totalPanels: 0,
  progressPct: 32,
  readiness: { state: 'ready', label: 'Ready', playableItems: 2 },
  cachedChars: 200,
  cacheLimitChars: 4200,
  deleteAtMs: Date.now() + 180000,
  warningActive: false,
  savepointDownloadUrl: '',
  billing: {
    vfPerChar: 1.5,
    rule: '1 char = 1.5 VF',
    label: 'Reader pricing: 1 char = 1.5 VF',
  },
  limits: {
    textWindowChars: 1000,
    prefetchThresholdChars: 500,
    panelBatchSize: 10,
    panelTriggerIndex: 5,
    deleteWarningMs: 180000,
  },
  windows: [
    {
      index: 0,
      startChar: 0,
      endChar: 300,
      charCount: 300,
      displayText: 'Opening narration window',
      translationStatus: 'ready',
      estimatedReadMs: 7000,
      jobId: 'job-ready',
      job: { jobId: 'job-ready', status: 'completed', playableChunks: 1, playableDurationMs: 7000 },
    },
    {
      index: 1,
      startChar: 301,
      endChar: 600,
      charCount: 300,
      displayText: 'Queued narration window',
      translationStatus: 'pending',
      estimatedReadMs: 8000,
      jobId: 'job-queued',
      job: { jobId: 'job-queued', status: 'queued', playableChunks: 0, playableDurationMs: 0 },
    },
  ],
  panels: [],
  ...overrides,
});

const buildReaderLibrary = (overrides: Record<string, unknown> = {}) => {
  const item = buildReaderItem();
  return {
    surface: 'all',
    regionId: 'english',
    regions: [
      { id: 'english', label: 'English' },
      { id: 'global', label: 'Global' },
    ],
    items: [item],
    activeSession: null,
    activeSessions: [],
    counts: {
      all: 1,
      visible: 1,
      books: 1,
      comics: 0,
      uploads: 0,
      resumable: 1,
    },
    facets: {
      providers: ['internet_archive'],
      collections: ['Trending'],
      progressStates: ['in_progress', 'ready'],
    },
    shelves: {
      continueReading: [item],
      trending: [item],
      newArrivals: [item],
      recentlyImported: [],
    },
    ...overrides,
  };
};

async function setTheme(page: Parameters<typeof test>[0]['page'], theme: 'light' | 'dark') {
  await page.addInitScript((value) => {
    window.localStorage.setItem('vf_ui_theme', value);
  }, theme);
}

async function stubReaderApi(page: Parameters<typeof test>[0]['page'], options?: { activeSession?: boolean }) {
  const session = buildReaderSession();
  const library = buildReaderLibrary(
    options?.activeSession
      ? {
          activeSession: session,
          activeSessions: [session],
        }
      : {}
  );

  await page.addInitScript(
    ({ fixtureLibrary, fixtureSession, wavBase64 }) => {
      const originalFetch = window.fetch.bind(window);
      window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
        const rawUrl =
          typeof input === 'string'
            ? input
            : input instanceof URL
              ? input.toString()
              : input instanceof Request
                ? input.url
                : String((input as { url?: string })?.url || '');

        if (rawUrl.includes('/reader/legal/ack')) {
          const isPost = String(init?.method || (input instanceof Request ? input.method : 'GET')).toUpperCase() === 'POST';
          const body = isPost
            ? {
                ack: {
                  accepted: true,
                  acceptedAt: new Date().toISOString(),
                  title: 'Reader rights',
                  message: 'Upload only content you have the right to use.',
                },
              }
            : {
                ack: {
                  accepted: true,
                  acceptedAt: new Date().toISOString(),
                  title: 'Reader rights',
                  message: 'Upload only content you have the right to use.',
                },
                billing: {
                  vfPerChar: 1.5,
                  rule: '1 char = 1.5 VF',
                  label: 'Reader pricing: 1 char = 1.5 VF',
                },
              };
          return new Response(JSON.stringify(body), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }

        if (rawUrl.includes('/reader/library')) {
          return new Response(JSON.stringify({ library: fixtureLibrary }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }

        if (rawUrl.includes('/reader/sessions/session-1')) {
          return new Response(JSON.stringify({ session: fixtureSession }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }

        if (rawUrl.includes('/tts/jobs/')) {
          return new Response(
            JSON.stringify({
              status: 'completed',
              result: {
                audioBase64: wavBase64,
                mediaType: 'audio/wav',
              },
            }),
            {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            }
          );
        }

        return originalFetch(input, init);
      };
    },
    { fixtureLibrary: library, fixtureSession: session, wavBase64: WAV_BASE64 }
  );
}

async function stubReaderPrepareFlow(page: Parameters<typeof test>[0]['page']) {
  const comicItem = buildReaderItem({
    id: 'comic-1',
    title: 'Skyline Chapter 1',
    author: 'VoiceFlow',
    contentKind: 'comic',
    surface: 'comics',
    provider: 'mangadex',
    collectionLabel: 'MangaDex Live',
    summary: 'A fresh comic session fixture.',
    stats: { totalPanels: 3, pageCount: 3 },
    resume: { hasProgress: false, consumedChars: 0, currentPanelIndex: 0, progressPct: 0 },
  });
  const preparingSession = buildReaderSession({
    id: 'session-prep',
    title: 'Skyline Chapter 1',
    contentKind: 'comic',
    surface: 'comics',
    direction: 'vertical-scroll',
    readingMode: 'vertical_strip',
    sourceLanguage: 'en',
    targetLanguage: 'en',
    pageViewMode: 'original',
    ttsLanguageMode: 'source',
    translationState: 'warming',
    workKey: 'catalog:comic-1',
    provider: 'mangadex',
    sourceUrl: 'https://mangadex.org/title/demo',
    collectionLabel: 'MangaDex Live',
    consumedChars: 0,
    totalChars: 0,
    currentPanelIndex: 0,
    totalPanels: 3,
    progressPct: 0,
    readiness: { state: 'preparing', label: 'Hydrating remote comic pages.', playableItems: 0 },
    prep: { state: 'running', stage: 'ocr', completedItems: 1, totalItems: 3, failedItems: 0, message: 'Hydrating remote comic pages.' },
    windows: [],
    panels: [
      {
        panelId: 'panel-1',
        pageId: 'page-1',
        index: 0,
        direction: 'vertical-scroll',
        text: '',
        sourceText: '',
        displayText: '',
        translationStatus: 'pending',
        imageUrl: 'https://example.com/panel-1.png',
        audioStatus: 'idle',
      },
      {
        panelId: 'panel-2',
        pageId: 'page-2',
        index: 1,
        direction: 'vertical-scroll',
        text: '',
        sourceText: '',
        displayText: '',
        translationStatus: 'pending',
        imageUrl: 'https://example.com/panel-2.png',
        audioStatus: 'idle',
      },
      {
        panelId: 'panel-3',
        pageId: 'page-3',
        index: 2,
        direction: 'vertical-scroll',
        text: '',
        sourceText: '',
        displayText: '',
        translationStatus: 'pending',
        imageUrl: 'https://example.com/panel-3.png',
        audioStatus: 'idle',
      },
    ],
  });
  const hydratedSession = {
    ...preparingSession,
    prep: { state: 'ready', stage: 'audio', completedItems: 3, totalItems: 3, failedItems: 0, message: 'Remote comic pages are hydrated.' },
    readiness: { state: 'preparing', label: 'Preparing first playable item', playableItems: 0 },
    panels: preparingSession.panels.map((panel, index) => ({
      ...panel,
      text: `Hydrated panel ${index + 1}`,
      sourceText: `Hydrated panel ${index + 1}`,
      displayText: `Hydrated panel ${index + 1}`,
      translationStatus: 'pending',
      imageUrl: `/reader/assets/panel-${index + 1}.png`,
      audioStatus: index === 0 ? 'queued' : 'idle',
    })),
  };

  await page.route('https://example.com/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'image/png',
      body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO7Z0bEAAAAASUVORK5CYII=', 'base64'),
    });
  });
  await page.route('**/reader/assets/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'image/png',
      body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO7Z0bEAAAAASUVORK5CYII=', 'base64'),
    });
  });

  await page.addInitScript(
    ({ fixtureItem, initialSession, finishedSession }) => {
      const originalFetch = window.fetch.bind(window);
      const counters = { ack: 0, library: 0, create: 0, session: 0 };
      let created = false;
      let sessionPolls = 0;
      (window as typeof window & { __readerCounters?: typeof counters }).__readerCounters = counters;
      window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
        const rawUrl =
          typeof input === 'string'
            ? input
            : input instanceof URL
              ? input.toString()
              : input instanceof Request
                ? input.url
                : String((input as { url?: string })?.url || '');
        const method = String(init?.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();

        if (rawUrl.includes('/reader/legal/ack')) {
          counters.ack += 1;
          const body = method === 'POST'
            ? {
                ack: {
                  accepted: true,
                  acceptedAt: new Date().toISOString(),
                  title: 'Reader rights',
                  message: 'Upload only content you have the right to use.',
                },
              }
            : {
                ack: {
                  accepted: true,
                  acceptedAt: new Date().toISOString(),
                  title: 'Reader rights',
                  message: 'Upload only content you have the right to use.',
                },
                billing: {
                  vfPerChar: 1.5,
                  rule: '1 char = 1.5 VF',
                  label: 'Reader pricing: 1 char = 1.5 VF',
                },
              };
          return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }

        if (rawUrl.includes('/reader/library')) {
          counters.library += 1;
          const activeSession = created ? initialSession : null;
          return new Response(
            JSON.stringify({
              library: {
                surface: 'all',
                regionId: 'english',
                regions: [{ id: 'english', label: 'English' }],
                items: [
                  {
                    ...fixtureItem,
                    ...(created ? { sessionId: initialSession.id, readiness: initialSession.readiness, prep: initialSession.prep } : {}),
                  },
                ],
                activeSession,
                activeSessions: activeSession ? [activeSession] : [],
                counts: { all: 1, visible: 1, books: 0, comics: 1, uploads: 0, resumable: activeSession ? 1 : 0 },
                facets: { providers: ['mangadex'], collections: ['MangaDex Live'], progressStates: ['all', 'ready', 'new'] },
                shelves: {
                  continueReading: activeSession ? [{ ...fixtureItem, sessionId: initialSession.id, readiness: initialSession.readiness, prep: initialSession.prep }] : [fixtureItem],
                  trending: [fixtureItem],
                  newArrivals: [fixtureItem],
                  recentlyImported: [],
                },
              },
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        }

        if (rawUrl.includes('/reader/sessions') && method === 'POST') {
          counters.create += 1;
          created = true;
          return new Response(JSON.stringify({ session: initialSession }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }

        if (rawUrl.includes('/reader/sessions/session-prep')) {
          counters.session += 1;
          sessionPolls += 1;
          const payload = sessionPolls >= 2 ? finishedSession : initialSession;
          return new Response(JSON.stringify({ session: payload }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }

        return originalFetch(input, init);
      };
    },
    { fixtureItem: comicItem, initialSession: preparingSession, finishedSession: hydratedSession }
  );
}

async function stubReaderRecoveryFlow(page: Parameters<typeof test>[0]['page']) {
  const session = buildReaderSession({
    id: 'session-expired',
    title: 'Orbit Reader',
    workKey: 'catalog:item-1',
  });
  const item = buildReaderItem();
  const counters = { ack: 0, library: 0, session: 0 };

  await page.addInitScript(
    ({ fixtureSession, fixtureItem, counterSeed }) => {
      const originalFetch = window.fetch.bind(window);
      const counters = counterSeed;
      let libraryCalls = 0;
      (window as typeof window & { __readerRecoveryCounters?: typeof counters }).__readerRecoveryCounters = counters;
      window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
        const rawUrl =
          typeof input === 'string'
            ? input
            : input instanceof URL
              ? input.toString()
              : input instanceof Request
                ? input.url
                : String((input as { url?: string })?.url || '');
        const method = String(init?.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();

        if (rawUrl.includes('/reader/legal/ack')) {
          counters.ack += 1;
          const body = method === 'POST'
            ? {
                ack: {
                  accepted: true,
                  acceptedAt: new Date().toISOString(),
                  title: 'Reader rights',
                  message: 'Upload only content you have the right to use.',
                },
              }
            : {
                ack: {
                  accepted: true,
                  acceptedAt: new Date().toISOString(),
                  title: 'Reader rights',
                  message: 'Upload only content you have the right to use.',
                },
                billing: {
                  vfPerChar: 1.5,
                  rule: '1 char = 1.5 VF',
                  label: 'Reader pricing: 1 char = 1.5 VF',
                },
              };
          return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }

        if (rawUrl.includes('/reader/library')) {
          counters.library += 1;
          libraryCalls += 1;
          const hasActive = libraryCalls === 1;
          return new Response(
            JSON.stringify({
              library: {
                surface: 'all',
                regionId: 'english',
                regions: [{ id: 'english', label: 'English' }],
                items: [
                  {
                    ...fixtureItem,
                    ...(hasActive ? { sessionId: fixtureSession.id, readiness: fixtureSession.readiness } : {}),
                  },
                ],
                activeSession: hasActive ? fixtureSession : null,
                activeSessions: hasActive ? [fixtureSession] : [],
                counts: { all: 1, visible: 1, books: 1, comics: 0, uploads: 0, resumable: hasActive ? 1 : 0 },
                facets: { providers: ['internet_archive'], collections: ['Trending'], progressStates: ['all', 'ready', 'new'] },
                shelves: {
                  continueReading: [fixtureItem],
                  trending: [fixtureItem],
                  newArrivals: [fixtureItem],
                  recentlyImported: [],
                },
              },
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        }

        if (rawUrl.includes('/reader/sessions/session-expired')) {
          counters.session += 1;
          return new Response(JSON.stringify({ detail: 'Reader session not found.' }), {
            status: 404,
            headers: { 'Content-Type': 'application/json' },
          });
        }

        return originalFetch(input, init);
      };
    },
    { fixtureSession: session, fixtureItem: item, counterSeed: counters }
  );
}

test('boots application shell', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#root')).toBeVisible();
  await expect(page.getByTestId('notification-root')).toBeVisible();

  await expect(page.getByTestId('brand-logo-mark').first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Get Started' })).toBeVisible();

  const onboardingText = (await page.locator('body').textContent()) || '';
  expect(onboardingText.toLowerCase()).not.toMatch(/\b(gemini|kokoro)\b/);

  await page.getByRole('button', { name: 'Get Started' }).click({ force: true });
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

  await expect(page.getByTestId('notification-toast')).toHaveCount(1);
  await expect(page.getByText("You're Offline")).toBeVisible();

  await page.evaluate(() => {
    window.dispatchEvent(new Event('online'));
  });

  if (bellVisible) {
    await page.evaluate(() => {
      const button = document.querySelector<HTMLButtonElement>('button[aria-label="Open notifications"]');
      button?.click();
    });
    await expect(page.getByTestId('notification-center')).toBeVisible();
    const emptyState = page.getByText('No notifications in this filter.');
    const centerHasItems = !(await emptyState.isVisible().catch(() => false));

    if (centerHasItems) {
      page.once('dialog', (dialog) => dialog.accept());
      await page.getByRole('button', { name: 'Clear all' }).click();
      await expect(emptyState).toBeVisible();
    }

    await page.getByRole('button', { name: 'Close notifications' }).click();
    await expect(page.getByTestId('notification-center')).toHaveCount(0);
  }
});

test.describe('reader smoke', () => {
  test.describe.configure({ mode: 'serial' });

  for (const theme of ['light', 'dark'] as const) {
    test(`reader browse home renders in ${theme} mode and opens inline panels`, async ({ page }) => {
      await setTheme(page, theme);
      await stubReaderApi(page);
      await page.goto('/?vf-screen=main&vf-tab=READER');

      await expect(page.getByRole('button', { name: 'Open Reader tools' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Open Reader audit' })).toBeVisible();

      await page.getByRole('button', { name: 'Open Reader tools' }).click();
      await expect(page.getByTestId('reader-tools-panel')).toBeVisible();
      await page.getByRole('button', { name: 'Open Reader audit' }).click();
      await expect(page.getByTestId('reader-audit-panel')).toBeVisible();
    });
  }

  test('reader active session shows playback stage with dock pinned', async ({ page }) => {
    await setTheme(page, 'dark');
    await stubReaderApi(page, { activeSession: true });
    await page.goto('/?vf-screen=main&vf-tab=READER');
    await expect(page.getByRole('button', { name: 'Continue Reading' }).first()).toBeVisible();
    await page.getByRole('button', { name: 'Continue Reading' }).first().click();

    await expect(page.getByRole('heading', { name: 'Playback timeline' })).toBeVisible();
    await expect(page.getByTestId('reader-sticky-dock')).toBeVisible();
    await page.getByRole('button', { name: 'Open Reader library panel' }).click();
    await expect(page.getByTestId('reader-library-panel')).toBeVisible();
  });

  test('reader fresh prepare enters playback immediately and switches hydrated assets to cached URLs', async ({ page }) => {
    await setTheme(page, 'light');
    await stubReaderPrepareFlow(page);
    await page.goto('/?vf-screen=main&vf-tab=READER');
    await expect(page.getByRole('button', { name: 'Open Reader tools' })).toBeVisible();

    const initialCounters = await page.evaluate(() => (window as typeof window & { __readerCounters?: { ack: number; library: number } }).__readerCounters);
    expect(initialCounters?.ack).toBe(1);
    expect(initialCounters?.library).toBe(1);

    const prepareStartedAt = Date.now();
    await page.getByRole('button', { name: 'Prepare' }).first().click();
    await expect(page.getByTestId('reader-playback-stage')).toBeVisible({ timeout: 2000 });
    expect(Date.now() - prepareStartedAt).toBeLessThan(2000);

    await expect(page.locator('.vf-reader__prep-banner p')).toHaveText(/Hydrating remote comic pages/i);
    await expect(page.getByText('1/3 prepared')).toBeVisible();
    await expect(page.locator('.vf-reader__webtoon-image').first()).toHaveAttribute('src', /\/reader\/assets\//);
  });

  test('reader stale session 404 exits playback once and returns to browse with recovery toast', async ({ page }) => {
    await setTheme(page, 'dark');
    await stubReaderRecoveryFlow(page);
    await page.goto('/?vf-screen=main&vf-tab=READER');
    await expect(page.getByRole('button', { name: 'Continue Reading' }).first()).toBeVisible();
    await page.getByRole('button', { name: 'Continue Reading' }).first().click();

    await expect(page.getByText('Reader session expired after server restart.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Open Reader tools' })).toBeVisible();

    const pollCountAfterRecovery = await page.evaluate(
      () => (window as typeof window & { __readerRecoveryCounters?: { session: number } }).__readerRecoveryCounters?.session || 0
    );
    await page.waitForTimeout(2000);
    const finalPollCount = await page.evaluate(
      () => (window as typeof window & { __readerRecoveryCounters?: { session: number } }).__readerRecoveryCounters?.session || 0
    );
    expect(finalPollCount).toBe(pollCountAfterRecovery);
  });
});
