import { expect, test, type Page } from '@playwright/test';
import { ensureStudioSmokeAuthenticated, resolveStudioSmokeCredentials } from './smokeAuth';

const ROUTE_TIMEOUT_MS = 30_000;

const trackRouteHealth = (page: Page) => {
  const consoleIssues: string[] = [];
  const pageErrors: string[] = [];

  page.on('console', (message) => {
    const text = message.text().trim();
    if (!text) return;
    const lowered = text.toLowerCase();
    if (
      message.type() === 'error'
      || lowered.includes('hydration failed')
      || lowered.includes('text content does not match server-rendered html')
    ) {
      consoleIssues.push(`[console:${message.type()}] ${text}`);
    }
  });

  page.on('pageerror', (error) => {
    pageErrors.push(error.message);
  });

  page.on('response', (response) => {
    const status = response.status();
    if (status >= 400) {
      const url = response.url();
      if (!/\/api\/backend\/tts\/engines\/status|\/api\/backend\/voice-clone\/duno|\/tts\/engines\/status|\/voice-clone\/duno/i.test(url)) {
        consoleIssues.push(`[response:${status}] ${url}`);
      }
    }
  });

  return () => {
    const problems = [...consoleIssues.map((message) => `- ${message}`), ...pageErrors.map((message) => `- [pageerror] ${message}`)];
    expect(problems, problems.join('\n')).toEqual([]);
  };
};

const createReferenceWavBuffer = (durationSec = 0.35, sampleRate = 16_000): Buffer => {
  const frames = Math.max(1, Math.floor(durationSec * sampleRate));
  const bytesPerSample = 2;
  const dataLength = frames * bytesPerSample;
  const buffer = Buffer.alloc(44 + dataLength);

  buffer.write('RIFF', 0, 'ascii');
  buffer.writeUInt32LE(36 + dataLength, 4);
  buffer.write('WAVE', 8, 'ascii');
  buffer.write('fmt ', 12, 'ascii');
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * bytesPerSample, 28);
  buffer.writeUInt16LE(bytesPerSample, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36, 'ascii');
  buffer.writeUInt32LE(dataLength, 40);

  for (let index = 0; index < frames; index += 1) {
    const t = index / sampleRate;
    const sample = Math.sin(2 * Math.PI * 220 * t) * 0.2;
    const int16 = Math.max(-1, Math.min(1, sample)) < 0
      ? Math.round(Math.max(-1, Math.min(1, sample)) * 0x8000)
      : Math.round(Math.max(-1, Math.min(1, sample)) * 0x7fff);
    buffer.writeInt16LE(int16, 44 + (index * bytesPerSample));
  }

  return buffer;
};

test('voices route handles DUNO clone readiness and preview controls', async ({ page }) => {
  const credentials = resolveStudioSmokeCredentials();
  test.skip(!credentials, 'PLAYWRIGHT_ADMIN_EMAIL and PLAYWRIGHT_ADMIN_PASSWORD are required for the DUNO smoke flow.');

  const assertRouteHealth = trackRouteHealth(page);
  const dunoSettings = {
    engine: 'DUNO',
  };

  await page.addInitScript((settings) => {
    try {
      localStorage.setItem('vf_settings', JSON.stringify(settings));
    } catch {
      // no-op
    }
  }, dunoSettings);

  await ensureStudioSmokeAuthenticated(page, credentials);
  await page.goto('/app/voices', { waitUntil: 'domcontentloaded', timeout: ROUTE_TIMEOUT_MS });

  await expect(page.getByRole('heading', { name: /Premium desktop voice operations/i })).toBeVisible({ timeout: ROUTE_TIMEOUT_MS });
  const cloneTab = page.getByRole('tab', { name: /^Clone\b/i });
  await expect(cloneTab).toBeVisible({ timeout: ROUTE_TIMEOUT_MS });
  await cloneTab.click();
  await expect(cloneTab).toHaveAttribute('aria-selected', 'true', { timeout: ROUTE_TIMEOUT_MS });
  await expect(page.getByLabel('Drop reference audio')).toBeVisible({ timeout: ROUTE_TIMEOUT_MS });

  const referenceWav = createReferenceWavBuffer();
  await page.getByLabel('Drop reference audio').setInputFiles({
    name: 'reference.wav',
    mimeType: 'audio/wav',
    buffer: referenceWav,
  });

  await page.getByRole('checkbox', { name: /I confirm I own this voice or have explicit permission to clone it\./i }).check();
  await page.getByRole('checkbox', { name: /I will not use cloned output for impersonation, fraud, or harmful deception\./i }).check();

  const submitButton = page.getByRole('button', { name: /Create DUNO Clone/i });
  await expect(submitButton).toBeVisible({ timeout: ROUTE_TIMEOUT_MS });
  const dunoRuntimeButton = page.getByRole('button', { name: /Duno runtime:/i }).first();
  await expect(dunoRuntimeButton).toBeVisible({ timeout: ROUTE_TIMEOUT_MS });
  await expect(dunoRuntimeButton).toHaveAttribute('aria-label', /(Online|Offline|Not Set)/i, { timeout: ROUTE_TIMEOUT_MS });

  const runtimeLabel = String(await dunoRuntimeButton.getAttribute('aria-label') || '');
  if (/Online/i.test(runtimeLabel)) {
    await expect(submitButton).toBeEnabled({ timeout: ROUTE_TIMEOUT_MS });
    await submitButton.click();

    await expect(page.getByRole('heading', { name: /Cloning result/i })).toBeVisible({ timeout: ROUTE_TIMEOUT_MS });
    await expect(page.locator('audio').first()).toBeVisible({ timeout: ROUTE_TIMEOUT_MS });
    await expect(page.getByRole('link', { name: /Download output/i })).toBeVisible({ timeout: ROUTE_TIMEOUT_MS });
  } else {
    expect(runtimeLabel).toMatch(/Offline|Not Set/i);
    await expect(submitButton).toBeDisabled({ timeout: ROUTE_TIMEOUT_MS });
  }

  assertRouteHealth();
});
