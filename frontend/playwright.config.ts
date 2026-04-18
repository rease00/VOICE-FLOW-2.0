import { defineConfig, devices } from '@playwright/test';

type SmokeProfile = 'launch' | 'md' | 'full';

const normalizeSmokeProfile = (value: string | undefined): SmokeProfile => {
  const token = String(value || '').trim().toLowerCase();
  if (token === 'full') return 'full';
  if (token === 'md') return 'md';
  return 'launch';
};

const PORT = Number(process.env.PLAYWRIGHT_PORT || 3100);
const BASE_URL = process.env.PLAYWRIGHT_BASE_URL || `http://localhost:${PORT}`;
const REUSE_EXISTING_SERVER = process.env.PLAYWRIGHT_REUSE_SERVER === '1';
const SMOKE_PROFILE = normalizeSmokeProfile(process.env.PLAYWRIGHT_SMOKE_PROFILE);
const PLAYWRIGHT_OUTPUT_ROOT =
  SMOKE_PROFILE === 'full'
    ? '../tmp_dir/playwright/frontend-smoke-full'
    : SMOKE_PROFILE === 'md'
      ? '../tmp_dir/playwright/frontend-smoke-md'
      : '../tmp_dir/playwright/frontend-smoke';

const launchProjects = [
  {
    name: 'chromium-launch-desktop',
    use: {
      ...devices['Desktop Chrome'],
      viewport: { width: 1440, height: 900 },
      screen: { width: 1440, height: 900 },
    },
  },
];

const fullProjects = [
  { name: 'chromium-desktop', use: { ...devices['Desktop Chrome'] } },
  {
    name: 'chromium-tablet',
    use: {
      ...devices['Desktop Chrome'],
      viewport: { width: 1024, height: 1366 },
      hasTouch: true,
      deviceScaleFactor: 2,
    },
  },
  { name: 'chromium-mobile', use: { ...devices['Pixel 5'] } },
];

const desktopMobileProjects = [
  { name: 'chromium-desktop', use: { ...devices['Desktop Chrome'] } },
  { name: 'chromium-mobile', use: { ...devices['Pixel 5'] } },
];

const launchTestMatch = [/library\.spec\.ts$/, /workspace\.launch\.spec\.ts$/, /app\.backdrop\.spec\.ts$/, /studio-reader\.routes\.spec\.ts$/];
const fullTestMatch = [
  /library\.spec\.ts$/,
  /text-extraction-demo\.spec\.ts$/,
  /app\.smoke\.spec\.ts$/,
  /app\.backdrop\.spec\.ts$/,
  /manual\.casual\.demo-pack\.spec\.ts$/,
  /studio-reader\.routes\.spec\.ts$/,
  /prime\.access\.spec\.tsx?$/,
  /studio\.director-chip\.spec\.ts$/,
  /toolbar\.one-line\.devices\.spec\.ts$/,
  /workspace\.launch\.spec\.ts$/,
  /voices\.gcp-mapping\.spec\.ts$/,
  /voiceCloneStatusBackoff\.spec\.ts$/,
  /voiceCloneProgressCancel\.spec\.ts$/,
  /voiceCloneDropzoneInteractions\.spec\.ts$/,
];
const desktopMobileTestMatch = fullTestMatch;

export default defineConfig({
  globalSetup: './tests/smoke/globalSetup.ts',
  testDir: './tests/smoke',
  testMatch: SMOKE_PROFILE === 'full'
    ? fullTestMatch
    : SMOKE_PROFILE === 'md'
      ? desktopMobileTestMatch
      : launchTestMatch,
  outputDir: `${PLAYWRIGHT_OUTPUT_ROOT}/test-results`,
  timeout: SMOKE_PROFILE === 'full' ? 90_000 : 45_000,
  expect: {
    timeout: 10_000,
  },
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: [['list'], ['html', { open: 'never', outputFolder: `${PLAYWRIGHT_OUTPUT_ROOT}/report` }]],
  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
  },
  projects: SMOKE_PROFILE === 'full'
    ? fullProjects
    : SMOKE_PROFILE === 'md'
      ? desktopMobileProjects
      : launchProjects,
  webServer: {
    command: 'npm run build && npm run start',
    env: {
      ...process.env,
      NEXT_PUBLIC_ADMIN_EMAIL_ALLOWLIST:
        process.env.NEXT_PUBLIC_ADMIN_EMAIL_ALLOWLIST
        || process.env.PLAYWRIGHT_ADMIN_EMAIL
        || '',
      HOSTNAME: 'localhost',
      PORT: String(PORT),
    },
    port: PORT,
    timeout: 900_000,
    // Smoke gates should be deterministic by default and must not silently attach
    // to whichever app instance is already bound to the Playwright port.
    // Opt into reuse only for intentional manual debugging sessions.
    reuseExistingServer: REUSE_EXISTING_SERVER,
  },
});
