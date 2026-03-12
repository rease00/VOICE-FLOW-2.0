#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const frontendDir = path.resolve(scriptDir, '..');
const repoRoot = path.resolve(frontendDir, '..');

const toPosix = (value) => value.split(path.sep).join('/');
const relativeToRoot = (absolutePath) => toPosix(path.relative(repoRoot, absolutePath));
const exists = (absolutePath) => fs.existsSync(absolutePath);

const violations = [];

const addViolation = (relativePath, reason) => {
  violations.push({ relativePath, reason });
};

const requiredFrontendPackage = path.join(frontendDir, 'package.json');
if (!exists(requiredFrontendPackage)) {
  addViolation('frontend/package.json', 'missing primary frontend package');
}

const forbiddenStaticTargets = [
  { absolutePath: path.join(repoRoot, 'dist'), reason: 'stale alternate frontend output is forbidden' },
  { absolutePath: path.join(frontendDir, 'app'), reason: 'Next.js app directory is forbidden in the Vite frontend' },
  { absolutePath: path.join(frontendDir, 'next-env.d.ts'), reason: 'Next.js environment file is forbidden in the Vite frontend' },
  { absolutePath: path.join(frontendDir, 'next.config.js'), reason: 'Next.js config is forbidden in the Vite frontend' },
  { absolutePath: path.join(frontendDir, 'next.config.mjs'), reason: 'Next.js config is forbidden in the Vite frontend' },
  { absolutePath: path.join(frontendDir, 'next.config.cjs'), reason: 'Next.js config is forbidden in the Vite frontend' },
  { absolutePath: path.join(frontendDir, 'next.config.ts'), reason: 'Next.js config is forbidden in the Vite frontend' },
];

for (const target of forbiddenStaticTargets) {
  if (exists(target.absolutePath)) {
    addViolation(relativeToRoot(target.absolutePath), target.reason);
  }
}

for (const entry of fs.readdirSync(frontendDir, { withFileTypes: true })) {
  if (!entry.name.startsWith('.next')) continue;
  addViolation(`frontend/${entry.name}`, 'Next.js build artifact is forbidden in the Vite frontend');
}

const allowedTopLevelPackages = new Set(['backend', 'frontend', 'node_modules']);
const frontendRootNamePattern = /(front|frontend|web|ui|client|next-app)/i;
for (const entry of fs.readdirSync(repoRoot, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  if (allowedTopLevelPackages.has(entry.name)) continue;
  const packageJsonPath = path.join(repoRoot, entry.name, 'package.json');
  if (!exists(packageJsonPath)) continue;
  if (!frontendRootNamePattern.test(entry.name)) continue;
  addViolation(entry.name, 'unexpected additional frontend-like package root');
}

if (violations.length > 0) {
  console.error('[verify-single-frontend] FAILED');
  for (const violation of violations) {
    console.error(`- ${violation.relativePath}: ${violation.reason}`);
  }
  console.error('');
  console.error('Run cleanup: npm run frontend -- clean:frontend-artifacts');
  process.exit(1);
}

console.log('[verify-single-frontend] OK');
console.log('- primary frontend: frontend/');
console.log('- framework lock: Vite only');
