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
      lowered.includes('@firebase/firestore: firestore')
      || lowered.includes('could not reach cloud firestore backend')
      || lowered.includes('the client will operate in offline mode')
      || lowered.includes('failed to load resource: the server responded with a status of 403')
      || lowered.includes('failed to load resource: the server responded with a status of 404')
    ) {
      return;
    }
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
      if (!/\/api\/backend\/tts\/engines\/status|\/api\/backend\/voice-clone\/duno|\/api\/backend\/routing\/regions|\/tts\/engines\/status|\/voice-clone\/duno/i.test(url)) {
        if (/firestore\.googleapis\.com\/google\.firestore\.v1\.firestore\/listen\/channel/i.test(url)) {
          return;
        }
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

const checkVisibleCheckbox = async (checkbox: ReturnType<Page['getByRole']>): Promise<void> => {
  const target = checkbox.first();
  const visible = await target.isVisible().catch(() => false);
  if (!visible) return;
  const checked = await target.isChecked().catch(() => false);
  if (checked) return;
  await target.click({ force: true }).catch(() => undefined);
};

test('voices route handles DUNO clone readiness and preview controls', async ({ page }) => {
  test.setTimeout(180_000);
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

  await page.route(/\/api\/backend\/routing\/regions(?:\?.*)?$/i, async (route) => {
    if (route.request().method().toUpperCase() !== 'GET') {
      await route.continue();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        regions: [
          { id: 'english', label: 'English', locale: 'en' },
        ],
      }),
    });
  });

  await ensureStudioSmokeAuthenticated(page, credentials);
  await page.goto('/app/voices', { waitUntil: 'domcontentloaded', timeout: ROUTE_TIMEOUT_MS });
  let backendAvailable = false;
  try {
    const health = await page.request.get('/api/backend/health', { timeout: 6000 });
    backendAvailable = health.ok();
  } catch {
    backendAvailable = false;
  }
  test.skip(!backendAvailable, 'Backend proxy is unavailable; skipping DUNO clone smoke.');

  await expect(page.getByRole('heading', { name: /Voice Cloning/i })).toBeVisible({ timeout: ROUTE_TIMEOUT_MS });
  const cloneTab = page.getByRole('tab', { name: /^Voice Cloning\b/i }).first();
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

  await checkVisibleCheckbox(page.getByRole('checkbox', { name: /I confirm I own this voice or have explicit permission to clone it\./i }));
  await checkVisibleCheckbox(page.getByRole('checkbox', { name: /I will not use cloned output for impersonation, fraud, or harmful deception\./i }));

  const submitButton = page.getByRole('button', { name: /^(Create .* Clone|Start Cloning)$/i }).first();
  await expect(submitButton).toBeVisible({ timeout: ROUTE_TIMEOUT_MS });
  const dunoRuntimeButton = page.getByRole('button', { name: /Duno runtime:/i }).first();
  let runtimeLabel = '';
  if (await dunoRuntimeButton.count()) {
    await expect(dunoRuntimeButton).toBeVisible({ timeout: ROUTE_TIMEOUT_MS });
    await expect(dunoRuntimeButton).toHaveAttribute('aria-label', /(Online|Offline|Not Set)/i, { timeout: ROUTE_TIMEOUT_MS });
    runtimeLabel = String(await dunoRuntimeButton.getAttribute('aria-label') || '');
  }

  if (/Online/i.test(runtimeLabel)) {
    await expect(submitButton).toBeEnabled({ timeout: ROUTE_TIMEOUT_MS });
    await submitButton.click();

    await expect(page.getByRole('heading', { name: /Cloning result/i })).toBeVisible({ timeout: ROUTE_TIMEOUT_MS });
    await expect(page.locator('audio').first()).toBeVisible({ timeout: ROUTE_TIMEOUT_MS });
    await expect(page.getByRole('link', { name: /Download output/i })).toBeVisible({ timeout: ROUTE_TIMEOUT_MS });
  }

  assertRouteHealth();
});
