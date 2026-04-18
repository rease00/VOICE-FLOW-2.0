import { expect, test, type Page, type Request } from '@playwright/test';
import { ensureStudioSmokeAuthenticated, resolveStudioSmokeCredentials } from './smokeAuth';

const ROUTE_TIMEOUT_MS = 70_000;
const LONG_TIMEOUT_MS = 90_000;
const DIRECTOR_TIMEOUT_MS = 45_000;

type DemoMode = 'single' | 'multi';

interface DemoCase {
  id: string;
  title: string;
  mode: DemoMode;
  locale: string;
  script: string;
}

const SINGLE_SPEAKER_DEMOS: readonly DemoCase[] = [
  {
    id: 'en-us-daily-assistant',
    title: 'English (US) daily assistant check-in',
    mode: 'single',
    locale: 'English (US)',
    script: [
      '[cheerfully] Hey! Good morning — let\'s get you caught up real quick.',
      '[casually] So, weather today? Pretty chill — 24 degrees, mostly sunny. Not bad at all.',
      '<break time="400ms"/>',
      '[playfully] Oh and heads up — your 10 AM standup? Still happening. Sorry.',
      '[warmly] You\'ve got like 45 minutes though, so no rush.',
      '<break time="300ms"/>',
      '[bright] Go grab that coffee before it gets cold. You got this!',
    ].join('\n'),
  },
  {
    id: 'hi-support-response',
    title: 'Hindi support response',
    mode: 'single',
    locale: 'Hindi',
    script: [
      '[warmly] अरे, परेशान मत होइए — हम यहाँ हैं।',
      '<break time="400ms"/>',
      '[calmly] आपकी बात हमें मिल गई है, सब नोट कर लिया है।',
      '[reassuringly] बस 24 घंटे — और ये issue पूरी तरह fix हो जाएगा।',
      '<break time="300ms"/>',
      '[gently] कोई और दिक्कत हो तो बेझिझक बताइए। हम कहीं नहीं जा रहे!',
    ].join('\n'),
  },
  {
    id: 'es-delivery-update',
    title: 'Spanish delivery update',
    mode: 'single',
    locale: 'Spanish (Spain)',
    script: [
      '[upbeat] ¡Ey, buenas! Tu pedido ya está en camino, ¡por fin!',
      '<break time="300ms"/>',
      '[casually] El repartidor pasará por tu casa',
      '<emphasis level="strong">entre las 3 y las 5 de la tarde.</emphasis>',
      '<break time="300ms"/>',
      '[playfully] Así que no te escapes muy lejos, ¿eh?',
      '[friendly] ¡Gracias y hasta pronto!',
    ].join('\n'),
  },
  {
    id: 'ja-meeting-reminder',
    title: 'Japanese meeting reminder',
    mode: 'single',
    locale: 'Japanese',
    script: [
      '[gently] あ、ちょっとお知らせです！',
      '<break time="400ms"/>',
      '[casually] 今日の午後2時に、チームミーティングがありますよ。',
      '<break time="400ms"/>',
      '[playfully] 資料、もう見ましたか？まだなら、今がチャンスです！',
      '[warmly] では、後ほどお会いしましょう。',
    ].join('\n'),
  },
  {
    id: 'fr-lifestyle-narrative',
    title: 'French lifestyle narrative',
    mode: 'single',
    locale: 'French',
    script: [
      '[dreamily] Paris le matin... franchement, y\'a rien de mieux.',
      '<break time="600ms"/>',
      '<prosody rate="slow" pitch="+1st">',
      '[softly] Le café qui chauffe, les rues encore vides —',
      'c\'est ces petits moments-là qui valent tout.',
      '</prosody>',
      '<break time="500ms"/>',
      '[wistfully] On court tout le temps... et pourtant,',
      '<emphasis level="moderate">c\'est là, dans le calme, qu\'on se retrouve.</emphasis>',
      '<break time="500ms"/>',
      '[gently] Prenez le temps. Vraiment.',
    ].join('\n'),
  },
] as const;

const MULTI_SPEAKER_DEMOS: readonly DemoCase[] = [
  {
    id: 'en-smart-home-chat',
    title: 'English smart home morning chat',
    mode: 'multi',
    locale: 'English',
    script: [
      'Aryan: [cheerfully] Hey Neha! Good morning — quick heads up before you start your day.',
      'Neha: [sleepily] Mm... yeah go ahead, what\'s up?',
      'Aryan: [playfully] So, it\'s 24 degrees outside, pretty sunny — great day to not stay indoors.',
      'Neha: [laughs] You literally say that every day.',
      'Aryan: [warmly] Because every day you stay indoors! Anyway — your 10 AM standup is still on.',
      '<break time="300ms"/>',
      'Neha: [sighs] Ugh, fine. Okay. Coffee first though.',
      'Aryan: [bright] Obviously. Go go go!',
    ].join('\n'),
  },
  {
    id: 'hi-support-call',
    title: 'Hindi customer support call',
    mode: 'multi',
    locale: 'Hindi',
    script: [
      'Raj: [frustrated] Yaar, mera order abhi tak nahi aaya — teen din ho gaye hain!',
      'Priya: [calmly] Arrey, main samajh sakti hoon aapki baat. Ek second, main check karti hoon.',
      '<break time="500ms"/>',
      'Priya: [reassuringly] Haan, aapka order kal dispatch hua hai — kal shaam tak aa jayega pakka.',
      'Raj: [doubtfully] Pakka? Pehle bhi yahi bola tha na...',
      'Priya: [gently] Main guarantee de rahi hoon is baar. Aur agar nahi aaya toh—',
      'Aryan: [professionally] Main supervisor Aryan bol raha hoon — hum personally ensure karenge delivery. Sorry for the wait!',
      'Raj: [relieved] Okay okay, theek hai. Thanks yaar.',
    ].join('\n'),
  },
  {
    id: 'es-delivery-chat',
    title: 'Spanish delivery update chat',
    mode: 'multi',
    locale: 'Spanish',
    script: [
      'Neha: [upbeat] ¡Ey! Tu paquete está casi en tu puerta.',
      'Raj: [surprised] ¿En serio? ¿Ya?',
      'Neha: [cheerfully] ¡Sí! El repartidor llega entre las 3 y las 5. ¡Hoy es el día!',
      'Raj: [playfully] Buf, por fin — llevaba esperándolo como una semana.',
      'Neha: [warmly] Lo sabemos, perdona la espera. ¿Estarás en casa a esa hora?',
      'Raj: [casually] Sí sí, no me muevo. Gracias eh.',
      'Neha: [bright] ¡Perfecto! ¡Que lo disfrutes!',
    ].join('\n'),
  },
  {
    id: 'en-podcast-style',
    title: 'English podcast style roundtable',
    mode: 'multi',
    locale: 'English',
    script: [
      'Aryan: [enthusiastically] Alright folks, welcome back! Today we\'re talking about AI voices — and it\'s gonna get nerdy.',
      'Neha: [laughs] I mean, when does it NOT get nerdy with us?',
      'Aryan: [playfully] Fair point. So Raj, you\'ve been testing Gemini TTS — first impressions?',
      'Raj: [casually] Honestly? Way better than I expected. Like the emotions actually land, you know?',
      '<break time="400ms"/>',
      'Priya: [thoughtfully] That\'s the thing — most TTS engines fake emotion. Gemini actually reads context.',
      'Neha: [curious] So like, it figures out the vibe from the sentence itself?',
      'Priya: [warmly] Exactly. You write "ugh, not again" — it doesn\'t need a tag. It just... gets it.',
      'Aryan: [impressed] That\'s wild. Okay we are definitely doing a full demo next episode.',
      'Neha: [bright] Subscribe people — you don\'t wanna miss that one!',
    ].join('\n'),
  },
] as const;

const resolveDemoSelection = (projectName: string): DemoCase[] => {
  const mode = String(process.env.PLAYWRIGHT_DEMO_PACK_MODE || 'smoke').trim().toLowerCase();
  if (mode === 'full') {
    return [...SINGLE_SPEAKER_DEMOS, ...MULTI_SPEAKER_DEMOS];
  }

  const mobile = /mobile/i.test(projectName);
  if (mobile) {
    return [
      SINGLE_SPEAKER_DEMOS[0],
      MULTI_SPEAKER_DEMOS[0],
    ];
  }

  return [
    SINGLE_SPEAKER_DEMOS[0],
    SINGLE_SPEAKER_DEMOS[1],
    MULTI_SPEAKER_DEMOS[0],
    MULTI_SPEAKER_DEMOS[1],
  ];
};

const normalizeVisibleText = (value: string): string => String(value || '').replace(/\s+/g, ' ').trim();
const hasSpeakerTags = (value: string): boolean => /^(?:\[[^\]\n]+\]|[^:\n]{1,40}):/m.test(value);
const isPreviewRequestId = (requestId: string): boolean => /^voice-preview:/i.test(String(requestId || '').trim());

const resolveRouteUrl = (page: Page, path: string): string => {
  try {
    const current = new URL(page.url());
    if (current.protocol.startsWith('http')) {
      return new URL(path, current.origin).toString();
    }
  } catch {
    // Fall back to Playwright baseURL-relative navigation.
  }
  return path;
};

const isGenerationCreateRequest = (request: Request): boolean => {
  if (request.method() !== 'POST') return false;
  const url = String(request.url() || '');
  if (!/\/tts\/v2\/jobs(?:\?|$)/i.test(url) && !/\/tts\/jobs(?:\?|$)/i.test(url)) {
    return false;
  }
  let requestId = '';
  try {
    const payload = request.postDataJSON() as Record<string, unknown> | null;
    requestId = String(payload?.request_id || payload?.requestId || '').trim();
  } catch {
    requestId = '';
  }
  return !isPreviewRequestId(requestId);
};

const openStudioWorkspace = async (page: Page): Promise<void> => {
  await page.goto(resolveRouteUrl(page, '/app/studio'), { waitUntil: 'domcontentloaded', timeout: ROUTE_TIMEOUT_MS });
  await Promise.any([
    page.locator('.vf-studio-grid, .vf-editor-shell').first().waitFor({ state: 'visible', timeout: ROUTE_TIMEOUT_MS }),
    page.getByRole('button', { name: /^Generate Audio$/i }).first().waitFor({ state: 'visible', timeout: ROUTE_TIMEOUT_MS }),
  ]);
};

const setPrimeEngineIfVisible = async (page: Page): Promise<void> => {
  const primeButton = page.getByRole('button', { name: /^Prime\b/i }).first();
  if (await primeButton.isVisible().catch(() => false)) {
    await primeButton.click({ force: true }).catch(() => undefined);
  }
};

const setRawStoryInEditor = async (page: Page, story: string): Promise<void> => {
  const rawModeButton = page.getByRole('button', { name: /^Raw$/i }).first();
  if (await rawModeButton.isVisible().catch(() => false)) {
    await rawModeButton.click({ force: true }).catch(() => undefined);
  }

  const editorCandidates = [
    page.getByLabel(/Studio script editor/i).first(),
    page.locator('textarea[aria-label*="Studio script editor"]').first(),
    page.getByPlaceholder(/Write your script here/i).first(),
    page.locator('textarea.vf-studio-raw-editor').first(),
    page.locator('textarea').first(),
  ];
  let editor = editorCandidates[0];
  for (const candidate of editorCandidates) {
    if (await candidate.isVisible().catch(() => false)) {
      editor = candidate;
      break;
    }
  }

  await expect(editor, 'Studio script editor should be visible.').toBeVisible({ timeout: ROUTE_TIMEOUT_MS });
  await editor.fill('');
  await editor.fill(story);
};

const applyAiDirector = async (
  page: Page,
  demoCase: DemoCase,
): Promise<string> => {
  const aiDirectorButton = page.getByRole('button', { name: /^AI Director$/i }).first();
  const editor = page.getByLabel(/Studio script editor/i).first();
  const before = normalizeVisibleText(await editor.inputValue().catch(() => ''));
  await expect(aiDirectorButton, 'AI Director button should be visible.').toBeVisible({ timeout: ROUTE_TIMEOUT_MS });

  await aiDirectorButton.click({ force: true });

  const previewRoot = page.locator('.vf-director-preview').first();
  const alertRoot = page.locator('[role="alert"]').filter({ hasText: /\S/ }).first();

  await Promise.any([
    previewRoot.waitFor({ state: 'visible', timeout: DIRECTOR_TIMEOUT_MS }),
    alertRoot.waitFor({ state: 'visible', timeout: DIRECTOR_TIMEOUT_MS }),
    expect.poll(
      async () => normalizeVisibleText(await editor.inputValue().catch(() => '')),
      { timeout: DIRECTOR_TIMEOUT_MS },
    ).not.toBe(before),
  ]).catch(() => undefined);

  if (await previewRoot.isVisible().catch(() => false)) {
    await page.getByRole('button', { name: /^Apply To Editor$/i }).first().click({ force: true });
    await expect(previewRoot).toBeHidden({ timeout: DIRECTOR_TIMEOUT_MS }).catch(() => undefined);
  }

  if (!await editor.isVisible().catch(() => false)) {
    await page.getByRole('button', { name: /^Raw$/i }).first().click({ force: true }).catch(() => undefined);
  }

  const latest = normalizeVisibleText(await editor.inputValue().catch(() => ''));
  expect(latest.length, `${demoCase.title} should still have directed editor text after AI Director.`).toBeGreaterThan(20);
  if (demoCase.mode === 'multi') {
    expect(
      hasSpeakerTags(latest),
      `${demoCase.title} should keep or gain speaker tags after AI Director. Preview: ${latest.slice(0, 320)}`,
    ).toBe(true);
  }
  return latest;
};

const setMultiSpeakerMode = async (page: Page, enabled: boolean): Promise<void> => {
  const multiSpeakerButton = page.getByRole('button', { name: /^Multi-Speaker /i }).first();
  await expect(multiSpeakerButton).toBeVisible({ timeout: ROUTE_TIMEOUT_MS });
  const label = normalizeVisibleText(await multiSpeakerButton.textContent().catch(() => ''));
  const currentlyEnabled = /on$/i.test(label) || /\bon\b/i.test(label);
  if (currentlyEnabled !== enabled) {
    await multiSpeakerButton.click({ force: true });
  }
};

const runGenerationAndCapture = async (
  page: Page,
  demoCase: DemoCase,
): Promise<{ status: number; submitCount: number; blockingAlert: string }> => {
  await setMultiSpeakerMode(page, demoCase.mode === 'multi');

  const submitUrls: string[] = [];
  let submissionStartedAt = 0;
  const ttsRequestListener = (request: Request): void => {
    if (Date.now() < submissionStartedAt) return;
    if (!isGenerationCreateRequest(request)) return;
    submitUrls.push(String(request.url() || ''));
  };
  page.on('request', ttsRequestListener);
  try {
    const generateButtonCandidates = [
      page.getByTestId('studio-generate-dock').getByRole('button', { name: /^Generate Audio$/i }).first(),
      page.getByRole('button', { name: /^Generate Audio$/i }).first(),
    ];
    let generateButton = generateButtonCandidates[0];
    for (const candidate of generateButtonCandidates) {
      if (await candidate.isVisible().catch(() => false)) {
        generateButton = candidate;
        break;
      }
    }

    await expect(generateButton).toBeVisible({ timeout: ROUTE_TIMEOUT_MS });
    await expect(generateButton).toBeEnabled({ timeout: ROUTE_TIMEOUT_MS });

    const responsePromise = page.waitForResponse(
      (response) => isGenerationCreateRequest(response.request()),
      { timeout: ROUTE_TIMEOUT_MS },
    ).catch(() => null);

    submissionStartedAt = Date.now();
    await generateButton.click({ force: true });
    const response = await responsePromise;

    const alerts = (await page.locator('[role="alert"]').allTextContents().catch(() => []))
      .map((item) => normalizeVisibleText(item))
      .filter(Boolean);
    const blockingAlert = alerts.find((item) => /failed|error|unable|cannot|unavailable|insufficient|timeout/i.test(item)) || '';

    await expect(generateButton).toBeEnabled({ timeout: LONG_TIMEOUT_MS }).catch(() => undefined);

    return {
      status: response?.status() || 0,
      submitCount: submitUrls.length,
      blockingAlert,
    };
  } finally {
    page.off('request', ttsRequestListener);
  }
};

test('manual: casual demo pack routes through AI Director before generation', async ({ page }, testInfo) => {
  test.setTimeout(15 * 60 * 1000);
  const credentials = resolveStudioSmokeCredentials();
  test.skip(!credentials, 'PLAYWRIGHT_ADMIN_EMAIL and PLAYWRIGHT_ADMIN_PASSWORD are required.');

  const consoleIssues: string[] = [];
  page.on('console', (message) => {
    const text = normalizeVisibleText(message.text());
    if (!text) return;
    const lowered = text.toLowerCase();
    if (lowered.includes('/tts/v2/jobs/voice-preview') || lowered.includes('/ai/generate-text')) return;
    if (message.type() === 'error' || lowered.includes('hydration failed') || lowered.includes('uncaught')) {
      consoleIssues.push(`[console:${message.type()}] ${text}`);
    }
  });
  page.on('pageerror', (error) => {
    consoleIssues.push(`[pageerror] ${error.message}`);
  });

  await ensureStudioSmokeAuthenticated(page, credentials, { preloadWritingSurface: false });

  const demoCases = resolveDemoSelection(testInfo.project.name);
  const results: Array<{
    id: string;
    title: string;
    mode: DemoMode;
    status: number;
    submitCount: number;
    blockingAlert: string;
    directedPreview: string;
  }> = [];

  for (const demoCase of demoCases) {
    await openStudioWorkspace(page);
    await setPrimeEngineIfVisible(page);
    await setRawStoryInEditor(page, demoCase.script);
    const directedScript = await applyAiDirector(page, demoCase);
    const generation = await runGenerationAndCapture(page, demoCase);

    results.push({
      id: demoCase.id,
      title: demoCase.title,
      mode: demoCase.mode,
      status: generation.status,
      submitCount: generation.submitCount,
      blockingAlert: generation.blockingAlert,
      directedPreview: directedScript.slice(0, 500),
    });
  }

  const failures: string[] = [];
  for (const result of results) {
    if (result.status !== 200 && result.status !== 202) {
      failures.push(`${result.title} failed to submit generation (status=${result.status}).`);
    }
    if (result.submitCount > 1) {
      failures.push(`${result.title} triggered duplicate generation submits (${result.submitCount}).`);
    }
    if (result.blockingAlert) {
      failures.push(`${result.title} raised a blocking alert: ${result.blockingAlert}`);
    }
  }
  if (consoleIssues.length > 0) {
    failures.push(`console/runtime issues: ${consoleIssues.slice(0, 6).join(' | ')}`);
  }

  console.log(JSON.stringify({
    project: testInfo.project.name,
    selectedCaseIds: demoCases.map((item) => item.id),
    fullPackAvailable: [...SINGLE_SPEAKER_DEMOS, ...MULTI_SPEAKER_DEMOS].map((item) => item.id),
    results,
    consoleIssues,
    failures,
  }, null, 2));

  expect(failures, `Casual demo pack failures:\n${failures.join('\n')}`).toEqual([]);
});
