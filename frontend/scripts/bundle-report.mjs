#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';

const ROOT = process.cwd();
const DIST_DIR = path.join(ROOT, 'dist');
const ASSETS_DIR = path.join(DIST_DIR, 'assets');
const ARTIFACT_DIR = path.join(ROOT, 'artifacts');
const ARTIFACT_PATH = path.join(ARTIFACT_DIR, 'bundle-report.json');

const listAssetEntries = async () => {
  const entries = await fs.readdir(ASSETS_DIR, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const name = entry.name;
    if (!/\.(js|css)$/i.test(name)) continue;
    const fullPath = path.join(ASSETS_DIR, name);
    const stat = await fs.stat(fullPath);
    files.push({
      file: `assets/${name}`,
      bytes: Number(stat.size || 0),
      type: name.toLowerCase().endsWith('.css') ? 'css' : 'js',
    });
  }
  files.sort((a, b) => b.bytes - a.bytes);
  return files;
};

const main = async () => {
  const report = {
    generatedAt: new Date().toISOString(),
    distDir: DIST_DIR,
    files: [],
    summary: {
      totalBytes: 0,
      jsBytes: 0,
      cssBytes: 0,
      fileCount: 0,
    },
  };

  try {
    report.files = await listAssetEntries();
  } catch (error) {
    throw new Error(`Failed to read frontend dist assets. Run build first. ${error instanceof Error ? error.message : String(error)}`);
  }

  for (const file of report.files) {
    report.summary.totalBytes += file.bytes;
    report.summary.fileCount += 1;
    if (file.type === 'js') report.summary.jsBytes += file.bytes;
    if (file.type === 'css') report.summary.cssBytes += file.bytes;
  }

  await fs.mkdir(ARTIFACT_DIR, { recursive: true });
  await fs.writeFile(ARTIFACT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

  console.log(`[bundle:report] artifact: ${path.relative(ROOT, ARTIFACT_PATH).replace(/\\/g, '/')}`);
  if (report.files.length > 0) {
    const top = report.files[0];
    console.log(`[bundle:report] largest asset: ${top.file} (${top.bytes} bytes)`);
  } else {
    console.log('[bundle:report] no js/css assets found in dist/assets');
  }
};

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});