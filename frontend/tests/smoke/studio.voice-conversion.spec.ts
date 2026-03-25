import { expect, test } from '@playwright/test';
import { ensureStudioSmokeAuthenticated, resolveStudioSmokeCredentials } from './smokeAuth';

const buildSmokeWavBuffer = (durationMs = 360): Buffer => {
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
    const sample = Math.round(Math.sin(index / 12) * 9000);
    buffer.writeInt16LE(sample, 44 + (index * bytesPerSample));
  }

  return buffer;
};

test('vc tab exposes voice conversion controls and keeps character editing free of VC tools', async ({ page }) => {
  test.setTimeout(90_000);

  const credentials = resolveStudioSmokeCredentials() || {
    email: 'admin@local.admin',
    password: '',
    username: 'admin',
  };
  await ensureStudioSmokeAuthenticated(page, credentials, { workspacePath: '/?vf-screen=main&vf-tab=STUDIO' });

  const vcTabButton = page.getByRole('button', { name: /^VC$/i }).first();
  await expect(vcTabButton).toBeVisible();
  await vcTabButton.click();

  await expect(page.getByRole('heading', { name: /Voice conversion workspace/i }).first()).toBeVisible({ timeout: 30_000 });

  const vcToggleButton = page.getByRole('button', { name: /VC\s+(On|Off)/i }).first();
  await expect(vcToggleButton).toBeVisible();

  const vcInput = page.locator('input[type="file"][accept*="audio"]').first();
  await vcInput.setInputFiles({
    name: 'vc-reference.wav',
    mimeType: 'audio/wav',
    buffer: buildSmokeWavBuffer(),
  });

  await expect(page.getByText(/Attached:\s*vc-reference\.wav/i).first()).toBeVisible();
  await expect(page.getByRole('button', { name: /Clear sample/i }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: /Clone Voice/i }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: /Seed-VC GPU/i }).first()).toBeVisible();

  await page.getByRole('button', { name: /Seed-VC GPU/i }).first().click();
  await expect(page).toHaveURL(/vf-tab=LAB/);
  await expect(page.getByTestId('lab-panel')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('lab-panel')).toContainText(/Seed-VC/i);

  await expect(page.getByText('Interface Error')).toHaveCount(0);
});
