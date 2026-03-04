#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';

const ROOT = process.cwd();
const DIST_ASSETS_DIR = path.join(ROOT, 'dist', 'assets');
const ARTIFACT_DIR = path.join(ROOT, 'artifacts');
const ARTIFACT_PATH = path.join(ARTIFACT_DIR, 'bundle-budget.json');
const MAX_INDEX_BYTES = Math.max(64_000, Number(process.env.VF_FRONTEND_INDEX_BUNDLE_MAX_BYTES || 327_680));

const main = async () => {
  const report = {
    generatedAt: new Date().toISOString(),
    maxIndexBytes: MAX_INDEX_BYTES,
    passed: false,
    files: [],
    violations: [],
  };

  let entries = [];
  try {
    entries = await fs.readdir(DIST_ASSETS_DIR, { withFileTypes: true });
  } catch (error) {
    throw new Error(`Failed to read ${DIST_ASSETS_DIR}. Run build first. ${error instanceof Error ? error.message : String(error)}`);
  }

  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const name = entry.name;
    if (!/^index-.*\.js$/i.test(name)) continue;
    const fullPath = path.join(DIST_ASSETS_DIR, name);
    const stat = await fs.stat(fullPath);
    const bytes = Number(stat.size || 0);
    const item = {
      file: `assets/${name}`,
      bytes,
      withinBudget: bytes <= MAX_INDEX_BYTES,
    };
    report.files.push(item);
    if (!item.withinBudget) {
      report.violations.push({
        file: item.file,
        bytes: item.bytes,
        maxBytes: MAX_INDEX_BYTES,
      });
    }
  }

  if (report.files.length === 0) {
    report.violations.push({
      file: 'assets/index-*.js',
      error: 'No index bundle found. Build output missing expected entry chunk.',
    });
  }

  report.passed = report.violations.length === 0;
  await fs.mkdir(ARTIFACT_DIR, { recursive: true });
  await fs.writeFile(ARTIFACT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

  console.log(`[bundle:budget] artifact: ${path.relative(ROOT, ARTIFACT_PATH).replace(/\\/g, '/')}`);
  console.log(`[bundle:budget] passed=${report.passed}`);
  if (!report.passed) {
    process.exitCode = 1;
  }
};

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});