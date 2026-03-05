#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');
const DEFAULT_REPO = String(process.env.VF_KOKORO_MODEL_REPO_ID || 'onnx-community/Kokoro-82M-v1.0-ONNX').trim();
const DEFAULT_REVISION = String(process.env.VF_KOKORO_MODEL_REVISION || 'main').trim() || 'main';
const DEFAULT_TARGET_ROOT = path.resolve(String(process.env.VF_LOCAL_MODEL_MIRROR_DIR || path.join(ROOT, 'models')).trim());
const HUGGINGFACE_TOKEN = String(process.env.HUGGINGFACE_TOKEN || process.env.HF_TOKEN || '').trim();

const args = process.argv.slice(2);
const hasFlag = (flag) => args.includes(flag);
const readArg = (flag, fallback = '') => {
  const idx = args.indexOf(flag);
  if (idx < 0) return fallback;
  const value = args[idx + 1];
  if (!value || value.startsWith('-')) return fallback;
  return value;
};

const repoId = readArg('--repo', DEFAULT_REPO) || DEFAULT_REPO;
const revision = readArg('--revision', DEFAULT_REVISION) || DEFAULT_REVISION;
const targetRoot = path.resolve(readArg('--target', DEFAULT_TARGET_ROOT) || DEFAULT_TARGET_ROOT);
const dryRun = hasFlag('--dry-run');
const force = hasFlag('--force');
const maxConcurrency = Math.max(1, Number(readArg('--concurrency', '4')) || 4);

const modelRoot = path.join(targetRoot, repoId);

function buildHeaders(extra = {}) {
  return {
    Accept: 'application/json',
    ...(HUGGINGFACE_TOKEN ? { Authorization: `Bearer ${HUGGINGFACE_TOKEN}` } : {}),
    ...extra,
  };
}

async function fetchJson(url) {
  const response = await fetch(url, { headers: buildHeaders() });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Request failed (${response.status}) ${url} ${String(text).slice(0, 200)}`);
  }
  return response.json();
}

async function fetchBuffer(url) {
  const response = await fetch(url, { headers: buildHeaders({ Accept: '*/*' }) });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Download failed (${response.status}) ${url} ${String(text).slice(0, 200)}`);
  }
  const arr = await response.arrayBuffer();
  return Buffer.from(arr);
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function safeWriteFileAtomic(filePath, bytes) {
  const tempPath = `${filePath}.tmp-${Date.now()}-${Math.round(Math.random() * 9999)}`;
  fs.writeFileSync(tempPath, bytes);
  fs.renameSync(tempPath, filePath);
}

async function listRepositoryFiles() {
  const encodedRepo = repoId.split('/').map((part) => encodeURIComponent(part)).join('/');
  const apiUrl = `https://huggingface.co/api/models/${encodedRepo}/tree/${encodeURIComponent(revision)}?recursive=1`;
  const payload = await fetchJson(apiUrl);
  if (!Array.isArray(payload)) {
    throw new Error('Unexpected Hugging Face tree payload.');
  }
  return payload
    .filter((item) => item && typeof item === 'object')
    .map((item) => ({
      path: String(item.path || '').trim(),
      type: String(item.type || '').trim(),
      size: Number(item.size || 0),
    }))
    .filter((item) => item.type === 'file' && item.path.length > 0)
    .sort((a, b) => a.path.localeCompare(b.path));
}

function needsDownload(localPath, expectedSize) {
  if (force) return true;
  if (!fs.existsSync(localPath)) return true;
  if (!Number.isFinite(expectedSize) || expectedSize <= 0) return false;
  try {
    const stat = fs.statSync(localPath);
    return Number(stat.size) !== Number(expectedSize);
  } catch {
    return true;
  }
}

async function runPool(items, workerFn, concurrency) {
  const queue = items.slice();
  const workers = Array.from({ length: Math.max(1, concurrency) }, async () => {
    while (queue.length > 0) {
      const next = queue.shift();
      if (!next) break;
      await workerFn(next);
    }
  });
  await Promise.all(workers);
}

async function main() {
  console.log(`[kokoro-mirror] repo=${repoId} revision=${revision}`);
  console.log(`[kokoro-mirror] target=${modelRoot}`);
  if (dryRun) {
    console.log('[kokoro-mirror] dry-run enabled (no files written).');
  }

  const files = await listRepositoryFiles();
  if (files.length === 0) {
    throw new Error('No files discovered in repository tree.');
  }

  let downloadCount = 0;
  let skipCount = 0;
  let byteCount = 0;

  if (!dryRun) {
    ensureDir(modelRoot);
  }

  await runPool(
    files,
    async (file) => {
      const localPath = path.join(modelRoot, ...file.path.split('/'));
      const shouldDownload = needsDownload(localPath, file.size);
      if (!shouldDownload) {
        skipCount += 1;
        return;
      }
      downloadCount += 1;
      byteCount += Number.isFinite(file.size) && file.size > 0 ? file.size : 0;
      console.log(`[kokoro-mirror] ${dryRun ? 'would-download' : 'download'} ${file.path}`);
      if (dryRun) return;

      ensureDir(path.dirname(localPath));
      const encodedRepo = repoId.split('/').map((part) => encodeURIComponent(part)).join('/');
      const encodedPath = file.path.split('/').map((part) => encodeURIComponent(part)).join('/');
      const downloadUrl = `https://huggingface.co/${encodedRepo}/resolve/${encodeURIComponent(revision)}/${encodedPath}`;
      const bytes = await fetchBuffer(downloadUrl);
      safeWriteFileAtomic(localPath, bytes);
    },
    maxConcurrency
  );

  const summary = {
    repoId,
    revision,
    modelRoot,
    totalFiles: files.length,
    downloaded: downloadCount,
    skipped: skipCount,
    expectedBytesDownloaded: byteCount,
    dryRun,
  };

  if (!dryRun) {
    const manifestPath = path.join(modelRoot, '.mirror-manifest.json');
    fs.writeFileSync(manifestPath, JSON.stringify({ ...summary, updatedAt: new Date().toISOString() }, null, 2));
  }

  console.log(`[kokoro-mirror] summary=${JSON.stringify(summary)}`);
}

main().catch((error) => {
  console.error(`[kokoro-mirror] failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
