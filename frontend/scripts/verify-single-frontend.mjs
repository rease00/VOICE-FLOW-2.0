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
const hasChildren = (absolutePath) => exists(absolutePath) && fs.readdirSync(absolutePath).length > 0;

const violations = [];

const addViolation = (relativePath, reason) => {
  violations.push({ relativePath, reason });
};

const requiredFrontendPackage = path.join(frontendDir, 'package.json');
if (!exists(requiredFrontendPackage)) {
  addViolation('frontend/package.json', 'missing primary frontend package');
}

const forbiddenStaticTargets = [
  { absolutePath: path.join(frontendDir, 'index.html'), reason: 'Vite HTML entrypoint must not remain in the Next frontend' },
  { absolutePath: path.join(frontendDir, 'index.tsx'), reason: 'Vite root entrypoint must not remain in the Next frontend' },
  { absolutePath: path.join(frontendDir, 'App.tsx'), reason: 'Vite app shell entrypoint must not remain in the Next frontend' },
  { absolutePath: path.join(frontendDir, 'vite.config.ts'), reason: 'Vite config must not remain in the Next frontend' },
  { absolutePath: path.join(frontendDir, 'src', 'main.tsx'), reason: 'Vite bootstrap entrypoint must not remain in the Next frontend' },
  { absolutePath: path.join(frontendDir, 'src', 'pages'), reason: 'page re-export shims must be removed', requireContents: true },
  { absolutePath: path.join(frontendDir, 'app', '(workspace)'), reason: 'legacy workspace route tree must be removed', requireContents: true },
];

for (const target of forbiddenStaticTargets) {
  if (target.requireContents ? hasChildren(target.absolutePath) : exists(target.absolutePath)) {
    addViolation(relativeToRoot(target.absolutePath), target.reason);
  }
}

const requiredNextTargets = [
  { absolutePath: path.join(frontendDir, 'app'), reason: 'missing Next.js app directory' },
  { absolutePath: path.join(frontendDir, 'app', 'layout.tsx'), reason: 'missing Next.js root layout' },
  { absolutePath: path.join(frontendDir, 'app', 'globals.css'), reason: 'missing Next.js global stylesheet' },
  { absolutePath: path.join(frontendDir, 'app', 'api', 'backend', 'route.ts'), reason: 'missing backend proxy route' },
  { absolutePath: path.join(frontendDir, 'next-env.d.ts'), reason: 'missing Next.js environment declarations' },
  { absolutePath: path.join(frontendDir, 'next.config.mjs'), reason: 'missing Next.js config' },
];

for (const target of requiredNextTargets) {
  if (!exists(target.absolutePath)) {
    addViolation(relativeToRoot(target.absolutePath), target.reason);
  }
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
console.log('- framework lock: Next.js App Router');
