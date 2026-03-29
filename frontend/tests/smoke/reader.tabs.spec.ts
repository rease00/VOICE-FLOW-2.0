import { expect, test, type Page } from '@playwright/test';
import type { ReaderCatalogItem, ReaderLibrary, ReaderSession } from '../../types';
import { ensureStudioSmokeAuthenticated, resolveStudioSmokeCredentials } from './smokeAuth';

type ReaderSmokeRestoreState = NonNullable<ReaderSession['restoreState']>;

interface ReaderSmokeState {
  preferences: {
    homeTab: 'novels' | 'library' | 'imported';
  };
  legalAckAccepted: boolean;
  sessionsById: Map<string, ReaderSession>;
  restoreByWorkKey: Map<string, ReaderSmokeRestoreState>;
  createCount: number;
  uploadCount: number;
}

interface ReaderSmokeHarnessOptions {
  legalAckAccepted?: boolean;
}

const fulfillJson = async (
  route: { fulfill: (options: { status: number; headers: Record<string, string>; body: string }) => Promise<void> },
  payload: unknown,
  status = 200
): Promise<void> => {
  await route.fulfill({
    status,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
};

const makeCatalogItem = (overrides: Partial<ReaderCatalogItem>): ReaderCatalogItem => ({
  id: 'reader-item',
  title: 'Reader Item',
  author: 'Reader Author',
  regionId: 'english',
  contentKind: 'book',
  surface: 'books',
  provider: 'catalog',
  license: 'public-domain',
  translationSupport: {
    page: true,
    tts: true,
  },
  resume: {
    hasProgress: false,
    consumedChars: 0,
    currentPanelIndex: 0,
    progressPct: 0,
  },
  prep: {
    state: 'ready',
    stage: 'audio',
    completedItems: 1,
    totalItems: 1,
    failedItems: 0,
  },
  readiness: {
    state: 'ready',
    label: 'Ready',
    playableItems: 1,
  },
  ...overrides,
});

const makeSession = (
  item: ReaderCatalogItem,
  sessionId: string,
  restoreState: ReaderSmokeRestoreState
): ReaderSession => ({
  id: sessionId,
  title: item.title,
  contentKind: item.contentKind,
  surface: item.surface,
  regionId: item.regionId,
  direction: item.contentKind === 'comic' ? 'vertical-scroll' : 'vertical-scroll',
  readingMode: item.contentKind === 'comic' ? 'vertical_strip' : 'document',
  sourceLanguage: 'en',
  targetLanguage: 'hi',
  pageViewMode: 'translated',
  ttsLanguageMode: 'target',
  voiceMode: 'single',
  narratorVoiceId: 'v1',
  translationState: 'ready',
  multiSpeakerEnabled: false,
  workKey: item.id,
  sourceKind: 'upload',
  provider: item.provider,
  license: item.license,
  coverUrl: item.coverUrl || '',
  summary: item.summary || 'Reader smoke session.',
  sourceUrl: item.sourceUrl || '',
  musicTrackId: 'm_none',
  ambientEnabled: false,
  ambientPresetId: 'none',
  ambientVolume: 0,
  sfxEnabled: false,
  sfxVolume: 0,
  autoAdvanceProfile: 'off',
  castMemory: { Narrator: 'v1' },
  lowConfidence: false,
  consumedChars: 0,
  totalChars: 1200,
  currentPanelIndex: 0,
  totalPanels: 0,
  progressPct: 0,
  resumeToken: `resume-${sessionId}`,
  activeItemIndex: Number(restoreState.activeItemIndex || 0),
  restoreState,
  unitOverrides: {},
  cachedChars: 0,
  cacheLimitChars: 120000,
  deleteAtMs: Date.now() + 60 * 60 * 1000,
  warningActive: false,
  savepointDownloadUrl: `/reader/sessions/${sessionId}/export`,
  billing: {
    vfPerChar: 1.0,
    rule: '1 char = 1 VF',
    label: '1 char = 1 VF',
  },
  limits: {
    textWindowChars: 1500,
    prefetchThresholdChars: 1000,
    panelBatchSize: 10,
    panelTriggerIndex: 5,
    deleteWarningMs: 15 * 60 * 1000,
  },
  windows: [
    {
      index: 0,
      title: 'Chapter 1',
      startChar: 0,
      endChar: 1200,
      charCount: 1200,
      text: 'Reader smoke content.',
      sourceText: 'Reader smoke content.',
      displayText: 'Reader smoke content.',
      translationStatus: 'ready',
      estimatedReadMs: 1000,
      status: 'ready',
      jobId: 'job-1',
      job: {
        jobId: 'job-1',
        status: 'completed',
        playableChunks: 1,
        playableDurationMs: 1000,
      },
      lowConfidence: false,
    },
  ],
  panels: [],
});

const buildReaderSmokeLibrary = (items: ReaderCatalogItem[]): ReaderLibrary => ({
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
    books: items.filter((item) => item.surface === 'books').length,
    comics: items.filter((item) => item.surface === 'comics').length,
    uploads: items.filter((item) => item.surface === 'uploads').length,
    resumable: items.filter((item) => Boolean(item.sessionId || item.resume?.hasProgress)).length,
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

const mergeRestoreState = (
  current: ReaderSmokeRestoreState | undefined,
  patch: Partial<ReaderSmokeRestoreState>
): ReaderSmokeRestoreState => ({
  activeItemIndex: Number(patch.activeItemIndex ?? current?.activeItemIndex ?? 0),
  activeUnitId: String(patch.activeUnitId ?? current?.activeUnitId ?? ''),
  viewportAnchor: String(patch.viewportAnchor ?? current?.viewportAnchor ?? ''),
  activeReaderTab: String(patch.activeReaderTab ?? current?.activeReaderTab ?? ''),
  updatedAt: new Date().toISOString(),
});

const installReaderSmokeHarness = async (
  page: Page,
  options?: ReaderSmokeHarnessOptions
): Promise<ReaderSmokeState> => {
  const state: ReaderSmokeState = {
    preferences: {
      homeTab: 'novels',
    },
    legalAckAccepted: options?.legalAckAccepted ?? true,
    sessionsById: new Map<string, ReaderSession>(),
    restoreByWorkKey: new Map<string, ReaderSmokeRestoreState>(),
    createCount: 0,
    uploadCount: 0,
  };

  const catalogItems: Record<string, ReaderCatalogItem> = {
    imported: makeCatalogItem({
      id: 'imported-story',
      title: 'Imported Story',
      author: 'A Reader',
      surface: 'uploads',
      provider: 'voiceflow_upload',
      license: 'user_responsible',
      sessionId: 'imported-session',
      summary: 'An imported story for Reader smoke coverage.',
      coverUrl: '',
    }),
    novel: makeCatalogItem({
      id: 'novel-story',
      title: 'Novel Story',
      author: 'A Writer',
      surface: 'books',
      provider: 'catalog',
      license: 'public-domain',
      sessionId: 'novel-session',
      summary: 'A novel shelf item for Reader smoke coverage.',
      coverUrl: '',
    }),
  };

  const library = buildReaderSmokeLibrary([catalogItems.imported, catalogItems.novel]);

  await page.route('**/reader/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const pathname = url.pathname;
    const method = request.method().toUpperCase();
    const hasPath = (suffix: string): boolean => pathname === suffix || pathname.endsWith(suffix);
    const hasPathPrefix = (prefix: string): boolean => pathname.startsWith(prefix) || pathname.includes(prefix);

    if (hasPath('/reader/preferences')) {
      if (method === 'GET') {
        await fulfillJson(route, { ok: true, preferences: { uid: 'reader-smoke', ...state.preferences, updatedAt: new Date().toISOString() } }, 200);
        return;
      }
      if (method === 'PATCH') {
        const body = request.postDataJSON() as Record<string, unknown> | null;
        if (body && typeof body.homeTab === 'string') {
          const token = String(body.homeTab).trim().toLowerCase();
          if (token === 'novels' || token === 'library' || token === 'imported') {
            state.preferences.homeTab = token;
          }
        }
        await fulfillJson(route, { ok: true, preferences: { uid: 'reader-smoke', ...state.preferences, updatedAt: new Date().toISOString() } }, 200);
        return;
      }
    }

    if (hasPath('/reader/legal/ack')) {
      if (method === 'GET' || method === 'POST') {
        if (method === 'POST') {
          const body = request.postDataJSON() as Record<string, unknown> | null;
          if (body && typeof body.accepted === 'boolean') {
            state.legalAckAccepted = body.accepted;
          } else {
            state.legalAckAccepted = true;
          }
        }
        await fulfillJson(route, {
          ok: true,
          ack: {
            accepted: state.legalAckAccepted,
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
        }, 200);
        return;
      }
    }

    if (hasPath('/reader/uploads') && method === 'POST') {
      state.uploadCount += 1;
      const uploadedItem = makeCatalogItem({
        id: `uploaded-story-${state.uploadCount}`,
        title: `Uploaded Story ${state.uploadCount}`,
        author: 'Upload Author',
        surface: 'uploads',
        provider: 'voiceflow_upload',
        license: 'user_responsible',
        contentKind: 'book',
        summary: 'Uploaded story for Reader smoke coverage.',
        coverUrl: '',
      });
      catalogItems.uploaded = uploadedItem;
      library.items.unshift(uploadedItem);
      library.counts.all += 1;
      library.counts.visible += 1;
      library.counts.uploads += 1;
      library.regions[0].sharedCount = (library.regions[0].sharedCount || 0) + 1;
      await fulfillJson(route, { ok: true, upload: uploadedItem }, 200);
      return;
    }

    if (hasPath('/reader/dashboard') && method === 'GET') {
      await fulfillJson(route, { ok: true, dashboard: library }, 200);
      return;
    }

    if (hasPath('/reader/library') && method === 'GET') {
      await fulfillJson(route, { ok: true, library }, 200);
      return;
    }

    if (hasPathPrefix('/reader/catalog/items/') && method === 'GET') {
      const itemId = decodeURIComponent(pathname.split('/').pop() || '');
      const item = catalogItems[itemId as keyof typeof catalogItems] || catalogItems.imported;
      await fulfillJson(route, { ok: true, item }, 200);
      return;
    }

    if (hasPath('/reader/commercial/check') && method === 'POST') {
      await fulfillJson(route, {
        ok: true,
        check: {
          result: 'allowed',
          reason: 'Smoke harness allows Reader imports.',
          provider: 'voiceflow_upload',
          licenseToken: 'smoke',
          ownershipBasis: 'user_responsible',
          intendedUse: 'tts_transform_only',
          isSellingOriginalText: false,
          catalogAllowed: true,
          notes: [],
          nextSteps: [],
        },
      }, 200);
      return;
    }

    if (hasPath('/reader/sessions') && method === 'POST') {
      const body = request.postDataJSON() as Record<string, unknown> | null;
      const workKey = String(body?.itemId || body?.uploadId || '').trim() || 'imported-story';
      const item = workKey === catalogItems.novel.id ? catalogItems.novel : catalogItems.imported;
      state.createCount += 1;
      const sessionId = `reader-session-${state.createCount}`;
      const restoreState = state.restoreByWorkKey.get(workKey) || {
        activeItemIndex: 0,
        activeUnitId: '',
        viewportAnchor: '',
        activeReaderTab: '',
        updatedAt: new Date().toISOString(),
      };
      const session = makeSession(item, sessionId, restoreState);
      session.workKey = workKey;
      session.sourceKind = workKey === catalogItems.imported.id ? 'upload' : 'catalog';
      session.id = sessionId;
      session.title = item.title;
      session.activeItemIndex = Number(restoreState.activeItemIndex || 0);
      session.restoreState = restoreState;
      state.sessionsById.set(sessionId, session);
      state.restoreByWorkKey.set(workKey, restoreState);
      await fulfillJson(route, { ok: true, session }, 200);
      return;
    }

    if (hasPathPrefix('/reader/sessions/')) {
      const parts = pathname.split('/').filter(Boolean);
      const sessionId = parts[2] || '';
      const session = state.sessionsById.get(sessionId);
      if (!session) {
        await fulfillJson(route, { detail: 'Session not found' }, 404);
        return;
      }

      if (parts.length === 3 && method === 'GET') {
        await fulfillJson(route, { ok: true, session }, 200);
        return;
      }

      if (parts.length === 4 && parts[3] === 'progress' && method === 'POST') {
        const body = request.postDataJSON() as Record<string, unknown> | null;
        const nextRestoreState = mergeRestoreState(session.restoreState, {
          activeItemIndex: Number(body?.activeItemIndex ?? session.activeItemIndex ?? 0),
          activeUnitId: String(body?.activeUnitId || session.activeUnitId || ''),
          viewportAnchor: String(body?.viewportAnchor || session.viewportAnchor || ''),
        });
        session.activeItemIndex = Number(nextRestoreState.activeItemIndex || 0);
        session.activeUnitId = String(nextRestoreState.activeUnitId || '');
        session.viewportAnchor = String(nextRestoreState.viewportAnchor || '');
        session.restoreState = nextRestoreState;
        state.sessionsById.set(sessionId, session);
        state.restoreByWorkKey.set(String(session.workKey || ''), nextRestoreState);
        await fulfillJson(route, { ok: true, session }, 200);
        return;
      }

      if (parts.length === 4 && parts[3] === 'savepoint' && method === 'POST') {
        const body = request.postDataJSON() as Record<string, unknown> | null;
        const restoreState = mergeRestoreState(session.restoreState, {
          activeItemIndex: Number((body?.restoreState as Record<string, unknown> | undefined)?.activeItemIndex ?? session.activeItemIndex ?? 0),
          activeUnitId: String((body?.restoreState as Record<string, unknown> | undefined)?.activeUnitId || session.activeUnitId || ''),
          viewportAnchor: String((body?.restoreState as Record<string, unknown> | undefined)?.viewportAnchor || session.viewportAnchor || ''),
          activeReaderTab: String((body?.restoreState as Record<string, unknown> | undefined)?.activeReaderTab || session.restoreState?.activeReaderTab || ''),
        });
        session.activeItemIndex = Number(restoreState.activeItemIndex || 0);
        session.activeUnitId = String(restoreState.activeUnitId || '');
        session.viewportAnchor = String(restoreState.viewportAnchor || '');
        session.restoreState = restoreState;
        state.sessionsById.set(sessionId, session);
        state.restoreByWorkKey.set(String(session.workKey || ''), restoreState);
        await fulfillJson(route, { ok: true, session }, 200);
        return;
      }
    }

    await route.continue();
  });

  return state;
};

test('Reader home filter and session tab restore survive reloads', async ({ page }) => {
  test.setTimeout(300_000);
  const credentials = resolveStudioSmokeCredentials();
  test.skip(!credentials, 'Set PLAYWRIGHT_ADMIN_EMAIL and PLAYWRIGHT_ADMIN_PASSWORD for authenticated Reader smoke.');
  if (!credentials) return;

  await ensureStudioSmokeAuthenticated(page, credentials);
  const readerState = await installReaderSmokeHarness(page);
  const readerHome = page.getByTestId('reader-home');
  const readerTray = page.getByTestId('reader-utility-tray');
  const importedFilter = readerHome.getByRole('button', { name: /^Imported\b/i });
  const openImportedStory = readerHome.getByRole('button', { name: /^Open Imported Story$/i });
  const importedStoryDialog = page.getByRole('dialog', { name: /Open Imported Story/i });
  const textTab = readerTray.getByRole('tab', { name: /^Text$/i });

  await page.goto('/reader', { waitUntil: 'domcontentloaded', timeout: 120_000 });
  await expect(readerHome).toBeVisible({ timeout: 30_000 });
  await expect(importedFilter).toBeVisible({ timeout: 30_000 });
  await importedFilter.click();
  await expect(importedFilter).toHaveAttribute('aria-pressed', 'true');

  await page.reload({ waitUntil: 'domcontentloaded', timeout: 120_000 });
  await expect(readerHome).toBeVisible({ timeout: 30_000 });
  await expect(importedFilter).toHaveAttribute('aria-pressed', 'true');

  await expect(openImportedStory).toBeVisible({ timeout: 30_000 });
  await openImportedStory.click();
  await expect(importedStoryDialog).toBeVisible({ timeout: 30_000 });
  await importedStoryDialog.getByRole('button', { name: /^Read$/i }).click();

  await expect(readerTray).toBeVisible({ timeout: 30_000 });
  await expect(textTab).toBeVisible({ timeout: 30_000 });
  await textTab.click();
  await expect(textTab).toHaveAttribute('aria-selected', 'true');

  await page.getByRole('button', { name: /^Back To Home$/i }).click();
  await expect(readerHome).toBeVisible({ timeout: 30_000 });
  await expect(importedFilter).toHaveAttribute('aria-pressed', 'true');

  await openImportedStory.click();
  await expect(importedStoryDialog).toBeVisible({ timeout: 30_000 });
  await importedStoryDialog.getByRole('button', { name: /^Read$/i }).click();
  await expect(readerTray).toBeVisible({ timeout: 30_000 });
  await expect(textTab).toHaveAttribute('aria-selected', 'true');
});

test('Reader import opens the player immediately and restores the saved tab after reload', async ({ page }) => {
  test.setTimeout(300_000);
  const credentials = resolveStudioSmokeCredentials();
  test.skip(!credentials, 'Set PLAYWRIGHT_ADMIN_EMAIL and PLAYWRIGHT_ADMIN_PASSWORD for authenticated Reader smoke.');
  if (!credentials) return;

  await ensureStudioSmokeAuthenticated(page, credentials);
  const readerState = await installReaderSmokeHarness(page);
  const readerHome = page.getByTestId('reader-home');
  const readerTray = page.getByTestId('reader-utility-tray');
  const readerStage = page.getByTestId('reader-playback-stage');
  const textTab = readerTray.getByRole('tab', { name: /^Text$/i });

  await page.goto('/reader', { waitUntil: 'domcontentloaded', timeout: 120_000 });
  await expect(readerHome).toBeVisible({ timeout: 30_000 });
  const fileInput = readerHome.locator('input[type="file"]');
  await fileInput.setInputFiles({
    name: 'reader-import.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('Imported Reader smoke content for immediate player handoff.'),
  });

  await expect(readerStage).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect.poll(() => readerState.createCount, { timeout: 10_000 }).toBe(1);

  await expect(readerTray).toBeVisible({ timeout: 30_000 });
  await textTab.click();
  await expect(textTab).toHaveAttribute('aria-selected', 'true');

  await page.reload({ waitUntil: 'domcontentloaded', timeout: 120_000 });
  await expect(readerStage).toBeVisible({ timeout: 30_000 });
  await expect(readerTray).toBeVisible({ timeout: 30_000 });
  await expect(textTab).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('heading', { name: /^Imported Story$/i }).first()).toBeVisible();
});

test('Reader mobile layout keeps primary controls within the viewport', async ({ page }) => {
  test.setTimeout(300_000);
  const credentials = resolveStudioSmokeCredentials();
  test.skip(!credentials, 'Set PLAYWRIGHT_ADMIN_EMAIL and PLAYWRIGHT_ADMIN_PASSWORD for authenticated Reader smoke.');
  if (!credentials) return;

  await page.setViewportSize({ width: 390, height: 844 });
  await ensureStudioSmokeAuthenticated(page, credentials);
  await installReaderSmokeHarness(page, { legalAckAccepted: false });
  const readerHome = page.getByTestId('reader-home');
  const expandDockButton = page.getByLabel('Expand reader dock');
  const collapseDockButton = page.getByLabel('Collapse dock to compact circle');
  const importFilesButton = readerHome.getByRole('button', { name: /^Import Files$/i });

  await page.goto('/reader', { waitUntil: 'domcontentloaded', timeout: 120_000 });
  await expect(page.getByText('Reader Rights Notice')).toBeVisible();
  await expect(importFilesButton).toBeVisible({ timeout: 30_000 });
  await expect(importFilesButton).toBeDisabled();
  await expect(expandDockButton).toBeVisible({ timeout: 30_000 });
  await expandDockButton.click();
  await expect(collapseDockButton).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('Read - Idle', { exact: true })).toBeVisible();

  const viewportWidth = await page.evaluate(() => window.innerWidth);
  const targets = [
    page.getByRole('button', { name: /^Accept Once$/i }),
    collapseDockButton,
  ];
  for (const target of targets) {
    await expect(target).toBeVisible();
    const box = await target.boundingBox();
    expect(box).not.toBeNull();
    if (box) {
      expect(Math.ceil(box.x + box.width)).toBeLessThanOrEqual(viewportWidth);
    }
  }

  const metrics = await page.evaluate(() => ({
    innerWidth: window.innerWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.innerWidth);
});
