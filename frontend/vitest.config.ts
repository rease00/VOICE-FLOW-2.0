import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.{ts,tsx}', 'tests/**/*.test.{ts,tsx}'],
    passWithNoTests: true,
    reporters: ['default'],
    testTimeout: 15_000,
    hookTimeout: 15_000,
  },
});
