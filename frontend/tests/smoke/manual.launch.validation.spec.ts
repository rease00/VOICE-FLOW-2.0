import { expect, test, type Request } from '@playwright/test';
import { ensureStudioSmokeAuthenticated, resolveStudioSmokeCredentials } from './smokeAuth';

const ROUTE_TIMEOUT_MS = 120_000;
const LONG_TIMEOUT_MS = 300_000;
const VC_REFERENCE_AUDIO = 'C:/Users/1wasi/OneDrive/Desktop/test vc/reference audio.wav';
const VC_TARGET_AUDIO = 'C:/Users/1wasi/OneDrive/Desktop/test vc/terget audio.wav';
const VC_DEMUCS_SOURCE_AUDIO = 'C:/Users/1wasi/OneDrive/Desktop/test vc/terget audio.wav';

type GenerationCase = {
  label: string;
  engine: 'Vector' | 'Prime';
  multiSpeaker: boolean;
  script: string;
};

const DESKTOP_GENERATION_CASES: GenerationCase[] = [
  {
    label: 'vector-single',
    engine: 'Vector',
    multiSpeaker: false,
    script: 'Single speaker launch validation for Vector engine. Keep the delivery clear and natural.',
  },
  {
    label: 'vector-multi',
    engine: 'Vector',
    multiSpeaker: true,
    script: '[Host]: Welcome to the launch validation call. [Guest]: Vector multi-speaker flow confirms stable turn handling.',
  },
  {
    label: 'prime-single',
    engine: 'Prime',
    multiSpeaker: false,
    script: 'Single speaker launch validation for Prime engine. Keep the pacing steady and expressive.',
  },
  {
    label: 'prime-multi',
    engine: 'Prime',
    multiSpeaker: true,
    script: '[Narrator]: Prime multi-speaker validation begins now. [Analyst]: We confirm handoff and timing consistency.',
  },
];

const MOBILE_GENERATION_CASES: GenerationCase[] = [
  {
    label: 'prime-single-mobile',
    engine: 'Prime',
    multiSpeaker: false,
    script: 'Mobile launch validation on Prime engine with single speaker flow.',
  },
];

const normalizeVisibleText = (value: string): string => String(value || '').replace(/\s+/g, ' ').trim();

const runGenerationCase = async (
  page: Parameters<typeof test>[0]['page'],
  caseItem: GenerationCase
): Promise<{ ok: boolean; status: number; detail: string }> => {
  await page.goto('/app/studio', { waitUntil: 'domcontentloaded', timeout: ROUTE_TIMEOUT_MS });
  await page.locator('.vf-studio-grid, .vf-editor-shell').first().waitFor({ state: 'visible', timeout: ROUTE_TIMEOUT_MS }).catch(() => undefined);
  await page.getByRole('button', { name: /^Generate Audio$/i }).first().waitFor({ state: 'visible', timeout: ROUTE_TIMEOUT_MS }).catch(() => undefined);
  await Promise.any([
    page.locator('textarea').first().waitFor({ state: 'visible', timeout: 25_000 }),
    page.getByRole('button', { name: /^Raw$/i }).first().waitFor({ state: 'visible', timeout: 25_000 }),
  ]).catch(() => undefined);

  const engineButton = page.getByRole('button', { name: new RegExp(`^${caseItem.engine}`, 'i') }).first();
  const engineButtonVisible = await engineButton.isVisible().catch(() => false);
  if (engineButtonVisible) {
    await engineButton.click({ force: true });
  } else if (caseItem.engine !== 'Prime') {
    return { ok: false, status: 0, detail: `${caseItem.engine} engine toggle not visible.` };
  }

  const multiSpeakerButton = page.getByRole('button', { name: /^Multi-Speaker /i }).first();
  const multiSpeakerVisible = await multiSpeakerButton.isVisible().catch(() => false);
  if (!multiSpeakerVisible) {
    return { ok: false, status: 0, detail: 'Multi-speaker toggle is not visible.' };
  }
  const multiLabel = normalizeVisibleText(await multiSpeakerButton.textContent().catch(() => ''));
  const currentlyEnabled = /on$/i.test(multiLabel) || /\bon\b/i.test(multiLabel);
  if (currentlyEnabled !== caseItem.multiSpeaker) {
    await multiSpeakerButton.click({ force: true });
  }

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
  const editorVisible = await editor.isVisible().catch(() => false);
  if (!editorVisible) {
    const visibleButtons = (await page.locator('button:visible').allTextContents().catch(() => []))
      .map((value) => normalizeVisibleText(value))
      .filter(Boolean)
      .slice(0, 12)
      .join(' | ');
    return {
      ok: false,
      status: 0,
      detail: `Studio script editor is not visible. URL=${page.url()} Buttons=${visibleButtons || 'none'}`,
    };
  }
  await editor.fill('');
  await editor.type(caseItem.script, { delay: 6 });

  const generateButton = page.getByRole('button', { name: /^Generate Audio$/i }).first();
  const generateVisible = await generateButton.isVisible().catch(() => false);
  if (!generateVisible) {
    return { ok: false, status: 0, detail: 'Generate Audio button is not visible.' };
  }
  const generateReady = await generateButton.isEnabled().catch(() => false);
  if (!generateReady) {
    return { ok: false, status: 0, detail: 'Generate Audio button is disabled before submit.' };
  }

  const submitRequestUrls: string[] = [];
  let submissionStartedAt = 0;
  const ttsRequestListener = (request: Request): void => {
    if (request.method() !== 'POST') return;
    const url = String(request.url() || '');
    if (Date.now() < submissionStartedAt) return;
    if (/\/tts\/v2\/jobs(?:\?|$)/i.test(url) || /\/tts\/jobs(?:\?|$)/i.test(url) || /\/tts\/synthesize(?:\?|$)/i.test(url)) {
      submitRequestUrls.push(url);
    }
  };
  page.on('request', ttsRequestListener);

  const requestMatcher = (response: { request: () => { method: () => string }; url: () => string }): boolean => {
    if (response.request().method() !== 'POST') return false;
    const url = String(response.url() || '');
    return /\/tts\/v2\/jobs/i.test(url) || /\/tts\/jobs/i.test(url) || /\/tts\/synthesize/i.test(url);
  };
  const requestPromise = page.waitForResponse(
    requestMatcher,
    { timeout: ROUTE_TIMEOUT_MS }
  ).catch(() => null);

  submissionStartedAt = Date.now();
  await generateButton.click({ force: true });
  let requestResponse = await requestPromise;
  if (!requestResponse && await generateButton.isEnabled().catch(() => false)) {
    const retryPromise = page.waitForResponse(requestMatcher, { timeout: 30_000 }).catch(() => null);
    submissionStartedAt = Date.now();
    await generateButton.click({ force: true });
    requestResponse = await retryPromise;
  }
  await expect(generateButton).toBeEnabled({ timeout: LONG_TIMEOUT_MS }).catch(() => undefined);
  await page.waitForTimeout(1200);
  page.off('request', ttsRequestListener);

  const alerts = (await page.locator('[role="alert"]').allTextContents().catch(() => []))
    .map((item) => normalizeVisibleText(item))
    .filter(Boolean);
  const blockingAlert = alerts.find((item) => /failed|error|unable|cannot|unavailable|insufficient/i.test(item)) || '';

  if (!requestResponse) {
    return { ok: false, status: 0, detail: 'No TTS job request observed.' };
  }
  const status = requestResponse.status();
  if (!requestResponse.ok()) {
    const payload = await requestResponse.text().catch(() => '');
    return { ok: false, status, detail: payload || 'TTS request failed.' };
  }
  if (submitRequestUrls.length > 1) {
    return {
      ok: false,
      status,
      detail: `Duplicate generation submits detected (${submitRequestUrls.length} POST requests).`,
    };
  }
  if (blockingAlert) {
    return { ok: false, status, detail: blockingAlert };
  }
  return { ok: true, status, detail: '' };
};

const runVoiceCloneAndDemucsChecks = async (
  page: Parameters<typeof test>[0]['page']
): Promise<{
  cloneOk: boolean;
  cloneStatus: number;
  cloneDetail: string;
  demucsOk: boolean;
  demucsStatus: number;
  demucsDetail: string;
}> => {
  await page.goto('/app/voices', { waitUntil: 'domcontentloaded', timeout: ROUTE_TIMEOUT_MS });
  await Promise.any([
    page.getByRole('heading', { name: /Voice Cloning/i }).first().waitFor({ state: 'visible', timeout: ROUTE_TIMEOUT_MS }),
    page.locator('[data-testid="voices-workspace"]').first().waitFor({ state: 'visible', timeout: ROUTE_TIMEOUT_MS }),
  ]);

  const cloneTab = page.getByRole('tab', { name: /^Voice Cloning/i }).first();
  const cloneTabVisible = await cloneTab.isVisible().catch(() => false);
  if (!cloneTabVisible) {
    return {
      cloneOk: false,
      cloneStatus: 0,
      cloneDetail: 'Voice Cloning tab is not visible.',
      demucsOk: false,
      demucsStatus: 0,
      demucsDetail: 'Voice Cloning tab is not visible.',
    };
  }
  await cloneTab.click({ force: true });

  await page.getByLabel('Drop reference audio').first().setInputFiles(VC_REFERENCE_AUDIO);
  await page.getByLabel('Drop target audio').first().setInputFiles(VC_TARGET_AUDIO);
  await expect(page.getByText('reference audio.wav').first()).toBeVisible({ timeout: ROUTE_TIMEOUT_MS });
  await expect(page.getByText('terget audio.wav').first()).toBeVisible({ timeout: ROUTE_TIMEOUT_MS });

  const consentOne = page.getByRole('checkbox', { name: /explicit permission to clone it/i }).first();
  if (await consentOne.isVisible().catch(() => false)) {
    const checked = await consentOne.isChecked().catch(() => false);
    if (!checked) {
      await consentOne.click({ force: true });
    }
  }
  const consentTwo = page.getByRole('checkbox', { name: /not use cloned output for impersonation/i }).first();
  if (await consentTwo.isVisible().catch(() => false)) {
    const checked = await consentTwo.isChecked().catch(() => false);
    if (!checked) {
      await consentTwo.click({ force: true });
    }
  }

  const startCloneButton = page.getByRole('button', { name: /^(Start Cloning|Create .* Clone)$/i }).first();
  const startCloneVisible = await startCloneButton.isVisible().catch(() => false);
  let cloneOk = false;
  let cloneStatus = 0;
  let cloneDetail = '';

  const separateTab = page.getByRole('tab', { name: /^Extract Voice \+ BG/i }).first();
  let demucsOk = false;
  let demucsStatus = 0;
  let demucsDetail = '';
  if (!await separateTab.isVisible().catch(() => false)) {
    demucsDetail = 'Extract Voice + BG tab is not visible.';
  } else {
    await separateTab.click({ force: true });

    await page.getByLabel('Drop source mix audio').first().setInputFiles(VC_DEMUCS_SOURCE_AUDIO);
    await page.waitForTimeout(500);

    const applyTrimButton = page.getByRole('button', { name: /Apply source trim/i }).first();
    if (await applyTrimButton.isVisible().catch(() => false)) {
      await applyTrimButton.click({ force: true });
    }

    const extractButton = page.getByRole('button', { name: /Extract Voice \+ BG Music/i }).first();
    if (!await extractButton.isVisible().catch(() => false)) {
      demucsDetail = 'Extract Voice + BG Music button is not visible.';
    } else if (!await extractButton.isEnabled().catch(() => false)) {
      demucsDetail = 'Extract Voice + BG Music button is disabled.';
    } else {
      const demucsRequestPromise = page.waitForResponse(
        (response) => response.request().method() === 'POST' && /\/voice-clone\/separate/i.test(response.url()),
        { timeout: ROUTE_TIMEOUT_MS }
      ).catch(() => null);

      await extractButton.click({ force: true });
      const demucsResponse = await demucsRequestPromise;
      demucsStatus = demucsResponse?.status() || 0;
      const demucsPayload = demucsResponse ? await demucsResponse.text().catch(() => '') : '';
      const demucsAlerts = (await page.locator('[role="alert"]').allTextContents().catch(() => []))
        .map((item) => normalizeVisibleText(item))
        .filter(Boolean);
      const demucsBlockingAlert = demucsAlerts.find((item) => /failed|error|unable|cannot|unavailable|insufficient/i.test(item)) || '';
      demucsOk = Boolean(demucsResponse?.ok()) && !demucsBlockingAlert;
      demucsDetail = demucsBlockingAlert || demucsPayload || '';
    }
  }

  await cloneTab.click({ force: true });
  if (!startCloneVisible) {
    cloneDetail = 'Start Cloning button is not visible.';
  } else {
    await expect(startCloneButton).toBeEnabled({ timeout: 20_000 }).catch(() => undefined);
    const startCloneEnabled = await startCloneButton.isEnabled().catch(() => false);
    if (!startCloneEnabled) {
      const cloneTabText = normalizeVisibleText(await cloneTab.textContent().catch(() => ''));
      cloneDetail = `Start Cloning button is disabled. Tab state: ${cloneTabText || 'unknown'}`;
    } else {
      const cloneRequestPromise = page.waitForResponse(
        (response) => response.request().method() === 'POST' && /\/voice-clone\/jobs\/render/i.test(response.url()),
        { timeout: ROUTE_TIMEOUT_MS }
      ).catch(() => null);

      await startCloneButton.click({ force: true });
      const cloneResponse = await cloneRequestPromise;
      cloneStatus = cloneResponse?.status() || 0;
      const clonePayload = cloneResponse ? await cloneResponse.text().catch(() => '') : '';
      const cloneTaskVisible = await page.locator('.vf-voice-clone-task').first().isVisible().catch(() => false);
      const cloneAlerts = (await page.locator('[role="alert"]').allTextContents().catch(() => []))
        .map((item) => normalizeVisibleText(item))
        .filter(Boolean);
      const cloneBlockingAlert = cloneAlerts.find((item) => /failed|error|unable|cannot|unavailable|insufficient/i.test(item)) || '';
      cloneOk = Boolean(cloneResponse?.ok()) && (cloneTaskVisible || !cloneBlockingAlert);
      cloneDetail = cloneBlockingAlert || clonePayload || (cloneTaskVisible ? 'Progress card visible.' : '');
    }
  }

  return {
    cloneOk,
    cloneStatus,
    cloneDetail,
    demucsOk,
    demucsStatus,
    demucsDetail,
  };
};

test('manual launch validation: generation matrix + voice clone + demucs', async ({ page }, testInfo) => {
  test.setTimeout(1_200_000);
  const credentials = resolveStudioSmokeCredentials();
  test.skip(!credentials, 'PLAYWRIGHT_ADMIN_EMAIL and PLAYWRIGHT_ADMIN_PASSWORD are required.');

  await ensureStudioSmokeAuthenticated(page, credentials);

  const isMobileProject = /mobile/i.test(testInfo.project.name);
  const generationCases = isMobileProject ? MOBILE_GENERATION_CASES : DESKTOP_GENERATION_CASES;

  const generationResults: Array<{ label: string; ok: boolean; status: number; detail: string }> = [];
  for (const caseItem of generationCases) {
    const result = await runGenerationCase(page, caseItem);
    generationResults.push({ label: caseItem.label, ...result });
  }

  const voiceChecks = isMobileProject
    ? {
      cloneOk: true,
      cloneStatus: 0,
      cloneDetail: 'Skipped on mobile run.',
      demucsOk: true,
      demucsStatus: 0,
      demucsDetail: 'Skipped on mobile run.',
    }
    : await runVoiceCloneAndDemucsChecks(page);

  const failures: string[] = [];
  for (const result of generationResults) {
    if (!result.ok) {
      failures.push(`${result.label} failed (status=${result.status}): ${result.detail || 'unknown error'}`);
    }
  }
  if (!voiceChecks.cloneOk) {
    failures.push(`voice-clone failed (status=${voiceChecks.cloneStatus}): ${voiceChecks.cloneDetail || 'unknown error'}`);
  }
  if (!voiceChecks.demucsOk) {
    failures.push(`demucs failed (status=${voiceChecks.demucsStatus}): ${voiceChecks.demucsDetail || 'unknown error'}`);
  }

  console.log(JSON.stringify({
    project: testInfo.project.name,
    generationResults,
    voiceChecks,
    failures,
  }, null, 2));

  expect(failures, `Launch validation failures:\n${failures.join('\n')}`).toEqual([]);
});
