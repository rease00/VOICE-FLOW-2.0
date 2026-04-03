#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';

const ROOT = process.cwd();
const DIST_DIR_NAME = String(process.env.NEXT_DIST_DIR || process.env.VF_NEXT_DIST_DIR || '.next').trim() || '.next';
const NEXT_DIR = path.join(ROOT, DIST_DIR_NAME);
const STATIC_DIR = path.join(NEXT_DIR, 'static');
const BUILD_MANIFEST_PATH = path.join(NEXT_DIR, 'build-manifest.json');
const REACT_LOADABLE_MANIFEST_PATH = path.join(NEXT_DIR, 'react-loadable-manifest.json');
const ARTIFACT_DIR = path.join(ROOT, 'artifacts');
const ARTIFACT_PATH = path.join(ARTIFACT_DIR, 'bundle-report.json');

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
      const normalized = toStaticManifestPath(filePath);
      if (normalized) eager.add(normalized);
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
      const normalized = toStaticManifestPath(filePath);
      if (normalized) lazy.add(normalized);
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
      // Missing referenced files are surfaced in the main listing pass.
    }
  }
  return assets;
};

const listAssetEntries = async (lazyManifestAssets, eagerManifestAssets) => {
  const entries = await fs.readdir(STATIC_DIR, { recursive: true }).catch(() => []);
  const rawFiles = [];
  for (const entry of entries) {
    const name = String(entry || '').replace(/\\/g, '/');
    if (!/\.(js|css|wasm)$/i.test(name)) continue;
    const fullPath = path.join(STATIC_DIR, name);
    const stat = await fs.stat(fullPath);
    rawFiles.push({
      name,
      bytes: Number(stat.size || 0),
    });
  }

  const lazyJsAssets = rawFiles
    .map((file) => file.name)
    .filter((assetPath) => path.extname(assetPath).toLowerCase() === '.js')
    .filter((assetPath) => lazyManifestAssets.has(toStaticManifestPath(assetPath)));
  const eagerJsAssets = rawFiles
    .map((file) => file.name)
    .filter((assetPath) => path.extname(assetPath).toLowerCase() === '.js')
    .filter((assetPath) => !lazyManifestAssets.has(toStaticManifestPath(assetPath)));

  const lazyWasmAssets = await extractReferencedWasmAssets(lazyJsAssets);
  const eagerWasmAssets = await extractReferencedWasmAssets(eagerJsAssets);

  const files = rawFiles.map((file) => {
    const manifestPath = toStaticManifestPath(file.name);
    const isWasm = file.name.toLowerCase().endsWith('.wasm');
    const isLazyWasm = isWasm && lazyWasmAssets.has(file.name) && !eagerWasmAssets.has(file.name);
    const bucket = (lazyManifestAssets.has(manifestPath) || isLazyWasm) ? 'lazy' : 'eager';
    return {
      file: `static/${file.name}`.replace(/\\/g, '/'),
      manifestPath,
      bytes: file.bytes,
      type: file.name.toLowerCase().endsWith('.css') ? 'css' : isWasm ? 'wasm' : 'js',
      bucket,
      inEagerManifest: eagerManifestAssets.has(manifestPath),
      inLazyManifest: lazyManifestAssets.has(manifestPath),
      lazyWasmRef: isLazyWasm,
    };
  });

  files.sort((a, b) => b.bytes - a.bytes);
  return files;
};

const main = async () => {
  const report = {
    generatedAt: new Date().toISOString(),
    nextDir: NEXT_DIR,
    files: [],
    summary: {
      totalBytes: 0,
      jsBytes: 0,
      cssBytes: 0,
      wasmBytes: 0,
      fileCount: 0,
      eagerBytes: 0,
      eagerFileCount: 0,
      lazyBytes: 0,
      lazyFileCount: 0,
      eagerManifestAssetCount: 0,
      lazyManifestAssetCount: 0,
    },
  };

  const buildManifest = await parseJson(BUILD_MANIFEST_PATH);
  const reactLoadableManifest = await parseJson(REACT_LOADABLE_MANIFEST_PATH);
  const eagerManifestAssets = collectEagerManifestAssets(buildManifest);
  const lazyManifestAssets = collectLazyManifestAssets(reactLoadableManifest);
  report.summary.eagerManifestAssetCount = eagerManifestAssets.size;
  report.summary.lazyManifestAssetCount = lazyManifestAssets.size;

  try {
    report.files = await listAssetEntries(lazyManifestAssets, eagerManifestAssets);
  } catch (error) {
    throw new Error(`Failed to read frontend dist assets. Run build first. ${error instanceof Error ? error.message : String(error)}`);
  }

  for (const file of report.files) {
    report.summary.totalBytes += file.bytes;
    report.summary.fileCount += 1;
    if (file.type === 'js') report.summary.jsBytes += file.bytes;
    if (file.type === 'css') report.summary.cssBytes += file.bytes;
    if (file.type === 'wasm') report.summary.wasmBytes += file.bytes;
    if (file.bucket === 'eager') {
      report.summary.eagerBytes += file.bytes;
      report.summary.eagerFileCount += 1;
    } else {
      report.summary.lazyBytes += file.bytes;
      report.summary.lazyFileCount += 1;
    }
  }

  await fs.mkdir(ARTIFACT_DIR, { recursive: true });
  await fs.writeFile(ARTIFACT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

  console.log(`[bundle:report] artifact: ${path.relative(ROOT, ARTIFACT_PATH).replace(/\\/g, '/')}`);
  if (report.files.length > 0) {
    const top = report.files[0];
    console.log(`[bundle:report] largest asset: ${top.file} (${top.bytes} bytes)`);
  } else {
    console.log('[bundle:report] no js/css/wasm assets found in .next/static');
  }
};

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
