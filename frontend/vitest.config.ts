import path from 'node:path';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  esbuild: {
    jsx: 'automatic',
  },
  resolve: {
    alias: { '@': path.resolve(__dirname, 'src') },
  },
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
