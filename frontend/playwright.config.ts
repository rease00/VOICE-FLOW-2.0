import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env.PLAYWRIGHT_PORT || 42173);
const BASE_URL = process.env.PLAYWRIGHT_BASE_URL || `http://localhost:${PORT}`;
const REUSE_EXISTING_SERVER = process.env.CI !== 'true' && process.env.PLAYWRIGHT_REUSE_SERVER !== '0';
const SMOKE_PROFILE = process.env.PLAYWRIGHT_SMOKE_PROFILE === 'full' ? 'full' : 'launch';
const PLAYWRIGHT_OUTPUT_ROOT =
  SMOKE_PROFILE === 'full'
    ? '../tmp_dir/playwright/frontend-smoke-full'
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

export default defineConfig({
  globalSetup: './tests/smoke/globalSetup.ts',
  testDir: './tests/smoke',
  testMatch:
    SMOKE_PROFILE === 'full'
      ? [
          /app\.smoke\.spec\.ts$/,
          /app\.backdrop\.spec\.ts$/,
          /prime\.access\.spec\.tsx?$/,
          /reader\.admin\.catalog\.spec\.ts$/,
          /reader\.device-check\.spec\.ts$/,
          /reader\.tabs\.spec\.ts$/,
          /studio\.director-chip\.spec\.ts$/,
          /duno-switch-3devices\.spec\.ts$/,
          /toolbar\.one-line\.devices\.spec\.ts$/,
          /workspace\.launch\.spec\.ts$/,
          /voices\.gcp-mapping\.spec\.ts$/,
          /voices\.duno\.spec\.ts$/,
          /voiceCloneProgressCancel\.spec\.ts$/,
          /voiceCloneDropzoneInteractions\.spec\.ts$/,
        ]
      : [/workspace\.launch\.spec\.ts$/, /app\.backdrop\.spec\.ts$/],
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
  projects: SMOKE_PROFILE === 'full' ? fullProjects : launchProjects,
  webServer: {
    command: 'npm run build && npm run start',
    env: {
      ...process.env,
      HOSTNAME: 'localhost',
      PORT: String(PORT),
    },
    port: PORT,
    timeout: 900_000,
    // Reuse local smoke servers by default so the scripted smoke gate stays green after
    // an earlier manual/direct Playwright run. Set PLAYWRIGHT_REUSE_SERVER=0 to force a fresh start.
    reuseExistingServer: REUSE_EXISTING_SERVER,
  },
});
