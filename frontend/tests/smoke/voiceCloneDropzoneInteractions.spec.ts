import { expect, test, type Page } from '@playwright/test';
import { ensureStudioSmokeAuthenticated, resolveStudioSmokeCredentials } from './smokeAuth';

const ROUTE_TIMEOUT_MS = 30_000;

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

const uploadThroughPicker = async (page: Page, label: string, file: { name: string; mimeType: string; buffer: Buffer }): Promise<void> => {
  const control = page.getByRole('button', { name: label }).first();
  const hiddenInput = page.getByLabel(label).first();
  await expect(control).toBeVisible({ timeout: ROUTE_TIMEOUT_MS });
  await expect(hiddenInput).not.toBeVisible({ timeout: ROUTE_TIMEOUT_MS });
  const chooserPromise = page.waitForEvent('filechooser', { timeout: ROUTE_TIMEOUT_MS });
  await control.click();
  const chooser = await chooserPromise;
  await chooser.setFiles(file);
};

test('voice cloning upload cards open the picker and accept files on all utilities', async ({ page }) => {
  test.setTimeout(180_000);
  const credentials = resolveStudioSmokeCredentials();
  test.skip(!credentials, 'PLAYWRIGHT_ADMIN_EMAIL and PLAYWRIGHT_ADMIN_PASSWORD are required for the upload smoke flow.');

  await ensureStudioSmokeAuthenticated(page, credentials);
  await page.goto('/app/voices', { waitUntil: 'domcontentloaded', timeout: 120_000 });

  const cloneTab = page.getByRole('tab', { name: /^Voice Cloning\b/i }).first();
  await expect(cloneTab).toBeVisible({ timeout: ROUTE_TIMEOUT_MS });
  await cloneTab.click();
  await expect(cloneTab).toHaveAttribute('aria-selected', 'true', { timeout: ROUTE_TIMEOUT_MS });

  const referenceWav = createReferenceWavBuffer();
  const targetWav = createReferenceWavBuffer(0.4, 16_000);

  await uploadThroughPicker(page, 'Drop reference audio', {
    name: 'reference.wav',
    mimeType: 'audio/wav',
    buffer: referenceWav,
  });
  await expect(page.getByText('reference.wav').first()).toBeVisible({ timeout: ROUTE_TIMEOUT_MS });

  const targetDropzone = page.getByRole('button', { name: 'Drop target audio' }).first();
  if (await targetDropzone.count()) {
    await uploadThroughPicker(page, 'Drop target audio', {
      name: 'target.wav',
      mimeType: 'audio/wav',
      buffer: targetWav,
    });
    await expect(page.getByText('target.wav').first()).toBeVisible({ timeout: ROUTE_TIMEOUT_MS });
  }

  const separateTab = page.getByRole('tab', { name: /^Extract Voice \+ BG/i }).first();
  await expect(separateTab).toBeVisible({ timeout: ROUTE_TIMEOUT_MS });
  await separateTab.click();
  await expect(separateTab).toHaveAttribute('aria-selected', 'true', { timeout: ROUTE_TIMEOUT_MS });
  await uploadThroughPicker(page, 'Drop source mix audio', {
    name: 'source-mix.wav',
    mimeType: 'audio/wav',
    buffer: createReferenceWavBuffer(0.5, 16_000),
  });
  await expect(page.getByText('source-mix.wav').first()).toBeVisible({ timeout: ROUTE_TIMEOUT_MS });
});
