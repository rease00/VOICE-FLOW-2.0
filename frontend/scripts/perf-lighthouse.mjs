#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs/promises';

const ROOT = process.cwd();
const ARTIFACT_DIR = path.join(ROOT, 'artifacts');
const ARTIFACT_PATH = path.join(ARTIFACT_DIR, 'lighthouse-summary.json');

const truthy = (value) => {
  const token = String(value || '').trim().toLowerCase();
  return token === '1' || token === 'true' || token === 'yes' || token === 'on';
};

const main = async () => {
  const targetUrl = String(process.env.VF_LIGHTHOUSE_URL || process.argv[2] || 'http://127.0.0.1:3000').trim();
  const enforceInCi = truthy(process.env.CI) && !String(process.env.VF_ENABLE_LIGHTHOUSE || '').trim();
  const enforce = truthy(process.env.VF_ENABLE_LIGHTHOUSE) || enforceInCi;

  const report = {
    generatedAt: new Date().toISOString(),
    targetUrl,
    enforce,
    ran: false,
    passed: true,
    note: '',
  };

  if (!enforce) {
    report.note = 'Skipped. Set VF_ENABLE_LIGHTHOUSE=1 to run Lighthouse locally. CI runs by default.';
    await fs.mkdir(ARTIFACT_DIR, { recursive: true });
    await fs.writeFile(ARTIFACT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    console.log(`[perf:lighthouse] ${report.note}`);
    console.log(`[perf:lighthouse] artifact: ${path.relative(ROOT, ARTIFACT_PATH).replace(/\\/g, '/')}`);
    return;
  }

  const outputPath = path.join(ARTIFACT_DIR, 'lighthouse-report.json');
  const cmd = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  const args = [
    '--yes',
    'lighthouse',
    targetUrl,
    '--chrome-flags=--headless',
    '--output=json',
    `--output-path=${outputPath}`,
  ];
  const result = spawnSync(cmd, args, {
    cwd: ROOT,
    stdio: 'inherit',
    env: process.env,
  });

  report.ran = true;
  report.passed = result.status === 0;
  report.note = report.passed ? 'Lighthouse completed.' : `Lighthouse failed with status ${result.status}.`;

  await fs.mkdir(ARTIFACT_DIR, { recursive: true });
  await fs.writeFile(ARTIFACT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(`[perf:lighthouse] artifact: ${path.relative(ROOT, ARTIFACT_PATH).replace(/\\/g, '/')}`);

  if (!report.passed) {
    process.exitCode = result.status || 1;
  }
};

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
