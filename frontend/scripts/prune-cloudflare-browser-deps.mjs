#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const frontendDir = path.resolve(scriptDir, '..');
const standaloneDir = path.join(frontendDir, '.next', 'standalone');

const browserOnlyPackages = [
  'kokoro-js',
  '@huggingface/transformers',
  '@huggingface/jinja',
  'onnxruntime-web',
  'onnxruntime-node',
  'onnxruntime-common',
];

const removePath = (targetPath, removed) => {
  if (!fs.existsSync(targetPath)) return;
  fs.rmSync(targetPath, {
    recursive: true,
    force: true,
    maxRetries: 2,
  });
  removed.push(path.relative(frontendDir, targetPath).split(path.sep).join('/'));
};

const main = () => {
  if (!fs.existsSync(standaloneDir)) {
    console.log('[prune:cloudflare] .next/standalone is missing; nothing to prune.');
    return;
  }

  const removed = [];
  const standalonePackageJsonPath = path.join(standaloneDir, 'package.json');
  if (fs.existsSync(standalonePackageJsonPath)) {
    const packageJson = JSON.parse(fs.readFileSync(standalonePackageJsonPath, 'utf8'));
    let changed = false;

    for (const section of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) {
      const container = packageJson[section];
      if (!container || typeof container !== 'object') continue;
      for (const packageName of browserOnlyPackages) {
        if (packageName in container) {
          delete container[packageName];
          changed = true;
        }
      }
    }

    if (changed) {
      fs.writeFileSync(standalonePackageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`);
      removed.push('frontend/.next/standalone/package.json entries: kokoro-js, @huggingface/transformers, @huggingface/jinja, onnxruntime-web, onnxruntime-node, onnxruntime-common');
    }
  }

  const nodeModulesDir = path.join(standaloneDir, 'node_modules');
  const packageTargets = [
    path.join(nodeModulesDir, 'kokoro-js'),
    path.join(nodeModulesDir, '@huggingface', 'transformers'),
    path.join(nodeModulesDir, '@huggingface', 'jinja'),
    path.join(nodeModulesDir, 'onnxruntime-web'),
    path.join(nodeModulesDir, 'onnxruntime-node'),
    path.join(nodeModulesDir, 'onnxruntime-common'),
  ];

  for (const targetPath of packageTargets) {
    removePath(targetPath, removed);
  }

  const traceFiles = [];
  const nextDir = path.join(frontendDir, '.next');
  const walk = (directory) => {
    if (!fs.existsSync(directory)) return;
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        walk(entryPath);
        continue;
      }
      if (entry.name.endsWith('.nft.json')) {
        traceFiles.push(entryPath);
      }
    }
  };
  walk(nextDir);

  for (const traceFilePath of traceFiles) {
    const traceJson = JSON.parse(fs.readFileSync(traceFilePath, 'utf8'));
    if (!Array.isArray(traceJson.files)) continue;
    const beforeCount = traceJson.files.length;
    traceJson.files = traceJson.files.filter((filePath) => (
      !browserOnlyPackages.some((packageName) => filePath.includes(`node_modules/${packageName}/`) || filePath.includes(`node_modules\\${packageName}\\`))
    ));
    if (traceJson.files.length !== beforeCount) {
      fs.writeFileSync(traceFilePath, `${JSON.stringify(traceJson)}\n`);
      removed.push(path.relative(frontendDir, traceFilePath).split(path.sep).join('/'));
    }
  }

  if (removed.length === 0) {
    console.log('[prune:cloudflare] No browser-only AI packages were found in the standalone bundle.');
    return;
  }

  console.log('[prune:cloudflare] Removed browser-only AI packages from the standalone bundle:');
  for (const item of removed) {
    console.log(`- ${item}`);
  }
};

try {
  main();
} catch (error) {
  const detail = error instanceof Error ? error.message : String(error);
  console.error('[prune:cloudflare] Failed to prune browser-only Cloudflare deps.');
  console.error(`[prune:cloudflare] ${detail}`);
  process.exit(1);
}
