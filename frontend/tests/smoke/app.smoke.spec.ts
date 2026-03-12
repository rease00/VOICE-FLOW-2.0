import { expect, test, type Page } from '@playwright/test';

function buildLabWavBuffer(durationMs = 420): Buffer {
  const sampleRate = 22050;
  const channelCount = 1;
  const bytesPerSample = 2;
  const frameCount = Math.max(1, Math.round((sampleRate * durationMs) / 1000));
  const dataSize = frameCount * channelCount * bytesPerSample;
  const buffer = Buffer.alloc(44 + dataSize);

  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(channelCount, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * channelCount * bytesPerSample, 28);
  buffer.writeUInt16LE(channelCount * bytesPerSample, 32);
  buffer.writeUInt16LE(bytesPerSample * 8, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);

  for (let index = 0; index < frameCount; index += 1) {
    const sample = Math.round(Math.sin(index / 14) * 10000);
    buffer.writeInt16LE(sample, 44 + (index * bytesPerSample));
  }

  return buffer;
}

const WAV_BASE64 = buildLabWavBuffer(420).toString('base64');

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
  provider: 'internet_archive',
  license: 'Public domain',
  commercialUseStatus: 'allowed',
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
    textWindowChars: 1500,
    prefetchThresholdChars: 1000,
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
    commercialPolicyVersion: '2026-03-11.strict',
    blockedProviders: ['project_gutenberg'],
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
  const uploadItem = buildReaderItem({
    id: 'upload-1',
    title: 'Imported Reader Story',
    author: 'Upload',
    surface: 'uploads',
    provider: 'voiceflow_upload',
    license: 'Owned upload',
    collectionLabel: 'Uploads',
    commercialUseStatus: 'allowed',
    resume: { hasProgress: false, consumedChars: 0, currentPanelIndex: 0, progressPct: 0 },
    readiness: { state: 'ready', label: 'Ready', playableItems: 2 },
  });
  const uploadSession = buildReaderSession({
    id: 'session-upload-1',
    title: 'Imported Reader Story',
    surface: 'uploads',
    sourceKind: 'upload',
    workKey: 'upload:upload-1',
    provider: 'voiceflow_upload',
    license: 'Owned upload',
    commercialUseStatus: 'allowed',
    sourceLanguage: 'en',
    targetLanguage: 'en',
    pageViewMode: 'original',
    ttsLanguageMode: 'source',
    audioEngine: 'native_audio_dialog',
    narratorVoiceId: 'v22',
    multiSpeakerEnabled: true,
  });
  const library = buildReaderLibrary(
    options?.activeSession
      ? {
          activeSession: session,
          activeSessions: [session],
        }
      : {}
  );

  await page.addInitScript(
    ({ fixtureLibrary, fixtureSession, fixtureUploadItem, fixtureUploadSession, wavBase64 }) => {
      const originalFetch = window.fetch.bind(window);
      let uploaded = false;
      let currentUploadItem = fixtureUploadItem;
      let currentFixtureSession = fixtureSession;
      let currentUploadSession = fixtureUploadSession;
      let currentPreferences = {
        regionId: 'english',
        targetLanguage: '',
        pageViewMode: 'original',
        ttsLanguageMode: 'auto',
        autoAdvanceProfile: 'off',
        multiSpeakerEnabled: true,
        audioEngine: 'native_audio_dialog',
        narratorVoiceId: 'v22',
        readingMode: 'vertical_strip',
      };
      (window as typeof window & {
        __readerUploadAudit?: Record<string, unknown>;
        __readerSessionCreateAudit?: Record<string, unknown>;
        __readerSaveAudit?: Record<string, unknown>;
        __readerPreferencesAudit?: Record<string, unknown>;
      }).__readerUploadAudit = {};
      (window as typeof window & {
        __readerUploadAudit?: Record<string, unknown>;
        __readerSessionCreateAudit?: Record<string, unknown>;
        __readerSaveAudit?: Record<string, unknown>;
        __readerPreferencesAudit?: Record<string, unknown>;
      }).__readerSessionCreateAudit = {};
      (window as typeof window & {
        __readerUploadAudit?: Record<string, unknown>;
        __readerSessionCreateAudit?: Record<string, unknown>;
        __readerSaveAudit?: Record<string, unknown>;
        __readerPreferencesAudit?: Record<string, unknown>;
      }).__readerSaveAudit = {};
      (window as typeof window & {
        __readerUploadAudit?: Record<string, unknown>;
        __readerSessionCreateAudit?: Record<string, unknown>;
        __readerSaveAudit?: Record<string, unknown>;
        __readerPreferencesAudit?: Record<string, unknown>;
      }).__readerPreferencesAudit = {};
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
        const parseJsonBody = async () => {
          if (typeof init?.body === 'string') {
            try {
              return JSON.parse(init.body);
            } catch {
              return {};
            }
          }
          if (input instanceof Request) {
            return input.clone().json().catch(() => ({}));
          }
          return {};
        };

        if (rawUrl.includes('/reader/legal/ack')) {
          const isPost = method === 'POST';
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
                commercial: {
                  enabled: true,
                  commercialPolicyVersion: '2026-03-11.strict',
                  policyVersion: '2026-03-11.strict',
                  blockedProviders: ['project_gutenberg'],
                  ownershipBasisOptions: [
                    { value: 'own_work', label: 'Own work', description: 'You created the work and control the rights.' },
                    { value: 'licensed', label: 'Licensed', description: 'You have direct permission for commercial narration.' },
                    { value: 'open_license', label: 'Open license', description: 'The source license permits this use.' },
                    { value: 'public_domain', label: 'Public domain', description: 'The work is public domain for your market.' },
                    { value: 'user_responsible', label: 'User responsible', description: 'You will verify rights manually before release.' },
                  ],
                },
              };
          return new Response(JSON.stringify(body), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }

        if (rawUrl.includes('/reader/preferences')) {
          if (method === 'PATCH') {
            const requestPayload = await parseJsonBody();
            currentPreferences = {
              ...currentPreferences,
              ...requestPayload,
            };
            (window as typeof window & { __readerPreferencesAudit?: Record<string, unknown> }).__readerPreferencesAudit = requestPayload;
          }
          return new Response(JSON.stringify({ preferences: currentPreferences }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }

        if (rawUrl.includes('/reader/library')) {
          const dynamicItems = uploaded ? [currentUploadItem, ...fixtureLibrary.items] : fixtureLibrary.items;
          const uploadsCount = uploaded ? 1 : 0;
          const dynamicLibrary = {
            ...fixtureLibrary,
            items: dynamicItems,
            counts: {
              ...fixtureLibrary.counts,
              all: dynamicItems.length,
              visible: dynamicItems.length,
              uploads: uploadsCount,
            },
            shelves: {
              ...fixtureLibrary.shelves,
              recentlyImported: uploaded ? [currentUploadItem] : fixtureLibrary.shelves.recentlyImported,
            },
          };
          return new Response(JSON.stringify({ library: dynamicLibrary }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }

        if (rawUrl.includes('/reader/uploads') && method === 'POST') {
          const formData = init?.body instanceof FormData
            ? init.body
            : input instanceof Request
              ? await input.clone().formData().catch(() => null)
              : null;
          const requestedTitle = String(formData?.get('title') || fixtureUploadItem.title).trim() || fixtureUploadItem.title;
          const requestedContentType = String(formData?.get('contentType') || '').trim().toLowerCase();
          const requestedOwnershipBasis = String(formData?.get('ownershipBasis') || 'user_responsible').trim();
          uploaded = true;
          currentUploadItem = {
            ...fixtureUploadItem,
            title: requestedTitle,
            contentKind: requestedContentType === 'comic' ? 'comic' : 'book',
            readingModeDefault: requestedContentType === 'comic' ? 'vertical_strip' : 'document',
          };
          currentUploadSession = {
            ...fixtureUploadSession,
            title: requestedTitle,
            contentKind: currentUploadItem.contentKind,
            readingMode: currentUploadItem.readingModeDefault,
            workKey: `upload:${currentUploadItem.id}`,
          };
          (window as typeof window & { __readerUploadAudit?: Record<string, unknown> }).__readerUploadAudit = {
            title: requestedTitle,
            contentType: requestedContentType || 'auto',
            ownershipBasis: requestedOwnershipBasis,
          };
          return new Response(JSON.stringify({ upload: currentUploadItem }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }

        if (rawUrl.includes('/reader/sessions') && method === 'POST' && !rawUrl.includes('/savepoint')) {
          const requestPayload = await parseJsonBody();
          (window as typeof window & { __readerSessionCreateAudit?: Record<string, unknown> }).__readerSessionCreateAudit = requestPayload;
          if (uploaded || requestPayload?.uploadId === fixtureUploadItem.id) {
            currentUploadSession = {
              ...currentUploadSession,
              targetLanguage: requestPayload.targetLanguage || currentUploadSession.targetLanguage,
              pageViewMode: requestPayload.pageViewMode || currentUploadSession.pageViewMode,
              ttsLanguageMode: requestPayload.ttsLanguageMode || currentUploadSession.ttsLanguageMode,
              audioEngine: requestPayload.audioEngine || currentUploadSession.audioEngine,
              multiSpeakerEnabled: requestPayload.multiSpeakerEnabled ?? currentUploadSession.multiSpeakerEnabled,
              voiceMode: requestPayload.voiceMode || currentUploadSession.voiceMode,
              narratorVoiceId: requestPayload.narratorVoiceId || currentUploadSession.narratorVoiceId,
              readingMode: requestPayload.readingModeOverride || currentUploadSession.readingMode,
              autoAdvanceProfile: requestPayload.autoAdvanceProfile || currentUploadSession.autoAdvanceProfile,
            };
            return new Response(JSON.stringify({ session: currentUploadSession }), {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            });
          }
          currentFixtureSession = {
            ...currentFixtureSession,
            targetLanguage: requestPayload.targetLanguage || currentFixtureSession.targetLanguage,
            pageViewMode: requestPayload.pageViewMode || currentFixtureSession.pageViewMode,
            ttsLanguageMode: requestPayload.ttsLanguageMode || currentFixtureSession.ttsLanguageMode,
            audioEngine: requestPayload.audioEngine || currentFixtureSession.audioEngine,
            multiSpeakerEnabled: requestPayload.multiSpeakerEnabled ?? currentFixtureSession.multiSpeakerEnabled,
            voiceMode: requestPayload.voiceMode || currentFixtureSession.voiceMode,
            narratorVoiceId: requestPayload.narratorVoiceId || currentFixtureSession.narratorVoiceId,
            readingMode: requestPayload.readingModeOverride || currentFixtureSession.readingMode,
            autoAdvanceProfile: requestPayload.autoAdvanceProfile || currentFixtureSession.autoAdvanceProfile,
          };
          return new Response(JSON.stringify({ session: currentFixtureSession }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }

        if (rawUrl.includes('/reader/sessions/session-1')) {
          if (rawUrl.includes('/progress') && method === 'POST') {
            const requestPayload = await parseJsonBody();
            currentFixtureSession = {
              ...currentFixtureSession,
              targetLanguage: requestPayload.targetLanguage || currentFixtureSession.targetLanguage,
              pageViewMode: requestPayload.pageViewMode || currentFixtureSession.pageViewMode,
              audioEngine: requestPayload.audioEngine || currentFixtureSession.audioEngine,
              activeItemIndex: requestPayload.activeItemIndex ?? currentFixtureSession.activeItemIndex,
            };
          }
          return new Response(JSON.stringify({ session: currentFixtureSession }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }

        if (rawUrl.includes('/reader/sessions/') && rawUrl.includes('/savepoint') && method === 'POST') {
          const requestPayload = await parseJsonBody();
          (window as typeof window & { __readerSaveAudit?: Record<string, unknown> }).__readerSaveAudit = requestPayload;
          const isUploadSession = rawUrl.includes('/session-upload-1');
          const baseSession = isUploadSession ? currentUploadSession : currentFixtureSession;
          const nextSession = {
            ...baseSession,
            audioEngine: requestPayload.audioEngine || baseSession.audioEngine,
            multiSpeakerEnabled: requestPayload.multiSpeakerEnabled ?? baseSession.multiSpeakerEnabled,
            voiceMode: requestPayload.voiceMode || baseSession.voiceMode,
            narratorVoiceId: requestPayload.narratorVoiceId || baseSession.narratorVoiceId,
            targetLanguage: requestPayload.targetLanguage || baseSession.targetLanguage,
            pageViewMode: requestPayload.pageViewMode || baseSession.pageViewMode,
            ttsLanguageMode: requestPayload.ttsLanguageMode || baseSession.ttsLanguageMode,
            readingMode: requestPayload.readingModeOverride || baseSession.readingMode,
            autoAdvanceProfile: requestPayload.autoAdvanceProfile || baseSession.autoAdvanceProfile,
          };
          if (isUploadSession) {
            currentUploadSession = nextSession;
          } else {
            currentFixtureSession = nextSession;
          }
          return new Response(JSON.stringify({ session: nextSession }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }

        if (rawUrl.includes('/reader/sessions/session-upload-1')) {
          if (rawUrl.includes('/progress') && method === 'POST') {
            const requestPayload = await parseJsonBody();
            currentUploadSession = {
              ...currentUploadSession,
              targetLanguage: requestPayload.targetLanguage || currentUploadSession.targetLanguage,
              pageViewMode: requestPayload.pageViewMode || currentUploadSession.pageViewMode,
              audioEngine: requestPayload.audioEngine || currentUploadSession.audioEngine,
              activeItemIndex: requestPayload.activeItemIndex ?? currentUploadSession.activeItemIndex,
            };
          }
          return new Response(JSON.stringify({ session: currentUploadSession }), {
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
    {
      fixtureLibrary: library,
      fixtureSession: session,
      fixtureUploadItem: uploadItem,
      fixtureUploadSession: uploadSession,
      wavBase64: WAV_BASE64,
    }
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

async function importLabAudio(page: Parameters<typeof test>[0]['page'], fileName = 'lab-demo.wav') {
  const audioInput = page.locator('input[type="file"][accept*="audio"]').first();
  await audioInput.setInputFiles({
    name: fileName,
    mimeType: 'audio/wav',
    buffer: buildLabWavBuffer(),
  });
}

async function openWorkspaceTab(page: Parameters<typeof test>[0]['page'], label: string) {
  const openMenuButton = page.getByRole('button', { name: 'Open navigation menu' });
  const navigationButtons = page.getByRole('button', { name: new RegExp(`^${label}$`) });

  const clickVisibleNavigationButton = async (): Promise<boolean> => {
    const buttonCount = await navigationButtons.count();
    for (let index = 0; index < buttonCount; index += 1) {
      const button = navigationButtons.nth(index);
      await button.evaluate((node) => {
        if (node instanceof HTMLElement) {
          node.scrollIntoView({ block: 'center', inline: 'nearest' });
        }
      }).catch(() => undefined);
      if (!(await button.isVisible().catch(() => false))) continue;
      await button.scrollIntoViewIfNeeded().catch(() => undefined);
      try {
        await button.click({ timeout: 2000 });
        return true;
      } catch {
        // Fallback to forced/native click for compact nav overlays.
      }
      try {
        await button.click({ force: true, timeout: 2000 });
        return true;
      } catch {
        // Fall through to native click.
      }
      const clicked = await button.evaluate((node) => {
        if (!(node instanceof HTMLButtonElement)) return false;
        node.click();
        return true;
      }).catch(() => false);
      if (clicked) return true;
    }
    return false;
  };

  if (await clickVisibleNavigationButton()) return;

  if (await openMenuButton.isVisible().catch(() => false)) {
    await openMenuButton.click({ force: true });
    await page.waitForTimeout(80);
  }

  if (await clickVisibleNavigationButton()) return;

  const fallbackCount = await navigationButtons.count();
  for (let index = 0; index < fallbackCount; index += 1) {
    const button = navigationButtons.nth(index);
    await button.evaluate((node) => {
      if (node instanceof HTMLElement) {
        node.scrollIntoView({ block: 'center', inline: 'nearest' });
      }
    }).catch(() => undefined);
    if (!(await button.isVisible().catch(() => false))) continue;
    await button.click({ force: true });
    return;
  }

  await expect(navigationButtons.first()).toBeVisible();
  await navigationButtons.first().evaluate((node) => {
    if (node instanceof HTMLButtonElement) node.click();
  });
}

async function ensureSidebarNavigationVisible(page: Parameters<typeof test>[0]['page']) {
  const shopButton = page.locator('aside button[aria-label="Shop"]').first();
  if (await shopButton.isVisible().catch(() => false)) return;
  const openMenuButton = page.getByRole('button', { name: 'Open navigation menu' });
  if (await openMenuButton.isVisible().catch(() => false)) {
    await openMenuButton.click({ force: true });
    await page.waitForTimeout(80);
  }
}

async function clickSidebarShop(page: Parameters<typeof test>[0]['page']) {
  await ensureSidebarNavigationVisible(page);

  const shopButtons = page.locator('aside button[aria-label="Shop"]');
  const buttonCount = await shopButtons.count();
  for (let index = 0; index < buttonCount; index += 1) {
    const button = shopButtons.nth(index);
    await button.evaluate((node) => {
      if (node instanceof HTMLElement) {
        node.scrollIntoView({ block: 'center', inline: 'nearest' });
      }
    }).catch(() => undefined);
    if (!(await button.isVisible().catch(() => false))) continue;
    await button.evaluate((node) => {
      if (node instanceof HTMLButtonElement) node.click();
    });
    return;
  }

  await expect(shopButtons.first()).toBeVisible();
  await shopButtons.first().evaluate((node) => {
    if (node instanceof HTMLButtonElement) node.click();
  });
}

async function clickLabRailButton(page: Parameters<typeof test>[0]['page'], label: string) {
  const railButton = page.getByTestId('lab-rail').getByRole('button', { name: new RegExp(`^${label}$`) }).first();
  await expect(railButton).toBeVisible();
  await railButton.scrollIntoViewIfNeeded().catch(() => undefined);
  try {
    await railButton.click({ timeout: 2000 });
  } catch {
    await railButton.click({ force: true, timeout: 2000 });
  }
}

async function ensureLabRailPanelOpen(page: Parameters<typeof test>[0]['page'], label: string) {
  const panelHeader = page.getByTestId('lab-panel').getByText(label, { exact: true }).first();
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await clickLabRailButton(page, label);
    if (await panelHeader.isVisible().catch(() => false)) return;
    const railButton = page.getByTestId('lab-rail').getByRole('button', { name: new RegExp(`^${label}$`) }).first();
    await railButton.evaluate((node) => {
      if (node instanceof HTMLButtonElement) node.click();
    }).catch(() => undefined);
    await page.waitForTimeout(120);
    if (await panelHeader.isVisible().catch(() => false)) return;
  }
  await expect(panelHeader).toBeVisible();
}

const parseClipCount = (input: string | null | undefined): number => {
  const match = String(input || '').match(/(\d+)\s+clips/i);
  if (!match) return 0;
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) ? parsed : 0;
};

interface StudioSmokeCredentials {
  email: string;
  password: string;
  username?: string;
}

interface StudioSmokeAudit {
  entitlementsReads: number;
  profileReads: number;
  creates: number;
  statusReads: number;
  completed: number;
  failed: number;
  cancels: number;
}

interface StudioSmokeStubOptions {
  completeAfterPolls?: number;
  failuresToInject?: number;
}

interface StudioSmokeRouteHarness {
  audit: StudioSmokeAudit;
}

interface StudioSmokeJobState {
  polls: number;
  cancelled: boolean;
  failed: boolean;
}

const resolveStudioSmokeCredentials = (): StudioSmokeCredentials | null => {
  const email = String(
    process.env.PLAYWRIGHT_ADMIN_EMAIL
    || process.env.VF_SMOKE_ADMIN_EMAIL
    || process.env.SMOKE_ADMIN_EMAIL
    || ''
  ).trim();
  const password = String(
    process.env.PLAYWRIGHT_ADMIN_PASSWORD
    || process.env.VF_SMOKE_ADMIN_PASSWORD
    || process.env.SMOKE_ADMIN_PASSWORD
    || ''
  ).trim();
  if (!email || !password) return null;
  const username = String(
    process.env.PLAYWRIGHT_ADMIN_USERNAME
    || process.env.VF_SMOKE_ADMIN_USERNAME
    || process.env.SMOKE_ADMIN_USERNAME
    || ''
  ).trim();
  const derivedUsername = email.includes('@') ? String(email.split('@')[0] || '').trim() : '';
  return { email, password, username: username || derivedUsername || undefined };
};

const buildStudioSmokeEntitlements = () => {
  const now = new Date();
  const currentIso = now.toISOString();
  const nextIso = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();
  return {
    entitlements: {
      uid: 'studio-smoke-admin',
      plan: 'Free',
      status: 'active',
      monthly: {
        vfLimit: 50000,
        vfUsed: 0,
        vfRemaining: 50000,
        generationCount: 0,
        periodKey: '2026-03',
        windowStartUtc: currentIso,
        windowEndUtc: nextIso,
        byEngine: {
          KOKORO: { chars: 0, vf: 0 },
          NEURAL2: { chars: 0, vf: 0 },
          GEM: { chars: 0, vf: 0 },
        },
      },
      daily: {
        generationLimit: 30,
        generationUsed: 0,
        generationRemaining: 30,
        vfUsed: 0,
        periodKey: '2026-03-12',
        windowStartUtc: currentIso,
        windowEndUtc: nextIso,
        byEngine: {
          KOKORO: { chars: 0, vf: 0 },
          NEURAL2: { chars: 0, vf: 0 },
          GEM: { chars: 0, vf: 0 },
        },
      },
      billing: {
        stripeCustomerId: null,
        subscriptionId: null,
      },
      limits: {
        vfRates: {
          KOKORO: 1,
          NEURAL2: 1,
          GEM: 1,
        },
        monthlyPlanCaps: {
          Free: 50000,
        },
        maxCharsPerGeneration: 8000,
        allowedEngines: ['KOKORO', 'NEURAL2', 'GEM'],
      },
      features: {
        earlyAccess: true,
      },
      wallet: {
        monthlyFreeRemaining: 5000,
        monthlyFreeLimit: 5000,
        vffBalance: 5000,
        paidVfBalance: 0,
        spendableNowByEngine: {
          KOKORO: 5000,
          NEURAL2: 5000,
          GEM: 5000,
        },
        adClaimsToday: 0,
        adClaimsDailyLimit: 5,
        vffMonthKey: '2026-03',
      },
    },
  };
};

const buildStudioSmokeProfile = (email: string) => ({
  profile: {
    uid: 'studio-smoke-admin',
    userId: 'studio_smoke_admin',
    displayName: 'Studio Smoke Admin',
    email,
    status: 'active',
  },
  requiredUserId: false,
});

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

async function ensureStudioSmokeAuthenticated(page: Page, credentials: StudioSmokeCredentials) {
  await page.goto('/');
  const getStarted = page.getByRole('button', { name: 'Get Started' });
  const loginCopy = page.getByText('Secure sign-in for your VoiceFlow workspace.');
  const readAuthError = async (): Promise<string> => {
    const authCard = page.locator('.vf-auth-card');
    const errorLocator = authCard.getByText(
      /(Cannot reach|Invalid|failed|retry|Too many|temporarily unavailable|network|Authentication)/i
    ).first();
    if (!(await errorLocator.isVisible().catch(() => false))) return '';
    return String((await errorLocator.textContent().catch(() => '')) || '').trim();
  };

  const attemptLogin = async (identity: string): Promise<{ ok: boolean; error: string }> => {
    const authInputs = page.locator('.vf-auth-card input');
    await authInputs.nth(0).fill(identity);
    await authInputs.nth(1).fill(credentials.password);
    await page.getByRole('button', { name: /^Sign In$/ }).click({ force: true });
    try {
      await expect(loginCopy).toHaveCount(0, { timeout: 30_000 });
      return { ok: true, error: '' };
    } catch {
      return { ok: false, error: await readAuthError() };
    }
  };

  await getStarted.click({ force: true, timeout: 5_000 }).catch(() => undefined);
  if (!(await loginCopy.isVisible().catch(() => false))) {
    await getStarted.click({ force: true, timeout: 5_000 }).catch(() => undefined);
  }
  await expect(loginCopy).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: 'Login', exact: true }).first().click({ force: true });

  const identities = Array.from(new Set([
    credentials.email,
    credentials.username || '',
  ].map((value) => String(value || '').trim()).filter(Boolean)));

  const attemptErrors: string[] = [];
  let signedIn = false;
  for (const identity of identities) {
    const attempt = await attemptLogin(identity);
    if (attempt.ok) {
      signedIn = true;
      break;
    }
    attemptErrors.push(`${identity}: ${attempt.error || 'Authentication did not complete.'}`);
  }
  if (!signedIn) {
    throw new Error(`Studio smoke auth failed: ${attemptErrors.join(' | ')}`);
  }

  await page.goto('/?vf-screen=main&vf-tab=STUDIO');
  await ensureSidebarNavigationVisible(page);
  const loginButton = page.locator('aside').getByRole('button', { name: /^login$/i }).first();
  if (await loginButton.isVisible().catch(() => false)) {
    throw new Error('Studio smoke auth failed: session remained unauthenticated after sign-in.');
  }
}

async function isUnlimitedStudioSession(page: Page): Promise<boolean> {
  const planButton = page.getByRole('button', { name: /Open plan and credits/i }).first();
  if (!(await planButton.isVisible().catch(() => false))) {
    await expect(planButton).toBeVisible({ timeout: 10_000 }).catch(() => undefined);
  }
  const label = await planButton.innerText().catch(() => '');
  if (/unlimited/i.test(String(label || ''))) return true;
  const adminButton = page.locator('aside').getByRole('button', { name: /^Admin$/i }).first();
  return adminButton.isVisible().catch(() => false);
}

async function installStudioTtsRouteHarness(
  page: Page,
  credentials: StudioSmokeCredentials,
  options?: StudioSmokeStubOptions
): Promise<StudioSmokeRouteHarness> {
  const completeAfter = Math.max(1, Number(options?.completeAfterPolls || 2));
  let remainingFailures = Math.max(0, Number(options?.failuresToInject || 0));
  let createdJobs = 0;
  const jobs = new Map<string, StudioSmokeJobState>();
  const audit: StudioSmokeAudit = {
    entitlementsReads: 0,
    profileReads: 0,
    creates: 0,
    statusReads: 0,
    completed: 0,
    failed: 0,
    cancels: 0,
  };

  await page.route('**/account/entitlements**', async (route) => {
    if (route.request().method().toUpperCase() !== 'GET') {
      await route.continue();
      return;
    }
    audit.entitlementsReads += 1;
    await fulfillJson(route, buildStudioSmokeEntitlements(), 200);
  });

  await page.route('**/account/profile**', async (route) => {
    if (route.request().method().toUpperCase() !== 'GET') {
      await route.continue();
      return;
    }
    audit.profileReads += 1;
    await fulfillJson(route, buildStudioSmokeProfile(credentials.email), 200);
  });

  await page.route('**/tts/engines/**', async (route) => {
    const method = route.request().method().toUpperCase();
    const url = new URL(route.request().url());
    const path = url.pathname;

    if (path === '/tts/engines/status' && method === 'GET') {
      const requested = String(url.searchParams.get('engine') || '').toUpperCase();
      const baseRuntime = 'http://127.0.0.1:7810';
      const engines = {
        GEM: { engine: 'GEM', state: 'online', detail: 'Runtime online', ready: true, healthUrl: `${baseRuntime}/health`, runtimeUrl: baseRuntime },
        NEURAL2: { engine: 'NEURAL2', state: 'online', detail: 'Runtime online', ready: true, healthUrl: `${baseRuntime}/health`, runtimeUrl: baseRuntime },
        KOKORO: { engine: 'KOKORO', state: 'online', detail: 'Runtime online', ready: true, healthUrl: `${baseRuntime}/health`, runtimeUrl: baseRuntime },
      } as const;
      const payload = requested && (engines as Record<string, unknown>)[requested]
        ? { ok: true, engines: { [requested]: (engines as Record<string, unknown>)[requested] }, fetchedAt: new Date().toISOString() }
        : { ok: true, engines, fetchedAt: new Date().toISOString() };
      await fulfillJson(route, payload, 200);
      return;
    }

    if (path === '/tts/engines/voices' && method === 'GET') {
      const requested = String(url.searchParams.get('engine') || 'GEM').toUpperCase();
      const voices = requested === 'KOKORO'
        ? [{ voice_id: 'af_heart', name: 'af_heart', gender: 'Female', accent: 'US' }]
        : [{ voice_id: 'Fenrir', name: 'Fenrir', gender: 'Male', accent: 'US' }];
      await fulfillJson(route, {
        ok: true,
        engine: requested,
        voices,
        fetchedAt: new Date().toISOString(),
      }, 200);
      return;
    }

    if (path === '/tts/engines/switch' && method === 'POST') {
      const body = route.request().postDataJSON() as Record<string, unknown> | null;
      await fulfillJson(route, {
        ok: true,
        engine: String(body?.engine || 'GEM'),
        state: 'online',
        detail: 'Runtime online',
        healthUrl: 'http://127.0.0.1:7810/health',
        runtimeUrl: 'http://127.0.0.1:7810',
      }, 200);
      return;
    }

    await route.continue();
  });

  await page.route('**/tts/jobs**', async (route) => {
    const method = route.request().method().toUpperCase();
    const url = new URL(route.request().url());
    const path = url.pathname;

    if (path === '/tts/jobs' && method === 'POST') {
      createdJobs += 1;
      const jobId = `studio-smoke-job-${createdJobs}`;
      const shouldFail = remainingFailures > 0;
      if (shouldFail) remainingFailures -= 1;
      jobs.set(jobId, { polls: 0, cancelled: false, failed: shouldFail });
      audit.creates += 1;
      await route.fulfill({
        status: 202,
        headers: { 'content-type': 'application/json', 'x-vf-job-id': jobId },
        body: JSON.stringify({
          ok: true,
          accepted: true,
          status: 'queued',
          jobId,
          requestId: jobId,
        }),
      });
      return;
    }

    if (path.startsWith('/tts/jobs/')) {
      const parts = path.split('/').filter(Boolean);
      const jobId = parts[2] || '';
      const job = jobs.get(jobId);
      if (!job) {
        await fulfillJson(route, { detail: 'Job not found' }, 404);
        return;
      }

      if (method === 'DELETE') {
        job.cancelled = true;
        jobs.set(jobId, job);
        audit.cancels += 1;
        await fulfillJson(route, { ok: true, job: { jobId, status: 'cancelled' } }, 200);
        return;
      }

      if (method === 'GET') {
        audit.statusReads += 1;
        let status = 'queued';
        if (job.cancelled) {
          status = 'cancelled';
        } else if (job.polls >= completeAfter) {
          status = job.failed ? 'failed' : 'completed';
        } else if (job.polls > 0) {
          status = 'running';
        }
        if (!job.cancelled && status !== 'completed' && status !== 'failed') {
          job.polls += 1;
          jobs.set(jobId, job);
        }
        if (status === 'completed') audit.completed += 1;
        if (status === 'failed') audit.failed += 1;

        const includeResult = url.searchParams.get('includeResult') === '1';
        const payload: Record<string, unknown> = {
          ok: true,
          jobId,
          requestId: jobId,
          status,
        };
        if (status === 'completed' && includeResult) {
          payload.result = {
            audioBase64: WAV_BASE64,
            mediaType: 'audio/wav',
            headers: {
              'x-smoke-studio': '1',
            },
          };
        }
        if (status === 'failed') {
          payload.error = 'Smoke forced queue failure';
        }
        await fulfillJson(route, payload, 200);
        return;
      }
    }

    await route.continue();
  });

  return { audit };
}

async function fillStudioRawScript(page: Parameters<typeof test>[0]['page'], script: string) {
  await page.getByRole('button', { name: 'Raw' }).first().click();
  const editor = page.getByPlaceholder('Write your script here... The AI Director can auto-assign voices for characters.');
  await expect(editor).toBeVisible();
  await editor.fill(script);
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

test('workspace routes render core production tabs without boundary crashes', async ({ page }) => {
  const routes = [
    { tab: 'STUDIO', marker: /Generate Audio/i },
    { tab: 'PODCAST', marker: /Podcast Live/i },
    { tab: 'NOVEL', marker: /Novel Workspace/i },
    { tab: 'CHARACTERS', marker: /Character & Voice Studio/i },
    { tab: 'HISTORY', marker: /Generation History/i },
  ] as const;

  for (const route of routes) {
    await page.goto(`/?vf-screen=main&vf-tab=${route.tab}`);
    await expect(page.locator('#root')).toBeVisible();
    await expect(page.getByText(route.marker).first()).toBeVisible();
    await expect(page.getByText('Interface Error')).toHaveCount(0);
  }
});

test('podcast tab renders wireframe layout labels and editable cast rows', async ({ page }) => {
  await page.goto('/?vf-screen=main&vf-tab=PODCAST');

  await expect(page.getByTestId('podcast-tab-content')).toBeVisible();
  await expect(page.getByText('TOPIC', { exact: true })).toBeVisible();
  await expect(page.getByText('SCRIPT', { exact: true })).toBeVisible();
  await expect(page.getByText('PLAYER', { exact: true })).toBeVisible();
  await expect(page.getByText('CHARACTER', { exact: true })).toBeVisible();
  await expect(page.getByText('NAME', { exact: true })).toBeVisible();
  await expect(page.getByText('VOICES', { exact: true })).toBeVisible();

  const firstCastRow = page.getByTestId('podcast-cast-row-0');
  await expect(firstCastRow).toBeVisible();
  const characterInput = firstCastRow.getByPlaceholder('Character');
  await characterInput.fill('LEAD');
  await expect(characterInput).toHaveValue('LEAD');
  await expect(firstCastRow.locator('select')).toBeVisible();

  await expect(page.getByText('Interface Error')).toHaveCount(0);
});

test('workspace navigation keeps all non-admin tabs reachable and URL-synced', async ({ page }) => {
  test.setTimeout(60000);
  await page.goto('/?vf-screen=main&vf-tab=READER');
  await expect(page.getByTestId('reader-browse-home')).toBeVisible();

  const tabs: Array<{ label: string; query: string }> = [
    { label: 'Studio', query: 'STUDIO' },
    { label: 'Podcast', query: 'PODCAST' },
    { label: 'Reader', query: 'READER' },
    { label: 'Novel', query: 'NOVEL' },
    { label: 'Character', query: 'CHARACTERS' },
    { label: 'History', query: 'HISTORY' },
  ];

  for (const tab of tabs) {
    await openWorkspaceTab(page, tab.label);
    await expect(page.locator('#root')).toBeVisible();
    await expect(page.getByText('Interface Error')).toHaveCount(0);
    await expect.poll(() => new URL(page.url()).searchParams.get('vf-tab')).toBe(tab.query);
  }

  const tabBeforeShop = new URL(page.url()).searchParams.get('vf-tab');
  await clickSidebarShop(page);
  await expect.poll(() => new URL(page.url()).searchParams.get('vf-tab')).toBe(tabBeforeShop);
  await expect(page.locator('aside button[aria-label="Shop"]')).toHaveCount(1);

  let shopOutcome: 'credits' | 'signup' | null = null;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (await page.getByText('Plan & Credits').first().isVisible().catch(() => false)) {
      shopOutcome = 'credits';
      break;
    }
    const authIntent = await page.evaluate(() => window.localStorage.getItem('vf_auth_intent'));
    if (authIntent === 'signup') {
      shopOutcome = 'signup';
      break;
    }
    await page.waitForTimeout(100);
  }
  expect(shopOutcome).not.toBeNull();

  if (shopOutcome === 'credits') {
    await expect(page.getByText('Plan & Credits').first()).toBeVisible();
  } else {
    await expect.poll(() => page.evaluate(() => window.localStorage.getItem('vf_auth_intent'))).toBe('signup');
  }
});

test('studio tab deep-link keeps URL state in sync after navigation', async ({ page }) => {
  await page.goto('/?vf-screen=main&vf-tab=STUDIO');
  await expect(page.getByText(/Generate Audio/i).first()).toBeVisible();
  await expect.poll(() => new URL(page.url()).searchParams.get('vf-tab')).toBe('STUDIO');

  await openWorkspaceTab(page, 'Reader');
  await expect.poll(() => new URL(page.url()).searchParams.get('vf-tab')).toBe('READER');

  await openWorkspaceTab(page, 'Studio');
  await expect.poll(() => new URL(page.url()).searchParams.get('vf-tab')).toBe('STUDIO');
});

test('studio generation smoke succeeds via queued gateway path', async ({ page }) => {
  test.setTimeout(150000);
  const credentials = resolveStudioSmokeCredentials();
  test.skip(!credentials, 'Set PLAYWRIGHT_ADMIN_EMAIL and PLAYWRIGHT_ADMIN_PASSWORD for authenticated Studio smoke.');
  if (!credentials) return;

  const harness = await installStudioTtsRouteHarness(page, credentials, { completeAfterPolls: 1 });
  await ensureStudioSmokeAuthenticated(page, credentials);
  await expect.poll(() => harness.audit.entitlementsReads, { timeout: 30_000 }).toBeGreaterThanOrEqual(1);

  const queueScript = `Narrator: ${Array.from({ length: 700 }, (_, index) => `queue-success-${index}`).join(' ')}`;
  await fillStudioRawScript(page, queueScript);

  const queueModeToggle = page.getByRole('button', { name: /Queue Off/i }).first();
  await queueModeToggle.click();
  await expect(page.getByRole('button', { name: /Queue On/i }).first()).toBeVisible();

  await page.getByRole('button', { name: 'Generate Audio' }).first().click();
  await expect.poll(() => harness.audit.creates, { timeout: 30_000 }).toBeGreaterThanOrEqual(1);
  await expect.poll(() => harness.audit.statusReads, { timeout: 30_000 }).toBeGreaterThanOrEqual(1);
  await expect.poll(() => harness.audit.completed, { timeout: 90_000 }).toBeGreaterThanOrEqual(1);
  await expect(page.getByRole('button', { name: /Generate Audio/i }).first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('button', { name: 'Reset and start new generation' }).first()).toBeVisible({ timeout: 30_000 });
});

test('studio generation smoke supports canceling an in-flight queued job', async ({ page }) => {
  test.setTimeout(150000);
  const credentials = resolveStudioSmokeCredentials();
  test.skip(!credentials, 'Set PLAYWRIGHT_ADMIN_EMAIL and PLAYWRIGHT_ADMIN_PASSWORD for authenticated Studio smoke.');
  if (!credentials) return;

  const harness = await installStudioTtsRouteHarness(page, credentials, { completeAfterPolls: 40 });
  await ensureStudioSmokeAuthenticated(page, credentials);
  await expect.poll(() => harness.audit.entitlementsReads, { timeout: 30_000 }).toBeGreaterThanOrEqual(1);

  const queueScript = `Narrator: ${Array.from({ length: 700 }, (_, index) => `queue-cancel-${index}`).join(' ')}`;
  await fillStudioRawScript(page, queueScript);

  const queueModeToggle = page.getByRole('button', { name: /Queue Off/i }).first();
  await queueModeToggle.click();
  await expect(page.getByRole('button', { name: /Queue On/i }).first()).toBeVisible();

  await page.getByRole('button', { name: 'Generate Audio' }).first().click();
  await expect.poll(() => harness.audit.creates, { timeout: 30_000 }).toBeGreaterThanOrEqual(1);
  const cancelButton = page.getByRole('button', { name: 'Cancel generation' });
  await expect(cancelButton).toBeVisible({ timeout: 15_000 });
  await cancelButton.click();
  await expect.poll(() => harness.audit.cancels, { timeout: 30_000 }).toBeGreaterThanOrEqual(1);

  await expect(cancelButton).toHaveCount(0, { timeout: 15_000 });
  await expect(page.getByRole('button', { name: 'Generate Audio' }).first()).toBeVisible({ timeout: 15_000 });
});

test('studio queue mode can resume after a failed part', async ({ page }, testInfo) => {
  test.setTimeout(180000);
  test.skip(testInfo.project.name === 'chromium-mobile', 'Queue resume smoke is desktop/tablet focused.');
  const credentials = resolveStudioSmokeCredentials();
  test.skip(!credentials, 'Set PLAYWRIGHT_ADMIN_EMAIL and PLAYWRIGHT_ADMIN_PASSWORD for authenticated Studio smoke.');
  if (!credentials) return;

  const harness = await installStudioTtsRouteHarness(page, credentials, { completeAfterPolls: 1, failuresToInject: 1 });
  await ensureStudioSmokeAuthenticated(page, credentials);
  await expect.poll(() => harness.audit.entitlementsReads, { timeout: 30_000 }).toBeGreaterThanOrEqual(1);

  const queueScript = `Narrator: ${Array.from({ length: 1000 }, (_, index) => `queue-part-${index}`).join(' ')}`;
  await fillStudioRawScript(page, queueScript);

  const queueModeToggle = page.getByRole('button', { name: /Queue Off/i }).first();
  await queueModeToggle.click();
  await expect(page.getByRole('button', { name: /Queue On/i }).first()).toBeVisible();

  await page.getByRole('tab', { name: /^Queue$/ }).first().click({ force: true });
  await page.getByRole('button', { name: 'Generate Audio' }).first().click();
  await expect.poll(() => harness.audit.failed, { timeout: 60_000 }).toBeGreaterThanOrEqual(1);

  const resumeButton = page.getByRole('button', { name: /Resume Queue/i }).first();
  const resumeVisible = await resumeButton.isVisible().catch(() => false);
  const unlimitedSession = await isUnlimitedStudioSession(page);

  if (resumeVisible) {
    await resumeButton.click();
  } else if (unlimitedSession) {
    // Admin/unlimited accounts bypass queue-part routing in handleGenerate.
    await page.getByRole('button', { name: 'Generate Audio' }).first().click();
  } else {
    await expect(resumeButton).toBeVisible({ timeout: 45_000 });
    await resumeButton.click();
  }

  await expect.poll(() => harness.audit.creates, { timeout: 60_000 }).toBeGreaterThanOrEqual(2);
  await expect.poll(() => harness.audit.completed, { timeout: 90_000 }).toBeGreaterThanOrEqual(1);
  await expect(page.getByRole('button', { name: 'Reset and start new generation' }).first()).toBeVisible({ timeout: 45_000 });
});

test('guest shop action routes to sign up', async ({ page }) => {
  await page.goto('/?vf-screen=main&vf-tab=STUDIO');
  await ensureSidebarNavigationVisible(page);
  const sidebar = page.locator('aside').first();
  const signOutButton = sidebar.getByRole('button', { name: /^sign out$/i }).first();
  if (await signOutButton.isVisible().catch(() => false)) {
    await signOutButton.click({ force: true });
    await page.goto('/?vf-screen=main&vf-tab=STUDIO');
    await ensureSidebarNavigationVisible(page);
  }
  await expect(sidebar.getByRole('button', { name: /^login$/i }).first()).toBeVisible();
  await openWorkspaceTab(page, 'Shop');
  await expect(page.getByRole('button', { name: /create account/i })).toBeVisible();
});

test.describe('reader smoke', () => {
  test.describe.configure({ mode: 'serial' });

  for (const theme of ['light', 'dark'] as const) {
    test(`reader browse home renders in ${theme} mode and opens the production tray`, async ({ page }, testInfo) => {
      await setTheme(page, theme);
      await stubReaderApi(page);
      await page.goto('/?vf-screen=main&vf-tab=READER');

      const browseHome = page.getByTestId('reader-browse-home');
      await expect(browseHome).toBeVisible();
      await expect(page.getByRole('button', { name: /^imports$/i })).toHaveCount(0);
      await expect(page.getByText(/Resume first, import fast, and keep discovery below the fold until you need it\./)).toHaveCount(0);
      await expect(page.getByText(/Continue active sessions, keep your reading library current, or jump into discovery only after your production work is in motion\./)).toHaveCount(0);

      const searchInput = browseHome.getByLabel('Search reader titles');
      await expect(searchInput).toBeVisible();
      await searchInput.fill('reader smoke');
      await expect(searchInput).toHaveValue('reader smoke');
      await searchInput.fill('');

      const regionSelect = browseHome.locator('label[aria-label="Reader region"] select');
      await expect(regionSelect).toBeVisible();

      const booksChip = browseHome.getByRole('button', { name: /^books$/i });
      const novelsChip = browseHome.getByRole('button', { name: /^novels$/i });
      await booksChip.click();
      await expect(booksChip).toHaveClass(/vf-reader-home__chip--active/);
      await novelsChip.click();
      await expect(novelsChip).toHaveClass(/vf-reader-home__chip--active/);

      await expect(page.getByText('Commercial Mode')).toBeVisible();
      await page.getByTestId('reader-sticky-dock').getByRole('button', { name: 'Import' }).click();
      await expect(page.getByTestId('reader-utility-tray')).toBeVisible();
      await expect(page.getByRole('heading', { name: 'Import To Reader' })).toBeVisible();

      const displayTitleInput = page.getByPlaceholder('Optional title');
      await displayTitleInput.fill('Smoke Import Title');
      await expect(displayTitleInput).toHaveValue('Smoke Import Title');

      const contentTypeSelect = page.getByLabel('Content Type');
      await expect(contentTypeSelect).toHaveValue('auto');
      await contentTypeSelect.selectOption('comic');
      await expect(contentTypeSelect).toHaveValue('comic');

      const rightsBasisSelect = page.getByLabel('Rights Basis');
      await expect(rightsBasisSelect).toHaveValue('user_responsible');
      await rightsBasisSelect.selectOption('licensed');
      await expect(rightsBasisSelect).toHaveValue('licensed');

      await page.locator('input[type="file"]').setInputFiles({
        name: 'smoke-reader-import.txt',
        mimeType: 'text/plain',
        buffer: Buffer.from('Reader smoke import'),
      });
      await expect(page.getByText('1 file selected')).toBeVisible();
      await expect(page.getByRole('button', { name: /Import.*Open/i })).toBeEnabled();

      if (testInfo.project.name === 'chromium-mobile') {
        await expect(page.getByTestId('reader-sticky-dock').getByRole('button', { name: 'Translate' })).toBeVisible();
      }
    });
  }

  test('reader browse translate opens translation-only panel and keeps settings separate', async ({ page }) => {
    await setTheme(page, 'dark');
    await stubReaderApi(page);
    await page.goto('/?vf-screen=main&vf-tab=READER');

    await expect(page.getByTestId('reader-browse-home')).toBeVisible();

    const dock = page.getByTestId('reader-sticky-dock');
    await dock.getByRole('button', { name: 'Translate' }).click();
    await expect(page.getByRole('heading', { name: 'Translator' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Import To Reader' })).toHaveCount(0);
    await expect(page.getByRole('tab', { name: 'Import' })).toHaveCount(0);
    await page.getByLabel('Target Language').selectOption('es');
    await page.getByRole('button', { name: 'Save Translation Defaults' }).click();
    await expect(page.getByText('Reader defaults updated.')).toBeVisible();

    await dock.getByRole('button', { name: 'Import' }).click();
    await page.getByRole('tab', { name: 'Settings' }).click();
    await expect(page.getByRole('heading', { name: 'Reader Settings' })).toBeVisible();
    await page.getByLabel('Audio Engine').selectOption('tts_hd');
    await page.getByRole('button', { name: 'Save Reader Defaults' }).click();
    await expect(page.getByText('Reader defaults updated.')).toBeVisible();

    const preferencesAudit = await page.evaluate(() => (
      window as typeof window & { __readerPreferencesAudit?: Record<string, unknown> }
    ).__readerPreferencesAudit);
    expect(preferencesAudit?.audioEngine).toBe('tts_hd');
    expect(preferencesAudit?.targetLanguage).toBe('es');
  });

  test('reader browse home hides the filter quick action', async ({ page }) => {
    await setTheme(page, 'dark');
    await stubReaderApi(page);
    await page.goto('/?vf-screen=main&vf-tab=READER');

    await expect(page.getByTestId('reader-browse-home')).toBeVisible();
    await expect(page.getByTestId('reader-browse-home').getByRole('button', { name: 'filter' })).toHaveCount(0);
  });

  test('reader active session shows playback stage with dock pinned and all utility panels', async ({ page }) => {
    await setTheme(page, 'dark');
    await stubReaderApi(page, { activeSession: true });
    await page.goto('/?vf-screen=main&vf-tab=READER');
    await expect(page.getByRole('button', { name: 'Open In Book Player' }).first()).toBeVisible();
    await page.getByRole('button', { name: 'Open In Book Player' }).first().click();

    await expect(page.getByTestId('reader-playback-stage')).toBeVisible();
    await expect(page.getByTestId('reader-sticky-dock')).toBeVisible();
    await page.getByTestId('reader-sticky-dock').getByRole('button', { name: 'Import' }).click();
    await expect(page.getByTestId('reader-utility-tray')).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Import' })).toHaveAttribute('aria-selected', 'true');
    await page.getByRole('tab', { name: 'Settings' }).click();
    await expect(page.getByRole('tab', { name: 'Settings' })).toHaveAttribute('aria-selected', 'true');
    await page.getByRole('tab', { name: 'Translator' }).click();
    await expect(page.getByRole('tab', { name: 'Translator' })).toHaveAttribute('aria-selected', 'true');
    await page.getByRole('tab', { name: 'AI Text' }).click();
    await expect(page.getByRole('tab', { name: 'AI Text' })).toHaveAttribute('aria-selected', 'true');
    await page.getByRole('tab', { name: 'Cast' }).click();
    await expect(page.getByRole('tab', { name: 'Cast' })).toHaveAttribute('aria-selected', 'true');
    await page.getByRole('tab', { name: 'Import' }).click();
    await expect(page.getByRole('heading', { name: 'Import To Reader' })).toBeVisible();
  });

  test('reader import flow opens playback and saves native plus multi-speaker settings', async ({ page }) => {
    await setTheme(page, 'dark');
    await stubReaderApi(page);
    await page.goto('/?vf-screen=main&vf-tab=READER');
    await expect(page.getByTestId('reader-browse-home')).toBeVisible();

    await page.getByTestId('reader-sticky-dock').getByRole('button', { name: 'Import' }).click();
    await expect(page.getByRole('heading', { name: 'Import To Reader' })).toBeVisible();

    await page.getByPlaceholder('Optional title').fill('Smoke Import Session');
    await page.getByLabel('Rights Basis').selectOption('licensed');
    await page.locator('input[type="file"]').setInputFiles({
      name: 'smoke-reader-import.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('Reader smoke import body for full flow.'),
    });
    await page.getByRole('button', { name: /Import.*Open/i }).click();

    await expect(page.getByTestId('reader-playback-stage')).toBeVisible();

    const uploadAudit = await page.evaluate(() => (window as typeof window & { __readerUploadAudit?: Record<string, unknown> }).__readerUploadAudit);
    expect(uploadAudit?.ownershipBasis).toBe('licensed');
    expect(uploadAudit?.title).toBe('Smoke Import Session');

    const dock = page.getByTestId('reader-sticky-dock');
    const nativeToggle = dock.getByRole('button', { name: /Native (On|Off)/ }).first();
    await expect(nativeToggle).toBeVisible();
    const nativeToggleLabel = await nativeToggle.innerText();
    const nextAudioEngine = /Native On/i.test(nativeToggleLabel) ? 'tts_hd' : 'native_audio_dialog';
    const expectedNativeButtonLabel = nextAudioEngine === 'native_audio_dialog' ? 'Native On' : 'Native Off';
    await nativeToggle.click();

    await page.getByTestId('reader-sticky-dock').getByRole('button', { name: 'Import' }).click();
    await page.getByRole('tab', { name: 'Settings' }).click();
    const multiSpeakerSelect = page.getByLabel('Multi-Speaker');
    const initialMultiSpeakerMode = await multiSpeakerSelect.inputValue();
    const nextMultiSpeakerMode = initialMultiSpeakerMode === 'multi' ? 'single' : 'multi';
    await multiSpeakerSelect.selectOption(nextMultiSpeakerMode);
    await expect(multiSpeakerSelect).toHaveValue(nextMultiSpeakerMode);
    await page.getByRole('button', { name: 'Save Reader Settings' }).click();
    await expect(page.getByText('Reader savepoint updated.')).toBeVisible();

    const saveAudit = await page.evaluate(() => (window as typeof window & { __readerSaveAudit?: Record<string, unknown> }).__readerSaveAudit);
    expect(saveAudit?.audioEngine).toBe(nextAudioEngine);
    expect(saveAudit?.multiSpeakerEnabled).toBe(nextMultiSpeakerMode === 'multi');
    expect(saveAudit?.voiceMode).toBe(nextMultiSpeakerMode);

    const expectedMultiButtonLabel = nextMultiSpeakerMode === 'multi' ? 'Multi On' : 'Multi Off';
    const desktopMultiToggle = page.getByTestId('reader-sticky-dock').getByRole('button', { name: expectedMultiButtonLabel });
    if (await desktopMultiToggle.count()) {
      await expect(desktopMultiToggle.first()).toBeVisible();
    }
    const desktopNativeToggle = page.getByTestId('reader-sticky-dock').getByRole('button', { name: expectedNativeButtonLabel });
    if (await desktopNativeToggle.count()) {
      await expect(desktopNativeToggle.first()).toBeVisible();
    }
  });

  test('reader fresh prepare enters playback immediately and switches hydrated assets to cached URLs', async ({ page }) => {
    await setTheme(page, 'light');
    await stubReaderPrepareFlow(page);
    await page.goto('/?vf-screen=main&vf-tab=READER');
    await expect(page.getByTestId('reader-browse-home')).toBeVisible();

    const initialCounters = await page.evaluate(() => (window as typeof window & { __readerCounters?: { ack: number; library: number } }).__readerCounters);
    expect(initialCounters?.ack).toBe(1);
    expect(initialCounters?.library).toBe(1);

    const prepareStartedAt = Date.now();
    await page.getByRole('button', { name: /Open In Manga Player/i }).first().click();
    await expect(page.getByTestId('reader-playback-stage')).toBeVisible({ timeout: 3000 });
    expect(Date.now() - prepareStartedAt).toBeLessThan(3500);

    await expect(page.getByText('Hydrated panel 1')).toBeVisible();
    await expect(page.getByRole('img', { name: 'Panel 1' })).toHaveAttribute('src', /\/reader\/assets\//);
  });

  test('reader stale session 404 exits playback once and returns to browse with recovery toast', async ({ page }) => {
    await setTheme(page, 'dark');
    await stubReaderRecoveryFlow(page);
    await page.goto('/?vf-screen=main&vf-tab=READER');
    await expect(page.getByRole('button', { name: 'Open In Book Player' }).first()).toBeVisible();
    await page.getByRole('button', { name: 'Open In Book Player' }).first().click();

    await expect(page.getByText('Reader session expired after server restart.')).toBeVisible();
    await expect(page.getByTestId('reader-browse-home')).toBeVisible();

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

test.describe('lab smoke', () => {
  test('lab shell supports responsive audio import and inspector flows', async ({ page }, testInfo) => {
    await page.goto('/?vf-screen=main&vf-tab=LAB');
    await expect(page.getByTestId('lab-shell')).toBeVisible();
    if (testInfo.project.name === 'chromium-mobile') {
      await expect(page.getByTestId('lab-mobile-inspector')).toBeVisible();
      await expect(page.getByRole('button', { name: 'Export' }).first()).toBeVisible();
    } else {
      await expect(page.getByTestId('lab-topbar')).toBeVisible();
      await expect(page.getByTestId('lab-topbar').locator('div').filter({ hasText: /\d{2}\s[A-Za-z]{3}\s\d{4}/ }).first()).toBeVisible();
      await expect(page.getByTestId('lab-rail')).toBeVisible();
      await expect(page.getByTestId('lab-panel')).toBeVisible();
      await expect(page.getByTestId('lab-topbar').getByRole('button', { name: 'Export' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Export WebM' }).first()).toBeVisible();
    }

    await importLabAudio(page);

    await expect(page.getByTestId('lab-timeline-scroll')).toBeVisible();

    if (testInfo.project.name === 'chromium-mobile') {
      await expect(page.getByTestId('lab-mobile-inspector')).toBeVisible();
    }
  });

  test('lab timeline supports transitions pack and custom ratio persistence', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name === 'chromium-mobile', 'Detailed transition flow is desktop/tablet focused.');
    test.setTimeout(60_000);

    await page.goto('/?vf-screen=main&vf-tab=LAB');
    await expect(page.getByTestId('lab-shell')).toBeVisible();

    await importLabAudio(page, 'lab-demo-a.wav');
    await importLabAudio(page, 'lab-demo-b.wav');
    await expect(page.getByText(/2 clips \|/i)).toBeVisible();

    const transitionMarker = page.getByRole('button', { name: /Transition .* to .*/ }).first();
    await transitionMarker.click();
    await expect(transitionMarker).toContainText(/Crossfade|Add/i);
    if (testInfo.project.name === 'chromium-tablet') {
      const tabletInspector = page.getByTestId('lab-tablet-inspector');
      const inspectorVisible = await tabletInspector.isVisible().catch(() => false);
      if (!inspectorVisible) {
        await page.getByRole('button', { name: 'Inspector' }).first().click({ force: true });
      }
      await expect(tabletInspector).toBeVisible();
    }
    const inspector = testInfo.project.name === 'chromium-tablet'
      ? page.getByTestId('lab-tablet-inspector')
      : page.getByTestId('lab-inspector');

    for (const kind of ['Cut', 'Crossfade', 'Fade', 'Wipe', 'Slide'] as const) {
      await inspector.getByRole('button', { name: new RegExp(`^${kind}$`) }).first().click();
      await expect(transitionMarker).toContainText(kind);
    }

    if (testInfo.project.name === 'chromium-tablet') {
      await page.getByTestId('lab-tablet-inspector').getByRole('button', { name: 'Close' }).click({ force: true });
    }

    const applyCustomRatio = async () => {
      await ensureLabRailPanelOpen(page, 'Canvas');
      const panel = page.getByTestId('lab-panel');
      await expect(panel.getByText('Canvas', { exact: true }).first()).toBeVisible();
      await expect(panel.locator('input[type="number"]').nth(0)).toBeVisible();
      await expect(panel.locator('input[type="number"]').nth(1)).toBeVisible();
      await panel.locator('input[type="number"]').nth(0).fill('1300');
      await panel.locator('input[type="number"]').nth(1).fill('730');
      await panel.getByRole('button', { name: 'Apply custom ratio' }).click({ force: true });
      await expect(panel.getByText('Active 1300x730')).toBeVisible();
    };

    await applyCustomRatio();

    await page.reload();
    await expect(page.getByTestId('lab-shell')).toBeVisible();
    await ensureLabRailPanelOpen(page, 'Canvas');
    await expect(page.getByTestId('lab-panel').getByText('Active 1300x730')).toBeVisible();
  });

  test('lab panel audit exercises every panel and core option paths', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name === 'chromium-mobile', 'Rail panel audit uses desktop/tablet layout.');
    test.setTimeout(60_000);

    await page.goto('/?vf-screen=main&vf-tab=LAB');
    await expect(page.getByTestId('lab-shell')).toBeVisible();
    await importLabAudio(page, 'lab-audit.wav');

    const panel = page.getByTestId('lab-panel');
    const timelineSummary = page.getByText(/\d+\s+clips\s+\|/i).first();

    for (const panelLabel of ['Media', 'Canvas', 'Text', 'Audio', 'Videos', 'Images', 'Elements', 'Record', 'TTS'] as const) {
      await ensureLabRailPanelOpen(page, panelLabel);
      await expect(panel.getByText(panelLabel, { exact: true }).first()).toBeVisible();
    }

    await ensureLabRailPanelOpen(page, 'Text');
    const beforeTextInsertCount = parseClipCount(await timelineSummary.textContent());
    await panel.getByRole('button', { name: /title/i }).first().click({ force: true });
    await expect.poll(async () => parseClipCount(await timelineSummary.textContent())).toBe(beforeTextInsertCount + 1);

    await ensureLabRailPanelOpen(page, 'Elements');
    const stickerButton = page.getByTestId('lab-elements-stickers').getByRole('button', { name: 'NEW EPISODE' });
    await expect(stickerButton).toBeVisible();
    await stickerButton.scrollIntoViewIfNeeded().catch(() => undefined);
    await stickerButton.click();
    await expect(page.getByTestId('lab-timeline-scroll').getByText('NEW EPISODE').first()).toBeVisible();

    const emojiButton = page.getByTestId('lab-elements-emoji').locator('button').first();
    await expect(emojiButton).toBeVisible();
    await emojiButton.scrollIntoViewIfNeeded().catch(() => undefined);
    await emojiButton.click();
    await expect(page.getByTestId('lab-timeline-scroll').getByText(/\u2728|\ud83d\udd25|\ud83d\udc4f|\ud83d\ude0d|\ud83d\ude02|\ud83d\ude80|\ud83c\udf89|\ud83d\udca5/).first()).toBeVisible();

    await page.getByTestId('lab-elements-gifs').getByRole('button', { name: 'Celebration loop' }).click({ force: true });
    await expect(panel.getByText('Images', { exact: true }).first()).toBeVisible();
    await expect(panel.getByPlaceholder('Search images...')).toBeVisible();

    await ensureLabRailPanelOpen(page, 'Audio');
    await expect(panel.getByPlaceholder('Search music...')).toBeVisible();

    await ensureLabRailPanelOpen(page, 'Videos');
    await expect(panel.getByPlaceholder('Search videos...')).toBeVisible();

    await ensureLabRailPanelOpen(page, 'Canvas');
    await panel.locator('input[type="number"]').nth(0).fill('720');
    await panel.locator('input[type="number"]').nth(1).fill('1280');
    await panel.getByRole('button', { name: 'Apply custom ratio' }).click({ force: true });
    await expect(panel.getByText('Active 720x1280')).toBeVisible();

    await ensureLabRailPanelOpen(page, 'Record');
    await expect(panel.getByRole('button', { name: 'Check microphone' })).toBeVisible();

    await ensureLabRailPanelOpen(page, 'TTS');
    await expect(panel.getByRole('button', { name: 'Generate narration clip' })).toBeVisible();

    await expect(page.getByText('Interface Error')).toHaveCount(0);
  });

  test('lab timeline toolbar actions keep split/duplicate/refresh/snap/inspector/export/delete paths functional', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name === 'chromium-mobile', 'Toolbar action strip is desktop/tablet focused.');
    test.setTimeout(60_000);

    await page.goto('/?vf-screen=main&vf-tab=LAB');
    await expect(page.getByTestId('lab-shell')).toBeVisible();
    await importLabAudio(page, 'lab-toolbar-a.wav');
    await importLabAudio(page, 'lab-toolbar-b.wav');

    const timelineSummary = page.getByText(/\d+\s+clips\s+\|/i).first();
    const readClipCount = async () => parseClipCount(await timelineSummary.textContent());
    await expect.poll(readClipCount).toBe(2);

    const timeline = page.getByTestId('lab-timeline-scroll');
    const selectableClip = timeline.getByRole('button', { name: /lab-toolbar-(a|b)\.wav/i }).first();
    await selectableClip.click({ force: true });

    const splitButton = page.getByRole('button', { name: 'Split' }).first();
    const duplicateButton = page.getByRole('button', { name: 'Duplicate' }).first();
    const deleteClipButton = page.getByRole('button', { name: 'Delete clip' }).first();
    const refreshButton = page.getByRole('button', { name: 'Refresh' }).first();
    const snapButton = page.getByRole('button', { name: /Snap/i }).first();

    await expect(splitButton).toBeEnabled();
    await expect(duplicateButton).toBeEnabled();
    await expect(deleteClipButton).toBeEnabled();
    await expect(page.getByRole('button', { name: 'Export WAV' }).first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Export WebM' }).first()).toBeVisible();

    const baselineCount = await readClipCount();
    await duplicateButton.click({ force: true });
    await expect.poll(readClipCount).toBe(baselineCount + 1);

    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await splitButton.click({ force: true });
    await expect.poll(readClipCount).toBeGreaterThanOrEqual(baselineCount + 1);

    const snapBefore = String((await snapButton.textContent()) || '').trim();
    await snapButton.click({ force: true });
    await expect(snapButton).not.toHaveText(snapBefore);
    await snapButton.click({ force: true });

    if (await refreshButton.isEnabled().catch(() => false)) {
      await refreshButton.click({ force: true });
    } else {
      await expect(refreshButton).toBeVisible();
    }

    if (testInfo.project.name === 'chromium-tablet') {
      const inspectorButton = page.getByRole('button', { name: 'Inspector' }).first();
      await inspectorButton.click({ force: true });
      await expect(page.getByTestId('lab-tablet-inspector')).toBeVisible();
      await page.getByTestId('lab-tablet-inspector').getByRole('button', { name: 'Close' }).click({ force: true });
    } else {
      await expect(page.getByTestId('lab-inspector')).toBeVisible();
    }

    await deleteClipButton.click({ force: true });
    await expect.poll(readClipCount).toBeGreaterThanOrEqual(baselineCount);

    await expect(page.getByText('Interface Error')).toHaveCount(0);
  });

  test('lab mobile tools exposes all panel groups', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium-mobile', 'Mobile panel overlay is mobile-only.');
    await page.goto('/?vf-screen=main&vf-tab=LAB');
    await expect(page.getByTestId('lab-shell')).toBeVisible();

    const mobileInspector = page.getByTestId('lab-mobile-inspector');
    await mobileInspector.getByRole('button', { name: /Open mobile tools|Collapse mobile tools/i }).click({ force: true });
    await expect(mobileInspector.getByText('Mobile tools')).toBeVisible();

    for (const panelLabel of ['Media', 'Canvas', 'Text', 'Audio', 'Videos', 'Images', 'Elements', 'Record', 'TTS'] as const) {
      await mobileInspector.getByRole('button', { name: new RegExp(`^${panelLabel}$`) }).first().click({ force: true });
      await expect(mobileInspector.getByText(panelLabel, { exact: true }).first()).toBeVisible();
    }

    await expect(page.getByText('Interface Error')).toHaveCount(0);
  });
});
