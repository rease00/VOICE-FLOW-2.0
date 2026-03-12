#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const frontendDir = path.resolve(scriptDir, '..');
const repoRoot = path.resolve(frontendDir, '..');

const targets = [
  path.join(repoRoot, 'dist'),
  path.join(frontendDir, 'app'),
  path.join(frontendDir, 'next-env.d.ts'),
  path.join(frontendDir, 'next.config.js'),
  path.join(frontendDir, 'next.config.mjs'),
  path.join(frontendDir, 'next.config.cjs'),
  path.join(frontendDir, 'next.config.ts'),
];

for (const entry of fs.readdirSync(frontendDir, { withFileTypes: true })) {
  if (!entry.name.startsWith('.next')) continue;
  targets.push(path.join(frontendDir, entry.name));
}

const removed = [];
for (const target of targets) {
  if (!fs.existsSync(target)) continue;
  fs.rmSync(target, {
    recursive: true,
    force: true,
    maxRetries: 2,
  });
  removed.push(path.relative(repoRoot, target).split(path.sep).join('/'));
}

if (removed.length === 0) {
  console.log('[clean-frontend-artifacts] No forbidden frontend artifacts found.');
  process.exit(0);
}

console.log('[clean-frontend-artifacts] Removed:');
for (const item of removed) {
  console.log(`- ${item}`);
}
