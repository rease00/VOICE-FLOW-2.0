import { expect, test, type Route } from '@playwright/test';
import { ensureStudioSmokeAuthenticated, resolveStudioSmokeCredentials } from './smokeAuth';
import fs from 'node:fs';
import path from 'node:path';

const ROOT_DIR = path.resolve(process.cwd(), '..');
const PROGRESS_SCREENSHOT = path.resolve(
  ROOT_DIR,
  'tmp_dir',
  'playwright',
  'voice-clone-progress-cancel',
  'progress-card.png'
);
const REFERENCE_AUDIO = path.resolve(ROOT_DIR, 'backend', 'assets', 'voice_profiles', 'reference', 'p03_us_m_adult.wav');
const TARGET_AUDIO = path.resolve(ROOT_DIR, 'backend', 'assets', 'voice_profiles', 'reference', 'p04_us_f_adult.wav');

const buildDataUrl = (filePath: string): string => {
  const mimeType = 'audio/wav';
  const base64 = fs.readFileSync(filePath).toString('base64');
  return `data:${mimeType};base64,${base64}`;
};

test('voice-clone root progress card supports cancel from the top level', async ({ page }) => {
  const credentials = resolveStudioSmokeCredentials();
  test.skip(!credentials, 'Studio smoke credentials are required for this verification.');

  const audioDataUrl = buildDataUrl(REFERENCE_AUDIO);
  fs.mkdirSync(path.dirname(PROGRESS_SCREENSHOT), { recursive: true });

  await page.route(/\/voice-clone\/openvoice\/status(?:\?.*)?$/, async (route) => {
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
        detail: 'OpenVoice runtime ready',
        device: 'GPU',
        supportsVC: true,
        providerStatus: {
          key: 'OpenVoice',
          ready: true,
          detail: 'OpenVoice runtime ready',
          device: 'GPU',
          expectedGpuConcurrency: 1,
          runtimeGpuConcurrency: 1,
          concurrencyVerified: true,
        },
        runtime: {
          device: 'GPU',
          vcProvider: 'OpenVoice',
        },
      }),
    });
  });

  const fulfillAfterDelay = async (route: Route, body: object): Promise<void> => {
    if (route.request().method() !== 'POST') {
      await route.continue();
      return;
    }
    await page.waitForTimeout(2500);
    try {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(body),
      });
    } catch {
      // If the user cancels in time, the aborted request will never need this response.
    }
  };

  await page.route(/\/voice-clone\/openvoice(?:\?.*)?$/, async (route) => {
    await fulfillAfterDelay(route, {
      ok: true,
      status: 'completed',
      mode: 'vc',
      runKind: 'warm',
      requestId: 'mock-openvoice-request',
      traceId: 'mock-openvoice-request',
      artifact: {
        downloadUrl: audioDataUrl,
        contentType: 'audio/wav',
        fileName: 'mock-openvoice.wav',
      },
    });
  });

  await page.route(/\/voice-clone\/duno\/native(?:\?.*)?$/, async (route) => {
    await fulfillAfterDelay(route, {
      ok: true,
      status: 'completed',
      mode: 'vc',
      runKind: 'warm',
      requestId: 'mock-duno-request',
      traceId: 'mock-duno-request',
      clonedVoice: {
        id: 'mock-duno-clone',
        name: 'Mock DUNO Clone',
        sourceVoiceName: 'Mock Reference',
        sourceVoiceEngine: 'DUNO',
        previewUrl: audioDataUrl,
        referenceAudioUrl: audioDataUrl,
        originalSampleUrl: audioDataUrl,
      },
    });
  });

  await ensureStudioSmokeAuthenticated(page, credentials);

  await page.goto('/app/voices', { waitUntil: 'domcontentloaded', timeout: 120_000 });
  await expect(page.getByLabel('Drop reference audio')).toBeVisible({ timeout: 60_000 });

  const hasTargetDropzone = (await page.getByLabel('Drop target audio').count()) > 0;
  if (hasTargetDropzone) {
    await page.getByLabel('Drop reference audio').setInputFiles(REFERENCE_AUDIO);
    await page.getByLabel('Drop target audio').setInputFiles(TARGET_AUDIO);
  } else {
    await page.getByLabel('Drop reference audio').setInputFiles(REFERENCE_AUDIO);
  }

  const consentCheckbox = page.getByRole('checkbox', { name: /explicit permission to clone it/i });
  if (await consentCheckbox.count()) {
    await consentCheckbox.check();
  }
  const safetyCheckbox = page.getByRole('checkbox', { name: /not use cloned output for impersonation/i });
  if (await safetyCheckbox.count()) {
    await safetyCheckbox.check();
  }

  const cloneButton = page.getByRole('button', { name: /^(Start Cloning|Create .* Clone)$/i }).first();
  await expect(cloneButton).toBeVisible({ timeout: 60_000 });
  await expect(cloneButton).toBeEnabled({ timeout: 60_000 });

  await cloneButton.click();

  const progressCard = page.locator('.vf-voice-clone-task');
  await expect(progressCard).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText('Submitting root request')).toBeVisible({ timeout: 60_000 });

  await progressCard.screenshot({ path: PROGRESS_SCREENSHOT });

  const cancelButton = progressCard.getByRole('button', { name: /^Cancel$/i });
  await expect(cancelButton).toBeVisible({ timeout: 60_000 });
  await cancelButton.click();

  await expect(page.getByText(/Cloning cancelled\./i)).toBeVisible({ timeout: 60_000 });
  await expect(progressCard).toHaveCount(0, { timeout: 60_000 });
});
