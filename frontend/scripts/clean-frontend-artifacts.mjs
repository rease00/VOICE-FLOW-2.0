#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const frontendDir = path.resolve(scriptDir, '..');
const repoRoot = path.resolve(frontendDir, '..');

const targets = [
  path.join(repoRoot, 'dist'),
  path.join(frontendDir, '.next'),
  path.join(frontendDir, '.open-next'),
  path.join(frontendDir, 'dist'),
  path.join(frontendDir, 'out'),
  path.join(frontendDir, 'index.html'),
  path.join(frontendDir, 'index.tsx'),
  path.join(frontendDir, 'App.tsx'),
  path.join(frontendDir, 'src', 'main.tsx'),
  path.join(frontendDir, 'vite.config.ts'),
  path.join(frontendDir, 'tsconfig.tsbuildinfo'),
  path.join(frontendDir, 'src', 'pages'),
  path.join(frontendDir, 'app', '(workspace)'),
];

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
