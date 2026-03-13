#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';

const ROOT = process.cwd();
const DIST_DIR = path.join(ROOT, 'dist');
const INDEX_HTML_PATH = path.join(DIST_DIR, 'index.html');
const ARTIFACT_DIR = path.join(ROOT, 'artifacts');
const ARTIFACT_PATH = path.join(ARTIFACT_DIR, 'bundle-budget.json');

const MAX_EAGER_JS_BYTES = Math.max(
  64_000,
  Number(process.env.VF_FRONTEND_EAGER_JS_MAX_BYTES || process.env.VF_FRONTEND_INDEX_BUNDLE_MAX_BYTES || 327_680),
);
const MAX_EAGER_CSS_BYTES = Math.max(
  16_000,
  Number(process.env.VF_FRONTEND_EAGER_CSS_MAX_BYTES || 196_608),
);
const MAX_EAGER_WASM_BYTES = Math.max(
  64_000,
  Number(process.env.VF_FRONTEND_EAGER_WASM_MAX_BYTES || 5_242_880),
);
const MAX_BROWSER_ML_CHUNK_BYTES = Math.max(
  128_000,
  Number(process.env.VF_FRONTEND_BROWSER_ML_CHUNK_MAX_BYTES || 921_600),
);
const MAIN_APP_CHUNK_SLACK_BYTES = Math.max(
  0,
  Number(process.env.VF_FRONTEND_MAIN_APP_CHUNK_SLACK_BYTES || 1_024),
);
const MAX_MAIN_APP_CHUNK_BYTES = Math.max(
  128_000,
  Number(process.env.VF_FRONTEND_MAIN_APP_CHUNK_MAX_BYTES || 230_400) + MAIN_APP_CHUNK_SLACK_BYTES,
);
const MAX_DIST_TOTAL_BYTES = Math.max(
  1_000_000,
  Number(process.env.VF_FRONTEND_DIST_TOTAL_MAX_BYTES || 62_914_560),
);
const MAX_DIST_SHIPPED_AUDIO_BYTES = Math.max(
  1_000_000,
  Number(process.env.VF_FRONTEND_DIST_AUDIO_MAX_BYTES || 10_485_760),
);

const toPosixPath = (value) => String(value || '').replace(/\\/g, '/');

const normalizeDistAssetPath = (value) => {
  const safe = String(value || '').trim();
  if (!safe || /^https?:\/\//i.test(safe) || safe.startsWith('data:')) return '';
  const withoutHash = safe.split('#', 1)[0] || '';
  const withoutQuery = withoutHash.split('?', 1)[0] || '';
  return withoutQuery.replace(/^\/+/, '');
};

const collectMatches = (html, pattern, out) => {
  let match = pattern.exec(html);
  while (match) {
    const normalized = normalizeDistAssetPath(match[1]);
    if (normalized) out.add(normalized);
    match = pattern.exec(html);
  }
};

const extractEagerAssetsFromHtml = (html) => {
  const assets = new Set();
  collectMatches(html, /<script\b[^>]*type=["']module["'][^>]*src=["']([^"']+)["']/gi, assets);
  collectMatches(html, /<link\b[^>]*rel=["']modulepreload["'][^>]*href=["']([^"']+)["']/gi, assets);
  collectMatches(html, /<link\b[^>]*rel=["']stylesheet["'][^>]*href=["']([^"']+)["']/gi, assets);
  return assets;
};

const extractReferencedWasmAssets = async (jsAssetPaths) => {
  const assets = new Set();
  for (const assetPath of jsAssetPaths) {
    if (path.extname(assetPath).toLowerCase() !== '.js') continue;
    const fullPath = path.join(DIST_DIR, assetPath);
    try {
      const source = await fs.readFile(fullPath, 'utf8');
      const matches = source.match(/assets\/[^"'`]+?\.wasm\b/g) || [];
      matches.forEach((match) => {
        const normalized = normalizeDistAssetPath(match);
        if (normalized) assets.add(normalized);
      });
    } catch {
      // Missing JS assets are reported in the main pass.
    }
  }
  return assets;
};

const resolveBudgetBytes = (assetPath) => {
  const extension = path.extname(assetPath).toLowerCase();
  if (extension === '.js') return MAX_EAGER_JS_BYTES;
  if (extension === '.css') return MAX_EAGER_CSS_BYTES;
  if (extension === '.wasm') return MAX_EAGER_WASM_BYTES;
  return Number.POSITIVE_INFINITY;
};

const resolveAssetKind = (assetPath) => {
  const extension = path.extname(assetPath).toLowerCase();
  if (extension === '.js') return 'js';
  if (extension === '.css') return 'css';
  if (extension === '.wasm') return 'wasm';
  return extension.replace(/^\./, '') || 'other';
};

const main = async () => {
  const report = {
    generatedAt: new Date().toISOString(),
    entryHtml: 'dist/index.html',
    budgets: {
      eagerJsBytes: MAX_EAGER_JS_BYTES,
      eagerCssBytes: MAX_EAGER_CSS_BYTES,
      eagerWasmBytes: MAX_EAGER_WASM_BYTES,
      browserMlChunkBytes: MAX_BROWSER_ML_CHUNK_BYTES,
      mainAppChunkBytes: MAX_MAIN_APP_CHUNK_BYTES,
      distTotalBytes: MAX_DIST_TOTAL_BYTES,
      distShippedAudioBytes: MAX_DIST_SHIPPED_AUDIO_BYTES,
    },
    passed: false,
    files: [],
    violations: [],
  };

  let html = '';
  try {
    html = await fs.readFile(INDEX_HTML_PATH, 'utf8');
  } catch (error) {
    throw new Error(`Failed to read ${INDEX_HTML_PATH}. Run build first. ${error instanceof Error ? error.message : String(error)}`);
  }

  const eagerAssets = extractEagerAssetsFromHtml(html);
  const eagerWasmAssets = await extractReferencedWasmAssets([...eagerAssets]);
  eagerWasmAssets.forEach((assetPath) => eagerAssets.add(assetPath));

  if (eagerAssets.size === 0) {
    report.violations.push({
      file: 'dist/index.html',
      error: 'No eager frontend assets found. Build output is missing expected module/script references.',
    });
  }

  for (const assetPath of [...eagerAssets].sort()) {
    const fullPath = path.join(DIST_DIR, assetPath);
    let bytes = 0;
    try {
      const stat = await fs.stat(fullPath);
      bytes = Number(stat.size || 0);
    } catch (error) {
      report.violations.push({
        file: toPosixPath(assetPath),
        error: `Missing eager asset referenced by dist/index.html: ${error instanceof Error ? error.message : String(error)}`,
      });
      continue;
    }

    const maxBytes = resolveBudgetBytes(assetPath);
    const withinBudget = !Number.isFinite(maxBytes) || bytes <= maxBytes;
    report.files.push({
      file: toPosixPath(assetPath),
      kind: resolveAssetKind(assetPath),
      bytes,
      maxBytes: Number.isFinite(maxBytes) ? maxBytes : null,
      withinBudget,
    });

    if (!withinBudget) {
      report.violations.push({
        file: toPosixPath(assetPath),
        bytes,
        maxBytes,
      });
    }
  }

  const distFiles = await fs.readdir(DIST_DIR, { recursive: true }).catch(() => []);
  let distTotalBytes = 0;
  let distShippedAudioBytes = 0;
  for (const relativePath of distFiles) {
    const normalized = toPosixPath(String(relativePath || ''));
    const fullPath = path.join(DIST_DIR, normalized);
    const stat = await fs.stat(fullPath).catch(() => null);
    if (!stat || !stat.isFile()) continue;
    distTotalBytes += Number(stat.size || 0);
    if (normalized.startsWith('assets/audio/')) {
      distShippedAudioBytes += Number(stat.size || 0);
    }
  }

  const allAssetEntries = await fs.readdir(path.join(DIST_DIR, 'assets')).catch(() => []);
  const candidateChunkNames = [
    'vendor-kokoro',
    'vendor-hf',
    'vendor-phonemizer',
    'vendor-ml-utils',
    'vendor-ml',
  ];
  for (const entry of allAssetEntries) {
    const normalized = toPosixPath(entry);
    const fullPath = path.join(DIST_DIR, 'assets', entry);
    const stat = await fs.stat(fullPath).catch(() => null);
    if (!stat || !stat.isFile()) continue;
    const matchesMlBudget = candidateChunkNames.some((prefix) => normalized.startsWith(`${prefix}-`) && normalized.endsWith('.js'));
    if (matchesMlBudget && Number(stat.size || 0) > MAX_BROWSER_ML_CHUNK_BYTES) {
      report.violations.push({
        file: `assets/${normalized}`,
        bytes: Number(stat.size || 0),
        maxBytes: MAX_BROWSER_ML_CHUNK_BYTES,
      });
    }
    if (normalized.startsWith('MainApp-') && normalized.endsWith('.js') && Number(stat.size || 0) > MAX_MAIN_APP_CHUNK_BYTES) {
      report.violations.push({
        file: `assets/${normalized}`,
        bytes: Number(stat.size || 0),
        maxBytes: MAX_MAIN_APP_CHUNK_BYTES,
      });
    }
  }

  if (distTotalBytes > MAX_DIST_TOTAL_BYTES) {
    report.violations.push({
      file: 'dist',
      bytes: distTotalBytes,
      maxBytes: MAX_DIST_TOTAL_BYTES,
    });
  }

  if (distShippedAudioBytes > MAX_DIST_SHIPPED_AUDIO_BYTES) {
    report.violations.push({
      file: 'dist/assets/audio',
      bytes: distShippedAudioBytes,
      maxBytes: MAX_DIST_SHIPPED_AUDIO_BYTES,
    });
  }

  report.files.sort((left, right) => Number(right.bytes || 0) - Number(left.bytes || 0));
  report.summary = {
    distTotalBytes,
    distShippedAudioBytes,
  };
  report.passed = report.violations.length === 0;

  await fs.mkdir(ARTIFACT_DIR, { recursive: true });
  await fs.writeFile(ARTIFACT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

  console.log(`[bundle:budget] artifact: ${path.relative(ROOT, ARTIFACT_PATH).replace(/\\/g, '/')}`);
  console.log(`[bundle:budget] eager assets: ${report.files.length}`);
  console.log(`[bundle:budget] passed=${report.passed}`);
  if (!report.passed) {
    process.exitCode = 1;
  }
};

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
