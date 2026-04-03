import { expect, test, type Page } from '@playwright/test';
import { STORAGE_KEYS } from '../../src/shared/storage/keys';
import { ensureStudioSmokeAuthenticated, resolveStudioSmokeCredentials } from './smokeAuth';

const ROUTE_TIMEOUT_MS = 45_000;

const VOICE_FIXTURE = {
  ok: true,
  engine: 'VECTOR',
  fetchedAt: new Date().toISOString(),
  voices: [
    {
      voice_id: 'v1',
      voice: 'Fenrir',
      displayName: 'Fenrir',
      name: 'Fenrir',
      gender: 'Male',
      accent: 'Indian English',
      country: 'India',
      age_group: 'Adult',
      access_tier: 'free',
    },
    {
      voice_id: 'v2',
      voice: 'Kore',
      displayName: 'Kore',
      name: 'Kore',
      gender: 'Female',
      accent: 'Indian English',
      country: 'India',
      age_group: 'Adult',
      access_tier: 'free',
    },
    {
      voice_id: 'v3',
      voice: 'Alnilam',
      displayName: 'Alnilam',
      name: 'Alnilam',
      gender: 'Male',
      accent: 'American English',
      country: 'United States',
      age_group: 'Adult',
      access_tier: 'pro',
    },
    {
      voice_id: 'v4',
      voice: 'Leda',
      displayName: 'Leda',
      name: 'Leda',
      gender: 'Female',
      accent: 'American English',
      country: 'United States',
      age_group: 'Adult',
      access_tier: 'pro',
    },
  ],
};

const ENGINE_STATUS_FIXTURE = {
  ok: true,
  fetchedAt: new Date().toISOString(),
  engines: {
    VECTOR: {
      engine: 'VECTOR',
      state: 'online',
      detail: 'Runtime online',
      ready: true,
      healthUrl: 'http://mock-runtime.local/health',
      runtimeUrl: 'http://mock-runtime.local',
      queueDepth: 0,
      oldestQueuedAgeMs: 0,
    },
  },
};

const seedStudioVoiceState = async (page: Page): Promise<void> => {
  await page.addInitScript(({ storageKeys }) => {
    localStorage.setItem(storageKeys.settings, JSON.stringify({
      engine: 'VECTOR',
      voiceId: 'v1',
      multiSpeakerEnabled: true,
      uiMotionLevel: 'off',
    }));
    localStorage.setItem(storageKeys.studioRailTab, 'voice');
    localStorage.setItem(storageKeys.studioSidebarMode, 'expanded');
    localStorage.setItem(storageKeys.uiMotionLevel, 'off');
  }, {
    storageKeys: {
      settings: STORAGE_KEYS.settings,
      studioRailTab: STORAGE_KEYS.studioRailTab,
      studioSidebarMode: STORAGE_KEYS.studioSidebarMode,
      uiMotionLevel: STORAGE_KEYS.uiMotionLevel,
    },
  });
};

const interceptTtsEndpoints = async (page: Page): Promise<void> => {
  await page.route(/\/api\/backend\/tts\/engines\/status(?:\?.*)?$/i, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(ENGINE_STATUS_FIXTURE),
    });
  });

  await page.route(/\/api\/backend\/tts\/engines\/voices(?:\?.*)?$/i, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(VOICE_FIXTURE),
    });
  });
};

const openStudioVoicePanel = async (page: Page): Promise<void> => {
  const freeSpeakers = page.getByText('Free Speakers', { exact: true }).first();
  if (await freeSpeakers.isVisible().catch(() => false)) return;

  const voiceTab = page.getByRole('button', { name: /^Voice$/i }).first();
  if (await voiceTab.isVisible().catch(() => false)) {
    await voiceTab.click({ force: true }).catch(() => undefined);
  }

  await expect(freeSpeakers).toBeVisible({ timeout: ROUTE_TIMEOUT_MS });
};

test.describe('studio voice labels', () => {
  test('restores the canonical public names while keeping gender persona labels', async ({ page }) => {
    test.setTimeout(180_000);
    const credentials = resolveStudioSmokeCredentials();
    test.skip(!credentials, 'PLAYWRIGHT_ADMIN_EMAIL and PLAYWRIGHT_ADMIN_PASSWORD are required for smoke auth.');

    await interceptTtsEndpoints(page);
    await ensureStudioSmokeAuthenticated(page, credentials!);
    await seedStudioVoiceState(page);

    await page.goto('/app/studio', { waitUntil: 'domcontentloaded', timeout: ROUTE_TIMEOUT_MS });
    await openStudioVoicePanel(page);

    const arjunChip = page.getByRole('button', { name: /Arjun India Male/i }).first();
    const meeraChip = page.getByRole('button', { name: /Meera India Female/i }).first();
    const alnilamChip = page.getByRole('button', { name: /Ethan US Male/i }).first();
    const avaChip = page.getByRole('button', { name: /Ava US Female/i }).first();

    await expect(arjunChip).toBeVisible({ timeout: ROUTE_TIMEOUT_MS });
    await expect(meeraChip).toBeVisible({ timeout: ROUTE_TIMEOUT_MS });
    await expect(alnilamChip).toBeVisible({ timeout: ROUTE_TIMEOUT_MS });
    await expect(avaChip).toBeVisible({ timeout: ROUTE_TIMEOUT_MS });

    await expect(arjunChip).toContainText('Male Adult');
    await expect(meeraChip).toContainText('Female Adult');
    await expect(alnilamChip).toContainText('Male Adult');
    await expect(avaChip).toContainText('Female Adult');
  });
});
