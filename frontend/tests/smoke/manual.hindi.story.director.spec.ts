import { expect, test, type Page, type Request } from '@playwright/test';
import { ensureStudioSmokeAuthenticated, resolveStudioSmokeCredentials } from './smokeAuth';

const ROUTE_TIMEOUT_MS = 55_000;
const LONG_TIMEOUT_MS = 55_000;

const HINDI_STORY = [
  'हिंदी मज़ेदार कहानी: मोहन और उसका मोबाइल।',
  'माँ: मोहन, ज़रा सब्ज़ी लेने चले जाओ।',
  'मोहन: माँ, मैं ऑनलाइन सब्ज़ी मंगवा लूँ?',
  'माँ: ऑनलाइन कान खींच दूँ क्या?',
  'सब्ज़ीवाला: मैं गूगल नहीं हूँ, सब्ज़ीवाला हूँ!',
  'मोहन: नाsss! मोबाइल ऑफ हो गया… मेरी दुनिया चली गई!',
  'आंटी: बेटा, इंसानों से बात करना सीख लो।',
  'मोहन: वो ऐप कहाँ से डाउनलोड होता है?',
  'वाचक: उस दिन मोहन समझ गया कि ज़िंदगी मोबाइल से नहीं, लोगों की मुस्कान से चलती है।',
].join('\n');

const DIRECTED_STORY = [
  '[हिंदी मज़ेदार कहानी]: मोहन और उसका मोबाइल।',
  '[माँ]: मोहन, ज़रा सब्ज़ी लेने चले जाओ।',
  '[मोहन]: माँ, मैं ऑनलाइन सब्ज़ी मंगवा लूँ?',
  '[माँ]: ऑनलाइन कान खींच दूँ क्या?',
  '[सब्ज़ीवाला]: मैं गूगल नहीं हूँ, सब्ज़ीवाला हूँ!',
  '[मोहन]: नाsss! मोबाइल ऑफ हो गया… मेरी दुनिया चली गई!',
  '[आंटी]: बेटा, इंसानों से बात करना सीख लो।',
  '[मोहन]: वो ऐप कहाँ से डाउनलोड होता है?',
  '[वाचक]: उस दिन मोहन समझ गया कि ज़िंदगी मोबाइल से नहीं, लोगों की मुस्कान से चलती है।',
].join('\n');

const HINDI_SINGLE_TEXT = [
  'मोहन अपने मोबाइल में इतना खोया रहता था कि उसके आसपास की दुनिया भूल जाता था।',
  'एक दिन सब्ज़ी लेने गया तो बैटरी खत्म होते ही घबरा गया।',
  'आंटी ने उसे समझाया कि असली जिंदगी लोगों की मुस्कान में है, सिर्फ स्क्रीन में नहीं।',
].join(' ');

const normalizeVisibleText = (value: string): string => String(value || '').replace(/\s+/g, ' ').trim();
const isPreviewRequestId = (requestId: string): boolean => /^voice-preview:/i.test(String(requestId || '').trim());

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
  await page.goto('/app/studio', { waitUntil: 'domcontentloaded', timeout: ROUTE_TIMEOUT_MS });
  await Promise.any([
    page.locator('.vf-studio-grid, .vf-editor-shell').first().waitFor({ state: 'visible', timeout: ROUTE_TIMEOUT_MS }),
    page.getByRole('button', { name: /^Generate Audio$/i }).first().waitFor({ state: 'visible', timeout: ROUTE_TIMEOUT_MS }),
  ]);
};

const setRawStoryInEditor = async (page: Page, story: string): Promise<void> => {
  const rawModeButton = page.getByRole('button', { name: /^Raw$/i }).first();
  if (await rawModeButton.isVisible().catch(() => false)) {
    await rawModeButton.click({ force: true });
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

const applyAiDirector = async (page: Page): Promise<string> => {
  const aiDirectorButton = page.getByRole('button', { name: /^AI Director$/i }).first();
  await expect(aiDirectorButton, 'AI Director button should be visible.').toBeVisible({ timeout: ROUTE_TIMEOUT_MS });
  const editor = page.getByLabel(/Studio script editor/i).first();
  await aiDirectorButton.click({ force: true });

  const previewRoot = page.locator('.vf-director-preview').first();
  const hasPreview = await previewRoot.isVisible().catch(() => false);
  if (hasPreview) {
    await page.getByRole('button', { name: /^Apply To Editor$/i }).first().click({ force: true });
    await expect(previewRoot).toBeHidden({ timeout: ROUTE_TIMEOUT_MS }).catch(() => undefined);
  }

  if (!await editor.isVisible().catch(() => false)) {
    await page.getByRole('button', { name: /^Raw$/i }).first().click({ force: true }).catch(() => undefined);
  }
  await expect.poll(
    async () => normalizeVisibleText(await editor.inputValue().catch(() => '')).length,
    { timeout: LONG_TIMEOUT_MS },
  ).toBeGreaterThan(20);
  const latest = normalizeVisibleText(await editor.inputValue().catch(() => ''));
  expect(latest.length, 'Directed script should not be empty.').toBeGreaterThan(30);
  expect(
    /.+\([^)]+\):/.test(latest) || /\[[^\]]+\]:/.test(latest),
    `Directed script does not include speaker tags: ${latest.slice(0, 320)}`
  ).toBe(true);
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
  mode: 'single' | 'multi',
): Promise<{ status: number; submitCount: number; blockingAlert: string }> => {
  await setMultiSpeakerMode(page, mode === 'multi');

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
      { timeout: ROUTE_TIMEOUT_MS }
    ).catch(() => null);

    submissionStartedAt = Date.now();
    await generateButton.click();
    const response = await responsePromise;

    const alerts = (await page.locator('[role="alert"]').allTextContents().catch(() => []))
      .map((item) => normalizeVisibleText(item))
      .filter(Boolean);
    const blockingAlert = alerts.find((item) => /failed|error|unable|cannot|unavailable|insufficient|timeout/i.test(item)) || '';

    return {
      status: response?.status() || 0,
      submitCount: submitUrls.length,
      blockingAlert,
    };
  } finally {
    page.off('request', ttsRequestListener);
  }
};

test('manual: Hindi story AI Director single+multi generation (desktop/mobile)', async ({ page }, testInfo) => {
  test.setTimeout(85_000);
  const credentials = resolveStudioSmokeCredentials();
  test.skip(!credentials, 'PLAYWRIGHT_ADMIN_EMAIL and PLAYWRIGHT_ADMIN_PASSWORD are required.');

  const consoleIssues: string[] = [];
  page.on('console', (msg) => {
    const text = normalizeVisibleText(msg.text());
    if (!text) return;
    const locationUrl = String(msg.location()?.url || '').toLowerCase();
    if (locationUrl.includes('/tts/v2/jobs/voice-preview')) return;
    if (locationUrl.includes('/ai/generate-text')) return;
    const lowered = text.toLowerCase();
    if (msg.type() === 'error' || lowered.includes('uncaught') || lowered.includes('hydration failed')) {
      consoleIssues.push(`[console:${msg.type()}] ${text}`);
    }
  });
  page.on('pageerror', (error) => {
    consoleIssues.push(`[pageerror] ${error.message}`);
  });

  await ensureStudioSmokeAuthenticated(page, credentials);
  await openStudioWorkspace(page);
  const isMobileProject = /mobile/i.test(String(testInfo.project.name || ''));
  let single: { status: number; submitCount: number; blockingAlert: string } = {
    status: 200,
    submitCount: 0,
    blockingAlert: '',
  };
  if (!isMobileProject) {
    await setRawStoryInEditor(page, HINDI_SINGLE_TEXT);
    single = await runGenerationAndCapture(page, 'single');
  }
  let directedScript = DIRECTED_STORY;
  if (isMobileProject) {
    await setRawStoryInEditor(page, DIRECTED_STORY);
  } else {
    await setRawStoryInEditor(page, HINDI_STORY);
    directedScript = await applyAiDirector(page);
  }
  const multi = await runGenerationAndCapture(page, 'multi');

  const failures: string[] = [];
  if (!isMobileProject && single.status !== 200 && single.status !== 202) {
    failures.push(`single-speaker generation failed (status=${single.status})`);
  }
  if (multi.status !== 200 && multi.status !== 202) {
    failures.push(`multi-speaker generation failed (status=${multi.status})`);
  }
  if (!isMobileProject && single.submitCount > 1) {
    failures.push(`single-speaker duplicate submits detected (${single.submitCount})`);
  }
  if (multi.submitCount > 1) {
    failures.push(`multi-speaker duplicate submits detected (${multi.submitCount})`);
  }
  if (!isMobileProject && single.blockingAlert) {
    failures.push(`single-speaker blocking alert: ${single.blockingAlert}`);
  }
  if (multi.blockingAlert) {
    failures.push(`multi-speaker blocking alert: ${multi.blockingAlert}`);
  }
  if (consoleIssues.length > 0) {
    failures.push(`console/runtime issues: ${consoleIssues.slice(0, 5).join(' | ')}`);
  }

  console.log(JSON.stringify({
    project: testInfo.project.name,
    directedScriptPreview: directedScript.slice(0, 800),
    single,
    multi,
    consoleIssues,
    failures,
  }, null, 2));

  expect(failures, `Hindi story launch audit failures:\n${failures.join('\n')}`).toEqual([]);
});
