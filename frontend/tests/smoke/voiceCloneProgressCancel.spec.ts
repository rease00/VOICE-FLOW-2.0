import { expect, test, type Page, type Route } from '@playwright/test';
import { ensureStudioSmokeAuthenticated, resolveStudioSmokeCredentials } from './smokeAuth';
import fs from 'node:fs';
import path from 'node:path';

const ROOT_DIR = path.resolve(process.cwd(), '..');
const REFERENCE_AUDIO = path.resolve(ROOT_DIR, 'backend', 'assets', 'voice_profiles', 'reference', 'p03_us_m_adult.wav');
const TARGET_AUDIO = path.resolve(ROOT_DIR, 'backend', 'assets', 'voice_profiles', 'reference', 'p04_us_f_adult.wav');
const REFERENCE_AUDIO_FILE = path.basename(REFERENCE_AUDIO);
const TARGET_AUDIO_FILE = path.basename(TARGET_AUDIO);
const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const buildDataUrl = (filePath: string): string => {
  const mimeType = 'audio/wav';
  const base64 = fs.readFileSync(filePath).toString('base64');
  return `data:${mimeType};base64,${base64}`;
};

const checkIfVisible = async (locator: ReturnType<Page['getByRole']>): Promise<void> => {
  const target = locator.first();
  const visible = await target.isVisible().catch(() => false);
  if (!visible) return;
  const alreadyChecked = await target.isChecked().catch(() => false);
  if (alreadyChecked) return;
  await target.click({ force: true }).catch(() => undefined);
};

test('voice-clone root progress card supports cancel from the top level', async ({ page }) => {
  test.setTimeout(180_000);
  const credentials = resolveStudioSmokeCredentials();
  test.skip(!credentials, 'Studio smoke credentials are required for this verification.');

  const audioDataUrl = buildDataUrl(REFERENCE_AUDIO);
  const progressScreenshotPath = test.info().outputPath('progress-card.png');
  let cancelRequested = false;

  await page.route(/\/voice-clone\/status(?:\?.*)?$/, async (route) => {
    if (route.request().method() !== 'GET') {
      await route.continue();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        ready: true,
        state: 'ready',
        detail: 'Voice Clone runtime ready',
        device: 'GPU',
        supportsVC: true,
        providerStatus: {
          key: 'voice_clone',
          ready: true,
          detail: 'Voice Clone runtime ready',
          device: 'GPU',
          expectedGpuConcurrency: 1,
          runtimeGpuConcurrency: 1,
          concurrencyVerified: true,
        },
        runtime: {
          device: 'GPU',
          vcProvider: 'voice_clone',
        },
      }),
    });
  });

  const fulfillAfterDelay = async (route: Route, body: object): Promise<void> => {
    if (route.request().method() !== 'POST') {
      await route.continue();
      return;
    }
    await delay(1200);
    try {
      await route.fulfill({
        status: 202,
        contentType: 'application/json',
        body: JSON.stringify(body),
      });
    } catch {
      // If the user cancels in time, the aborted request will never need this response.
    }
  };

  await page.route(/\/voice-clone\/jobs\/render(?:\?.*)?$/, async (route) => {
    await fulfillAfterDelay(route, {
      ok: true,
      status: 'queued',
      requestId: 'mock-voice-clone-request',
      traceId: 'mock-voice-clone-request',
      jobId: 'mock-voice-clone-job',
      kind: 'voice_clone',
      progress: {
        percent: 12,
        stage: 'Queued for reconnect-safe processing',
        detail: 'The backend accepted the voice conversion request and will keep it reconnectable.',
      },
    });
  });

  await page.route(/\/voice-clone\/jobs\/by-request\/[^/?]+(?:\?.*)?$/i, async (route) => {
    if (route.request().method() !== 'GET') {
      await route.continue();
      return;
    }
    if (cancelRequested) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          status: 'cancelled',
          requestId: 'mock-voice-clone-request',
          jobId: 'mock-voice-clone-job',
          kind: 'voice_clone',
          error: {
            detail: 'Cloning cancelled.',
            reason: 'cancelled_by_user',
          },
        }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        status: 'running',
        requestId: 'mock-voice-clone-request',
        jobId: 'mock-voice-clone-job',
        kind: 'voice_clone',
        progress: {
          percent: 48,
          stage: 'Processing voice clone',
          detail: 'The backend is keeping this voice clone available for reconnect and refresh recovery.',
        },
      }),
    });
  });

  await page.route(/\/voice-clone\/jobs\/mock-voice-clone-job(?:\?.*)?$/, async (route) => {
    if (route.request().method() !== 'GET') {
      await route.continue();
      return;
    }
    if (cancelRequested) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          status: 'cancelled',
          requestId: 'mock-voice-clone-request',
          jobId: 'mock-voice-clone-job',
          kind: 'voice_clone',
          error: {
            detail: 'Cloning cancelled.',
            reason: 'cancelled_by_user',
          },
        }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        status: 'running',
        requestId: 'mock-voice-clone-request',
        jobId: 'mock-voice-clone-job',
        kind: 'voice_clone',
        progress: {
          percent: 48,
          stage: 'Processing voice clone',
          detail: 'The backend is keeping this voice clone available for reconnect and refresh recovery.',
        },
      }),
    });
  });

  await page.route(/\/voice-clone\/jobs\/mock-voice-clone-job\/cancel(?:\?.*)?$/i, async (route) => {
    if (route.request().method().toUpperCase() !== 'POST') {
      await route.continue();
      return;
    }
    cancelRequested = true;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        status: 'cancelled',
        requestId: 'mock-voice-clone-request',
        jobId: 'mock-voice-clone-job',
      }),
    });
  });

  await ensureStudioSmokeAuthenticated(page, credentials);

  await page.goto('/app/voices', { waitUntil: 'domcontentloaded', timeout: 120_000 });
  const voiceCloneHeading = page.getByRole('heading', { name: /Voice Cloning/i }).first();
  await expect(voiceCloneHeading).toBeVisible({ timeout: 60_000 });

  const referenceDropzoneButton = page.getByRole('button', { name: 'Drop reference audio' }).first();
  const referenceDropzoneInput = page.getByLabel('Drop reference audio').first();
  const referenceVisibleInitially = await referenceDropzoneButton.isVisible().catch(() => false);
  if (!referenceVisibleInitially) {
    const cloneTab = page.getByRole('tab', { name: /Voice Cloning/i }).first();
    const cloneButton = page.getByRole('button', { name: /Voice Cloning/i }).first();
    if (await cloneTab.isVisible().catch(() => false)) {
      await cloneTab.click({ force: true }).catch(() => undefined);
    } else if (await cloneButton.isVisible().catch(() => false)) {
      await cloneButton.click({ force: true }).catch(() => undefined);
    }
  }

  await expect(referenceDropzoneButton).toBeVisible({ timeout: 60_000 });

  const hasTargetDropzone = (await page.getByLabel('Drop target audio').count()) > 0;
  if (hasTargetDropzone) {
    await referenceDropzoneInput.setInputFiles(REFERENCE_AUDIO);
    await page.getByLabel('Drop target audio').setInputFiles(TARGET_AUDIO);
    await expect(page.getByText(REFERENCE_AUDIO_FILE).first()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(TARGET_AUDIO_FILE).first()).toBeVisible({ timeout: 30_000 });
  } else {
    await referenceDropzoneInput.setInputFiles(REFERENCE_AUDIO);
    await expect(page.getByText(REFERENCE_AUDIO_FILE).first()).toBeVisible({ timeout: 30_000 });
  }

  await Promise.any([
    page.getByRole('button', { name: /Runtime diagnostics Ready|Runtime diagnostics/i }).first().waitFor({ state: 'visible', timeout: 60_000 }),
    page.getByText(/Voice-cloning safety and consent/i).first().waitFor({ state: 'visible', timeout: 60_000 }),
    page.getByText(/native cloning creates a reusable/i).first().waitFor({ state: 'visible', timeout: 60_000 }),
  ]).catch(() => undefined);
  await checkIfVisible(page.getByRole('checkbox', { name: /explicit permission to clone it/i }));
  await checkIfVisible(page.getByRole('checkbox', { name: /not use cloned output for impersonation/i }));

  const cloneButton = page.getByRole('button', { name: /^(Start Cloning|Create .* Clone)$/i }).first();
  await expect(cloneButton).toBeVisible({ timeout: 60_000 });
  if (await cloneButton.isDisabled().catch(() => false)) {
    if (hasTargetDropzone) {
      await page.getByLabel('Drop target audio').first().setInputFiles(TARGET_AUDIO);
      await expect(page.getByText(TARGET_AUDIO_FILE).first()).toBeVisible({ timeout: 30_000 });
    }
    await checkIfVisible(page.getByRole('checkbox', { name: /explicit permission to clone it/i }));
    await checkIfVisible(page.getByRole('checkbox', { name: /not use cloned output for impersonation/i }));
  }
  await expect(cloneButton).toBeEnabled({ timeout: 60_000 });

  await cloneButton.click();

  const progressCard = page.locator('.vf-voice-clone-task');
  await expect(progressCard).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText(/Preparing reconnect-safe request|Queued for reconnect-safe processing|Processing voice clone|Restoring reconnect-safe request|Submitting root request/i)).toBeVisible({ timeout: 60_000 });

  await progressCard.screenshot({ path: progressScreenshotPath }).catch(() => undefined);

  const cancelButton = progressCard.getByRole('button', { name: /^Cancel$/i });
  await expect(cancelButton).toBeVisible({ timeout: 60_000 });
  await cancelButton.click({ force: true }).catch(async () => {
    await cancelButton.evaluate((node) => {
      if (node instanceof HTMLButtonElement) node.click();
    });
  });
  await Promise.any([
    expect(progressCard).toHaveCount(0, { timeout: 60_000 }),
    expect(progressCard.getByText(/Cancelling request|Cloning cancelled\.|Stopping automatic reconnect/i)).toBeVisible({ timeout: 60_000 }),
  ]);
  // Desktop can cancel before a backend job id is assigned, which is a valid local-abort path.
  // In that case no /cancel request is sent; the UI assertions above are the contract for success.
});
