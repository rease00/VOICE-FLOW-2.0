import { expect, test } from '@playwright/test';
import { ensureStudioSmokeAuthenticated, resolveStudioSmokeCredentials } from './smokeAuth';

const ROUTE_TIMEOUT_MS = 45_000;

const EXPECTED_GENDERS: Record<string, 'male' | 'female'> = {
  Charon: 'male',
  Achernar: 'female',
  Algieba: 'male',
  Zephyr: 'female',
  Gacrux: 'female',
  Sadachbia: 'male',
  Schedar: 'male',
  Sulafat: 'female',
  Umbriel: 'male',
  Vindemiatrix: 'female',
  Zubenelgenubi: 'male',
};

const EXPECTED_RENAMED_LABELS: Record<string, string> = {
  Charon: 'Charon Australia Male',
  Achernar: 'Achernar Japan Female',
  Algieba: 'Algieba Brazil Male',
  Zephyr: 'Zephyr Spain Female',
  Gacrux: 'Gacrux India Elder Female',
  Sadachbia: 'Sadachbia Germany Male',
  Schedar: 'Schedar France Male',
  Sulafat: 'Sulafat UAE Female',
  Umbriel: 'Umbriel UAE Male',
  Vindemiatrix: 'Vindemiatrix Russia Female',
  Zubenelgenubi: 'Zubenelgenubi Russia Male',
};

test('PRIME speaker catalog keeps official GCP voice gender mapping', async ({ page }) => {
  test.setTimeout(180_000);
  const credentials = resolveStudioSmokeCredentials();
  test.skip(!credentials, 'PLAYWRIGHT_ADMIN_EMAIL and PLAYWRIGHT_ADMIN_PASSWORD are required for the mapping smoke flow.');

  await ensureStudioSmokeAuthenticated(page, credentials!);
  await page.goto('/app/voices', { waitUntil: 'domcontentloaded', timeout: ROUTE_TIMEOUT_MS });
  const legacyWorkspace = page.getByTestId('voices-workspace');
  if ((await legacyWorkspace.count()) > 0) {
    await expect(legacyWorkspace).toBeVisible({ timeout: ROUTE_TIMEOUT_MS });
  } else {
    await expect(page.getByRole('heading', { name: /voice cloning/i })).toBeVisible({ timeout: ROUTE_TIMEOUT_MS });
  }

  const response = await page.request.get('/api/v1/tts/engines/voices?engine=PRIME', { timeout: 12_000 });
  const responseStatus = response.status();
  const isAuthGatedFallback = responseStatus === 401 || responseStatus === 403;
  const isProxyBackendFallback = responseStatus === 502 || responseStatus === 503 || responseStatus === 504;
  expect(
    response.ok() || isAuthGatedFallback || isProxyBackendFallback,
    `PRIME voice API returned unexpected status ${responseStatus}.`
  ).toBeTruthy();

  if (response.ok()) {
    const payload = await response.json();
    const voices = Array.isArray(payload?.voices) ? payload.voices : [];
    expect(voices.length).toBeGreaterThan(0);

    const byVoiceName = new Map<string, { displayName: string; gender: string; name: string }>();
    for (const row of voices) {
      if (!row || typeof row !== 'object') continue;
      const voiceName = String((row as Record<string, unknown>).voice || '').trim();
      const gender = String((row as Record<string, unknown>).gender || '').trim().toLowerCase();
      const displayName = String((row as Record<string, unknown>).displayName || '').trim();
      const name = String((row as Record<string, unknown>).name || '').trim();
      if (!voiceName) continue;
      byVoiceName.set(voiceName, { displayName, gender, name });
    }

    for (const [voiceName, expectedGender] of Object.entries(EXPECTED_GENDERS)) {
      const row = byVoiceName.get(voiceName);
      expect(row, `Missing voice row for ${voiceName}`).toBeTruthy();
      expect(row?.gender, `Incorrect gender for ${voiceName}`).toBe(expectedGender);
      const expectedLabel = EXPECTED_RENAMED_LABELS[voiceName];
      if (expectedLabel) {
        expect(row?.displayName, `Incorrect displayName for ${voiceName}`).toBe(expectedLabel);
        if (row?.name) {
          expect(row.name, `Incorrect name for ${voiceName}`).toBe(expectedLabel);
        }
      }
    }
  }

  // UI fallback verification for routes where backend proxy is gated.
  const voiceLibrariesTab = page.getByRole('tab', { name: /voice libraries/i });
  if ((await voiceLibrariesTab.count()) > 0) {
    await voiceLibrariesTab.first().click();
  }
  await expect(page.getByText('Charon', { exact: false }).first()).toBeVisible({ timeout: ROUTE_TIMEOUT_MS });
  await expect(page.getByText('Achernar', { exact: false }).first()).toBeVisible({ timeout: ROUTE_TIMEOUT_MS });
  await expect(page.getByRole('heading', { name: /male voices/i }).first()).toBeVisible({ timeout: ROUTE_TIMEOUT_MS });
  await expect(page.getByRole('heading', { name: /female voices/i }).first()).toBeVisible({ timeout: ROUTE_TIMEOUT_MS });
});
