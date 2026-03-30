import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: '../../tests/smoke',
  testMatch: /reader\.device-check\.temp\.spec\.ts$/,
  timeout: 30_000,
  expect: {
    timeout: 10_000,
  },
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:3000',
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
});
