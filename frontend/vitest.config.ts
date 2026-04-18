import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.{ts,tsx}', 'tests/**/*.test.{ts,tsx}'],
    passWithNoTests: true,
    reporters: ['default'],
    testTimeout: 15_000,
    hookTimeout: 15_000,
    // Keep CI stable on Windows where high worker fan-out can intermittently
    // trigger tinypool IPC channel closures at process shutdown.
    maxWorkers: 4,
  },
});
