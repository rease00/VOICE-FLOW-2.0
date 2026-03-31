import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env.PLAYWRIGHT_PORT || 42173);
const BASE_URL = process.env.PLAYWRIGHT_BASE_URL || `http://localhost:${PORT}`;
const REUSE_EXISTING_SERVER = process.env.CI !== 'true' && process.env.PLAYWRIGHT_REUSE_SERVER !== '0';
const PLAYWRIGHT_OUTPUT_ROOT = '../tmp_dir/playwright/frontend-smoke';

export default defineConfig({
  globalSetup: './tests/smoke/globalSetup.ts',
  testDir: './tests/smoke',
  testMatch: [
    /app\.smoke\.spec\.ts$/,
    /app\.backdrop\.spec\.ts$/,
    /prime\.access\.spec\.tsx?$/,
    /reader\.admin\.catalog\.spec\.ts$/,
    /reader\.device-check\.spec\.ts$/,
    /reader\.tabs\.spec\.ts$/,
    /voices\.duno\.spec\.ts$/,
    /voiceCloneProgressCancel\.spec\.ts$/,
  ],
  outputDir: `${PLAYWRIGHT_OUTPUT_ROOT}/test-results`,
  timeout: 30_000,
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
  projects: [
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
  ],
  webServer: {
    command: 'npm run build && npm run start',
    env: {
      ...process.env,
      HOSTNAME: '127.0.0.1',
      PORT: String(PORT),
      NEXT_DIST_DIR: '.next-playwright',
    },
    port: PORT,
    timeout: 600_000,
    // Reuse local smoke servers by default so the scripted smoke gate stays green after
    // an earlier manual/direct Playwright run. Set PLAYWRIGHT_REUSE_SERVER=0 to force a fresh start.
    reuseExistingServer: REUSE_EXISTING_SERVER,
  },
});
