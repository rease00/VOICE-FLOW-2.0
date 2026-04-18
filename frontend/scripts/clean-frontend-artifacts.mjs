#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const frontendDir = path.resolve(scriptDir, '..');
const repoRoot = path.resolve(frontendDir, '..');

const targets = [
  path.join(repoRoot, 'dist'),
  path.join(repoRoot, '.playwright-cli'),
  path.join(repoRoot, '.playwright-mcp'),
  path.join(repoRoot, 'nul'),
  path.join(repoRoot, 'frontend', 'nul'),
  path.join(frontendDir, '.next'),
  path.join(frontendDir, '.open-next'),
  path.join(frontendDir, '.codex-logs'),
  path.join(frontendDir, 'dist'),
  path.join(frontendDir, 'out'),
  path.join(frontendDir, 'index.html'),
  path.join(frontendDir, 'index.tsx'),
  path.join(frontendDir, 'App.tsx'),
  path.join(frontendDir, 'tmp_dir', 'playwright'),
  path.join(frontendDir, 'src', 'main.tsx'),
  path.join(frontendDir, 'vite.config.ts'),
  path.join(frontendDir, 'tsconfig.tsbuildinfo'),
  path.join(frontendDir, 'src', 'pages'),
  path.join(frontendDir, 'app', '(workspace)'),
];

const removableRootFileMatchers = [
  /^C.?.*tempMainApp_(backup.*|full)\.ts$/i,
  /^C.?.*Users.*voice-Flow.*\.ts$/i,
];
const removableRootEntryMatchers = [
  /^C.?.*Users.*voice-Flow.*$/i,
];

const removed = [];
const skipped = [];

const removeTarget = (target, recursive = true) => {
  try {
    fs.rmSync(target, {
      recursive,
      force: true,
      maxRetries: 2,
    });
    removed.push(path.relative(repoRoot, target).split(path.sep).join('/'));
  } catch (error) {
    skipped.push({
      target: path.relative(repoRoot, target).split(path.sep).join('/'),
      error: error instanceof Error ? error.message : String(error),
    });
  }
};

for (const target of targets) {
  if (!fs.existsSync(target)) continue;
  removeTarget(target, true);
}

for (const entry of fs.readdirSync(repoRoot, { withFileTypes: true })) {
  const shouldRemoveFile = entry.isFile()
    && removableRootFileMatchers.some((matcher) => matcher.test(entry.name));
  const shouldRemoveEntry = removableRootEntryMatchers.some((matcher) => matcher.test(entry.name));
  if (!shouldRemoveFile && !shouldRemoveEntry) continue;
  const target = path.join(repoRoot, entry.name);
  removeTarget(target, entry.isDirectory());
}

if (removed.length === 0 && skipped.length === 0) {
  console.log('[clean-frontend-artifacts] No forbidden frontend artifacts found.');
  process.exit(0);
}

if (removed.length > 0) {
  console.log('[clean-frontend-artifacts] Removed:');
  for (const item of removed) {
    console.log(`- ${item}`);
  }
}

if (skipped.length > 0) {
  console.warn('[clean-frontend-artifacts] Skipped:');
  for (const item of skipped) {
    console.warn(`- ${item.target}: ${item.error}`);
  }
}
