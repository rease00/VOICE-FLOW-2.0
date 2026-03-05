#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Readable, Transform } from 'node:stream';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(__filename), '..');
const DEFAULT_SOURCE_MANIFEST = path.join(ROOT, 'config', 'llvc_model_sources.json');
const DEFAULT_OUTPUT_MANIFEST = path.join(ROOT, 'data', 'llvc-model-download-manifest.json');
const DEFAULT_MODELS_ROOT = path.resolve(
  ROOT,
  String(process.env.VF_LLVC_MODELS_DIR || 'models/llvc').trim() || 'models/llvc'
);

function parseArgs(argv) {
  const args = {
    force: false,
    sourceManifest: process.env.VF_LLVC_MODEL_SOURCE_MANIFEST || DEFAULT_SOURCE_MANIFEST,
    outputManifest: process.env.VF_LLVC_MODEL_DOWNLOAD_MANIFEST || DEFAULT_OUTPUT_MANIFEST,
    modelsRoot: process.env.VF_LLVC_MODELS_DIR || DEFAULT_MODELS_ROOT,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = String(argv[i] || '').trim();
    if (!token) continue;
    if (token === '--force') {
      args.force = true;
      continue;
    }
    if (token === '--manifest') {
      args.sourceManifest = String(argv[i + 1] || '').trim() || args.sourceManifest;
      i += 1;
      continue;
    }
    if (token === '--out') {
      args.outputManifest = String(argv[i + 1] || '').trim() || args.outputManifest;
      i += 1;
      continue;
    }
    if (token === '--models-dir') {
      args.modelsRoot = String(argv[i + 1] || '').trim() || args.modelsRoot;
      i += 1;
      continue;
    }
  }

  return {
    force: Boolean(args.force),
    sourceManifest: path.resolve(ROOT, args.sourceManifest),
    outputManifest: path.resolve(ROOT, args.outputManifest),
    modelsRoot: path.resolve(ROOT, args.modelsRoot),
  };
}

function readJson(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '');
  return JSON.parse(raw);
}

function ensureArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeRelative(relPath) {
  const token = String(relPath || '').trim().replace(/\\/g, '/').replace(/^\/+/, '');
  if (!token) return '';
  const cleaned = token.split('/').filter((part) => part && part !== '.').join('/');
  if (!cleaned || cleaned.startsWith('..')) {
    throw new Error(`Invalid relative path: ${relPath}`);
  }
  return cleaned;
}

function hashFile(filePath) {
  const hasher = crypto.createHash('sha256');
  return new Promise((resolve, reject) => {
    const stream = fs.createReadStream(filePath);
    stream.on('error', reject);
    stream.on('data', (chunk) => hasher.update(chunk));
    stream.on('end', () => resolve(hasher.digest('hex')));
  });
}

async function ensureParent(targetPath) {
  await fsp.mkdir(path.dirname(targetPath), { recursive: true });
}

async function copyAliases(fromPath, aliases, modelsRoot) {
  const list = ensureArray(aliases).map((entry) => normalizeRelative(entry));
  for (const relPath of list) {
    const target = path.join(modelsRoot, relPath);
    await ensureParent(target);
    await fsp.copyFile(fromPath, target);
  }
  return list;
}

async function downloadToFile(url, outFile) {
  const response = await fetch(url);
  if (!response.ok) {
    const err = new Error(`HTTP ${response.status}`);
    err.status = response.status;
    err.statusText = response.statusText;
    throw err;
  }
  if (!response.body) {
    throw new Error(`No response body for ${url}`);
  }

  const tmpFile = `${outFile}.tmp-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  const hasher = crypto.createHash('sha256');
  const hashTap = new Transform({
    transform(chunk, _enc, callback) {
      hasher.update(chunk);
      callback(null, chunk);
    },
  });

  await ensureParent(outFile);
  try {
    await pipeline(
      Readable.fromWeb(response.body),
      hashTap,
      fs.createWriteStream(tmpFile)
    );
    const digest = hasher.digest('hex');
    await fsp.rename(tmpFile, outFile);
    return digest;
  } catch (error) {
    await fsp.rm(tmpFile, { force: true }).catch(() => undefined);
    throw error;
  }
}

async function processEntry(entry, options) {
  const id = String(entry?.id || '').trim();
  const url = String(entry?.url || '').trim();
  const outputPath = normalizeRelative(entry?.outputPath || '');
  const required = entry?.required !== false;
  const allow404 = Boolean(entry?.allow404);
  const expectedSha = String(entry?.sha256 || '').trim().toLowerCase();

  if (!id || !url || !outputPath) {
    throw new Error(`Invalid entry (id/url/outputPath required): ${JSON.stringify(entry)}`);
  }

  const absoluteOut = path.join(options.modelsRoot, outputPath);
  const nowIso = new Date().toISOString();

  const row = {
    id,
    required,
    url,
    outputPath,
    sha256Expected: expectedSha || null,
    status: 'pending',
    bytes: 0,
    sha256Actual: null,
    copiedAliases: [],
    updatedAt: nowIso,
  };

  const exists = fs.existsSync(absoluteOut);
  if (exists && !options.force) {
    const existingHash = await hashFile(absoluteOut);
    row.sha256Actual = existingHash;
    row.bytes = fs.statSync(absoluteOut).size;
    if (!expectedSha || expectedSha === existingHash) {
      row.status = 'exists';
      row.copiedAliases = await copyAliases(absoluteOut, entry?.copyTo, options.modelsRoot);
      return row;
    }
  }

  try {
    const digest = await downloadToFile(url, absoluteOut);
    row.sha256Actual = digest;
    row.bytes = fs.statSync(absoluteOut).size;
    if (expectedSha && digest !== expectedSha) {
      row.status = 'hash_mismatch';
      throw new Error(`SHA mismatch for ${id}: expected ${expectedSha}, got ${digest}`);
    }
    row.status = 'downloaded';
    row.copiedAliases = await copyAliases(absoluteOut, entry?.copyTo, options.modelsRoot);
    return row;
  } catch (error) {
    const statusCode = Number(error?.status || 0);
    if (statusCode === 404 && allow404 && !required) {
      row.status = 'skipped_missing_optional';
      row.error = 'http_404';
      return row;
    }
    row.status = 'failed';
    row.error = error instanceof Error ? error.message : String(error);
    throw Object.assign(new Error(row.error), { row });
  }
}

async function writeManifest(pathOut, payload) {
  await fsp.mkdir(path.dirname(pathOut), { recursive: true });
  await fsp.writeFile(pathOut, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const source = readJson(options.sourceManifest);
  const entries = ensureArray(source.models);
  if (entries.length === 0) {
    throw new Error('No models[] in source manifest.');
  }

  const rows = [];
  let failed = false;

  for (const entry of entries) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const row = await processEntry(entry, options);
      rows.push(row);
      console.log(`[${row.status}] ${row.id} -> ${row.outputPath}`);
    } catch (error) {
      failed = true;
      const row = error?.row || {
        id: String(entry?.id || ''),
        outputPath: String(entry?.outputPath || ''),
        status: 'failed',
        error: error instanceof Error ? error.message : String(error),
      };
      rows.push(row);
      console.error(`[failed] ${row.id} -> ${row.outputPath} :: ${row.error}`);
    }
  }

  const summary = {
    total: rows.length,
    downloaded: rows.filter((row) => row.status === 'downloaded').length,
    exists: rows.filter((row) => row.status === 'exists').length,
    skipped: rows.filter((row) => String(row.status).startsWith('skipped_')).length,
    failed: rows.filter((row) => row.status === 'failed' || row.status === 'hash_mismatch').length,
  };

  const output = {
    schemaVersion: '1.0.0',
    generatedAt: new Date().toISOString(),
    sourceManifest: path.relative(ROOT, options.sourceManifest).replace(/\\/g, '/'),
    modelsRoot: path.relative(ROOT, options.modelsRoot).replace(/\\/g, '/'),
    force: options.force,
    source: {
      provider: source?.source?.provider || null,
      repoId: source?.source?.repoId || null,
      license: source?.source?.license || null,
      repoUrl: source?.source?.repoUrl || null,
    },
    summary,
    models: rows,
  };

  await writeManifest(options.outputManifest, output);
  console.log(`Manifest written: ${path.relative(ROOT, options.outputManifest).replace(/\\/g, '/')}`);

  if (failed) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
