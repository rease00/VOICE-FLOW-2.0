#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';

const ROOT = process.cwd();
const NEXT_DIR = path.join(ROOT, '.next');
const STATIC_DIR = path.join(NEXT_DIR, 'static');
const BUILD_MANIFEST_PATH = path.join(NEXT_DIR, 'build-manifest.json');
const REACT_LOADABLE_MANIFEST_PATH = path.join(NEXT_DIR, 'react-loadable-manifest.json');
const ARTIFACT_DIR = path.join(ROOT, 'artifacts');
const ARTIFACT_PATH = path.join(ARTIFACT_DIR, 'bundle-budget.json');

const MAX_EAGER_JS_BYTES = Math.max(
  64_000,
  Number(process.env.VF_FRONTEND_EAGER_JS_MAX_BYTES || process.env.VF_FRONTEND_INDEX_BUNDLE_MAX_BYTES || 393_216),
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

const parseBoolean = (value) => {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return false;
  return ['1', 'true', 'yes', 'on'].includes(normalized);
};

const ENFORCE_LAZY_ML_CHUNK_BUDGET = parseBoolean(process.env.VF_FRONTEND_ENFORCE_LAZY_ML_CHUNK_BUDGET);

const toPosixPath = (value) => String(value || '').replace(/\\/g, '/');

const normalizeDistAssetPath = (value) => {
  const safe = String(value || '').trim();
  if (!safe || /^https?:\/\//i.test(safe) || safe.startsWith('data:')) return '';
  const withoutHash = safe.split('#', 1)[0] || '';
  const withoutQuery = withoutHash.split('?', 1)[0] || '';
  return withoutQuery.replace(/^\/+/, '');
};

const toStaticManifestPath = (value) => {
  const normalized = normalizeDistAssetPath(value);
  if (!normalized) return '';
  if (normalized.startsWith('static/')) return normalized;
  return `static/${normalized}`;
};

const parseJson = async (filePath) => {
  try {
    const source = await fs.readFile(filePath, 'utf8');
    return JSON.parse(source);
  } catch {
    return null;
  }
};

const pushManifestFile = (target, filePath) => {
  const normalized = toStaticManifestPath(filePath);
  if (normalized) target.add(normalized);
};

const collectEagerManifestAssets = (buildManifest) => {
  const eager = new Set();
  if (!buildManifest || typeof buildManifest !== 'object') return eager;

  const maybeArrays = [
    buildManifest.polyfillFiles,
    buildManifest.rootMainFiles,
    buildManifest.lowPriorityFiles,
    ...(Object.values(buildManifest.pages || {})),
  ];

  for (const entry of maybeArrays) {
    if (!Array.isArray(entry)) continue;
    for (const filePath of entry) {
      pushManifestFile(eager, filePath);
    }
  }

  return eager;
};

const collectLazyManifestAssets = (reactLoadableManifest) => {
  const lazy = new Set();
  if (!reactLoadableManifest || typeof reactLoadableManifest !== 'object') return lazy;

  for (const value of Object.values(reactLoadableManifest)) {
    const files = Array.isArray(value?.files) ? value.files : [];
    for (const filePath of files) {
      pushManifestFile(lazy, filePath);
    }
  }

  return lazy;
};

const extractReferencedWasmAssets = async (jsAssetPaths) => {
  const assets = new Set();
  for (const assetPath of jsAssetPaths) {
    if (path.extname(assetPath).toLowerCase() !== '.js') continue;
    const fullPath = path.join(STATIC_DIR, assetPath);
    try {
      const source = await fs.readFile(fullPath, 'utf8');
      const matches = source.match(/(?:assets|media)\/[^"'`]+?\.wasm\b/g) || [];
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

const isBrowserMlChunk = (assetPath) => /(?:phonemizer|huggingface|transformers|ml)/i.test(assetPath);
const isMainAppChunk = (assetPath) => /(?:^|\/)(?:app|main-app|layout)[^/]*\.js$/i.test(assetPath);

const listNextStaticAssets = async () => {
  const entries = await fs.readdir(STATIC_DIR, { recursive: true }).catch(() => []);
  return entries
    .map((entry) => toPosixPath(String(entry || '')))
    .filter((entry) => /\.(js|css|wasm)$/i.test(entry));
};

const listAllStaticFiles = async () => {
  const entries = await fs.readdir(STATIC_DIR, { recursive: true }).catch(() => []);
  const out = [];
  for (const entry of entries) {
    const relativePath = toPosixPath(String(entry || ''));
    if (!relativePath) continue;
    const fullPath = path.join(STATIC_DIR, relativePath);
    const stat = await fs.stat(fullPath).catch(() => null);
    if (!stat || !stat.isFile()) continue;
    out.push({
      path: relativePath,
      bytes: Number(stat.size || 0),
    });
  }
  return out;
};

const main = async () => {
  const report = {
    generatedAt: new Date().toISOString(),
    entryBuild: '.next/static',
    classification: {
      eagerSource: 'build-manifest + non-lazy fallback',
      lazySource: 'react-loadable-manifest + wasm refs from lazy chunks',
    },
    budgets: {
      eagerJsBytes: MAX_EAGER_JS_BYTES,
      eagerCssBytes: MAX_EAGER_CSS_BYTES,
      eagerWasmBytes: MAX_EAGER_WASM_BYTES,
      browserMlChunkBytes: MAX_BROWSER_ML_CHUNK_BYTES,
      enforceLazyMlChunkBudget: ENFORCE_LAZY_ML_CHUNK_BUDGET,
      mainAppChunkBytes: MAX_MAIN_APP_CHUNK_BYTES,
      distTotalBytes: MAX_DIST_TOTAL_BYTES,
      distShippedAudioBytes: MAX_DIST_SHIPPED_AUDIO_BYTES,
    },
    passed: false,
    files: [],
    violations: [],
    advisories: [],
  };

  try {
    await fs.access(NEXT_DIR);
  } catch (error) {
    throw new Error(`Failed to find ${NEXT_DIR}. Run build first. ${error instanceof Error ? error.message : String(error)}`);
  }

  const buildManifest = await parseJson(BUILD_MANIFEST_PATH);
  const reactLoadableManifest = await parseJson(REACT_LOADABLE_MANIFEST_PATH);

  const eagerManifestAssets = collectEagerManifestAssets(buildManifest);
  const lazyManifestAssets = collectLazyManifestAssets(reactLoadableManifest);

  const allStaticAssets = await listNextStaticAssets();
  const allStaticAssetSet = new Set(allStaticAssets);

  const lazyJsAssets = allStaticAssets.filter((assetPath) => lazyManifestAssets.has(toStaticManifestPath(assetPath)));
  const eagerJsAssets = allStaticAssets.filter((assetPath) => !lazyManifestAssets.has(toStaticManifestPath(assetPath)));

  const lazyWasmAssets = await extractReferencedWasmAssets(lazyJsAssets);
  const eagerWasmAssets = await extractReferencedWasmAssets(eagerJsAssets);

  for (const wasmAsset of [...lazyWasmAssets, ...eagerWasmAssets]) {
    allStaticAssetSet.add(wasmAsset);
  }

  if (allStaticAssetSet.size === 0) {
    report.violations.push({
      file: '.next/static',
      error: 'No frontend assets found. Build output is missing expected static bundles.',
    });
  }

  const budgetSummary = {
    eagerAssetCount: 0,
    eagerAssetBytes: 0,
    lazyAssetCount: 0,
    lazyAssetBytes: 0,
  };

  for (const assetPath of [...allStaticAssetSet].sort()) {
    const fullPath = path.join(STATIC_DIR, assetPath);
    let bytes = 0;
    try {
      const stat = await fs.stat(fullPath);
      bytes = Number(stat.size || 0);
    } catch (error) {
      report.violations.push({
        file: toPosixPath(assetPath),
        error: `Missing asset referenced by .next/static: ${error instanceof Error ? error.message : String(error)}`,
      });
      continue;
    }

    const manifestPath = toStaticManifestPath(assetPath);
    const inLazyManifest = lazyManifestAssets.has(manifestPath);
    const isLazyWasm = lazyWasmAssets.has(assetPath) && !eagerWasmAssets.has(assetPath);
    const bucket = (inLazyManifest || isLazyWasm) ? 'lazy' : 'eager';

    if (bucket === 'eager') {
      budgetSummary.eagerAssetCount += 1;
      budgetSummary.eagerAssetBytes += bytes;
    } else {
      budgetSummary.lazyAssetCount += 1;
      budgetSummary.lazyAssetBytes += bytes;
    }

    const maxBytes = bucket === 'eager' ? resolveBudgetBytes(assetPath) : null;
    const withinBudget = bucket === 'eager'
      ? (!Number.isFinite(maxBytes) || bytes <= maxBytes)
      : true;

    report.files.push({
      file: toPosixPath(assetPath),
      manifestPath,
      kind: resolveAssetKind(assetPath),
      bucket,
      bytes,
      maxBytes: bucket === 'eager' && Number.isFinite(maxBytes) ? maxBytes : null,
      withinBudget,
      inEagerManifest: eagerManifestAssets.has(manifestPath),
      inLazyManifest,
      lazyWasmRef: isLazyWasm,
    });

    if (!withinBudget) {
      report.violations.push({
        file: toPosixPath(assetPath),
        bucket,
        bytes,
        maxBytes,
      });
    }

    if (assetPath.endsWith('.js') && isMainAppChunk(assetPath) && bucket === 'eager' && bytes > MAX_MAIN_APP_CHUNK_BYTES) {
      report.violations.push({
        file: toPosixPath(assetPath),
        bucket,
        bytes,
        maxBytes: MAX_MAIN_APP_CHUNK_BYTES,
      });
    }

    if (assetPath.endsWith('.js') && isBrowserMlChunk(assetPath) && bucket === 'lazy' && bytes > MAX_BROWSER_ML_CHUNK_BYTES) {
      const entry = {
        file: toPosixPath(assetPath),
        bucket,
        bytes,
        maxBytes: MAX_BROWSER_ML_CHUNK_BYTES,
      };
      if (ENFORCE_LAZY_ML_CHUNK_BUDGET) {
        report.violations.push(entry);
      } else {
        report.advisories.push(entry);
      }
    }
  }

  const staticFiles = await listAllStaticFiles();
  const distTotalBytes = staticFiles.reduce((sum, item) => sum + item.bytes, 0);
  const distShippedAudioBytes = staticFiles.reduce((sum, item) => {
    if (item.path.startsWith('media/') && /\.(mp3|wav|ogg|m4a|aac)$/i.test(item.path)) {
      return sum + item.bytes;
    }
    return sum;
  }, 0);

  if (distTotalBytes > MAX_DIST_TOTAL_BYTES) {
    report.violations.push({
      file: '.next/static',
      bytes: distTotalBytes,
      maxBytes: MAX_DIST_TOTAL_BYTES,
    });
  }

  if (distShippedAudioBytes > MAX_DIST_SHIPPED_AUDIO_BYTES) {
    report.violations.push({
      file: '.next/static/media',
      bytes: distShippedAudioBytes,
      maxBytes: MAX_DIST_SHIPPED_AUDIO_BYTES,
    });
  }

  report.files.sort((left, right) => Number(right.bytes || 0) - Number(left.bytes || 0));
  report.summary = {
    distTotalBytes,
    distShippedAudioBytes,
    staticFileCount: staticFiles.length,
    manifestCoverage: {
      eagerManifestAssetCount: eagerManifestAssets.size,
      lazyManifestAssetCount: lazyManifestAssets.size,
      lazyWasmRefCount: lazyWasmAssets.size,
    },
    ...budgetSummary,
  };
  report.passed = report.violations.length === 0;

  await fs.mkdir(ARTIFACT_DIR, { recursive: true });
  await fs.writeFile(ARTIFACT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

  console.log(`[bundle:budget] artifact: ${path.relative(ROOT, ARTIFACT_PATH).replace(/\\/g, '/')}`);
  console.log(`[bundle:budget] eager assets: ${budgetSummary.eagerAssetCount}`);
  console.log(`[bundle:budget] lazy assets: ${budgetSummary.lazyAssetCount}`);
  console.log(`[bundle:budget] passed=${report.passed}`);
  if (!report.passed) {
    process.exitCode = 1;
  }
};

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
