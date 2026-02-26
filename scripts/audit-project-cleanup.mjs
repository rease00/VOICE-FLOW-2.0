#!/usr/bin/env node
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');
const REPORT_PATH = path.join(ROOT, 'artifacts', 'project_audit_cleanup_report.json');

const APPLY = process.argv.includes('--apply');
const ALL_FOLDERS = process.argv.includes('--all-folders');

const readNumberArg = (name) => {
  const prefix = `--${name}=`;
  const raw = process.argv.find((arg) => arg.startsWith(prefix));
  if (!raw) return null;
  const parsed = Number(raw.slice(prefix.length));
  return Number.isFinite(parsed) ? parsed : null;
};

const maxHashBytesArg = readNumberArg('max-hash-bytes');
const maxHashBytesEnv = Number(process.env.VF_PROJECT_AUDIT_MAX_HASH_BYTES || 60 * 1024 * 1024);
const MAX_HASH_FILE_BYTES = Number.isFinite(maxHashBytesArg) ? Number(maxHashBytesArg) : maxHashBytesEnv;
const MAX_HASH_UNLIMITED = MAX_HASH_FILE_BYTES <= 0;

const DEFAULT_SKIP_DIRS = new Set([
  '.git',
  'node_modules',
  '.venvs',
  'dist',
  '.idea',
  '.vscode',
]);

const DEFAULT_SKIP_PREFIXES = [
  'engines/xtts-runtime/models',
  'engines/kokoro-runtime/models',
  'engines/gemini-runtime/models',
  'artifacts/voice-assets',
  'artifacts/xtts_audio_mix_audit',
];

const SKIP_DIRS = ALL_FOLDERS ? new Set() : DEFAULT_SKIP_DIRS;
const SKIP_PREFIXES = ALL_FOLDERS ? [] : DEFAULT_SKIP_PREFIXES;

const SAFE_DUPLICATE_DELETE_PREFIXES = [
  'artifacts/',
  'backend/artifacts/',
  '.runtime/logs/',
];

const toRel = (absPath) => path.relative(ROOT, absPath).replace(/\\/g, '/');
const isInsideRoot = (relPath) => relPath && !relPath.startsWith('..') && !path.isAbsolute(relPath);

const shouldSkipRelPath = (relPath) => {
  if (!isInsideRoot(relPath)) return true;
  if (SKIP_PREFIXES.some((prefix) => relPath === prefix || relPath.startsWith(`${prefix}/`))) return true;
  const parts = relPath.split('/');
  return parts.some((part) => SKIP_DIRS.has(part));
};

const walkFiles = async (startAbs) => {
  const out = [];
  const stack = [startAbs];
  while (stack.length) {
    const current = stack.pop();
    const rel = toRel(current);
    if (rel && shouldSkipRelPath(rel)) continue;
    const entries = await fs.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const abs = path.join(current, entry.name);
      const entryRel = toRel(abs);
      if (shouldSkipRelPath(entryRel)) continue;
      if (entry.isDirectory()) {
        stack.push(abs);
      } else if (entry.isFile()) {
        out.push(abs);
      } else if (entry.isSymbolicLink()) {
        // Skip symbolic links to avoid cycles and external traversal.
        continue;
      }
    }
  }
  return out;
};

const sha256File = (filePath) => new Promise((resolve, reject) => {
  const hash = crypto.createHash('sha256');
  const stream = fsSync.createReadStream(filePath);
  stream.on('error', reject);
  stream.on('data', (chunk) => hash.update(chunk));
  stream.on('end', () => resolve(hash.digest('hex')));
});

const collectEnvFiles = async () => {
  const envPaths = [];
  const roots = [ROOT, path.join(ROOT, 'backend'), path.join(ROOT, 'engines')];
  for (const base of roots) {
    try {
      const entries = await fs.readdir(base, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isFile()) continue;
        if (!entry.name.startsWith('.env')) continue;
        const abs = path.join(base, entry.name);
        envPaths.push(abs);
      }
    } catch {
      // noop
    }
  }
  const seen = new Set();
  const uniq = [];
  for (const abs of envPaths) {
    const rel = toRel(abs);
    if (seen.has(rel)) continue;
    seen.add(rel);
    uniq.push(abs);
  }
  return uniq.sort((a, b) => toRel(a).localeCompare(toRel(b)));
};

const collectPycacheDirs = async () => {
  const out = [];
  const stack = [ROOT];
  while (stack.length) {
    const current = stack.pop();
    const rel = toRel(current);
    if (rel && shouldSkipRelPath(rel)) continue;
    const entries = await fs.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const abs = path.join(current, entry.name);
      const childRel = toRel(abs);
      if (shouldSkipRelPath(childRel)) continue;
      if (entry.name === '__pycache__') {
        out.push(abs);
        continue;
      }
      stack.push(abs);
    }
  }
  return out.sort((a, b) => toRel(a).localeCompare(toRel(b)));
};

const collectRuntimeManualLogs = async () => {
  const logDir = path.join(ROOT, '.runtime', 'logs');
  try {
    const entries = await fs.readdir(logDir, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile() && /manual/i.test(entry.name) && entry.name.endsWith('.log'))
      .map((entry) => path.join(logDir, entry.name))
      .sort((a, b) => toRel(a).localeCompare(toRel(b)));
  } catch {
    return [];
  }
};

const deleteFileSafe = async (absPath) => {
  await fs.unlink(absPath);
  return toRel(absPath);
};

const deleteDirSafe = async (absPath) => {
  await fs.rm(absPath, { recursive: true, force: true });
  return toRel(absPath);
};

const main = async () => {
  await fs.mkdir(path.dirname(REPORT_PATH), { recursive: true });

  const files = await walkFiles(ROOT);
  const keyedBySize = new Map();
  for (const abs of files) {
    const stat = await fs.stat(abs);
    if (stat.size <= 0) continue;
    if (!MAX_HASH_UNLIMITED && stat.size > MAX_HASH_FILE_BYTES) continue;
    const sizeKey = String(stat.size);
    if (!keyedBySize.has(sizeKey)) keyedBySize.set(sizeKey, []);
    keyedBySize.get(sizeKey).push(abs);
  }

  const duplicateGroups = [];
  for (const [size, group] of keyedBySize.entries()) {
    if (group.length < 2) continue;
    const byHash = new Map();
    for (const abs of group) {
      const hash = await sha256File(abs);
      const key = `${size}:${hash}`;
      if (!byHash.has(key)) byHash.set(key, []);
      byHash.get(key).push(abs);
    }
    for (const [key, hashedGroup] of byHash.entries()) {
      if (hashedGroup.length < 2) continue;
      duplicateGroups.push({
        key,
        sizeBytes: Number(size),
        files: hashedGroup
          .map((abs) => toRel(abs))
          .sort((a, b) => a.localeCompare(b)),
      });
    }
  }

  duplicateGroups.sort((a, b) => b.files.length - a.files.length || b.sizeBytes - a.sizeBytes);

  const envFiles = await collectEnvFiles();
  const envEntries = [];
  for (const abs of envFiles) {
    const rel = toRel(abs);
    const raw = await fs.readFile(abs, 'utf8');
    const lines = raw.split(/\r?\n/);
    const keys = lines
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#') && line.includes('='))
      .map((line) => line.split('=')[0].trim())
      .filter(Boolean);
    envEntries.push({
      file: rel,
      keyCount: keys.length,
      sampleKeys: keys.slice(0, 12),
    });
  }

  const manualLogs = await collectRuntimeManualLogs();
  const pycacheDirs = await collectPycacheDirs();

  const duplicateDeleteCandidates = [];
  for (const group of duplicateGroups) {
    const safe = group.files.every((rel) =>
      SAFE_DUPLICATE_DELETE_PREFIXES.some((prefix) => rel.startsWith(prefix))
    );
    if (!safe) continue;
    const sorted = group.files.slice().sort((a, b) => a.localeCompare(b));
    for (const rel of sorted.slice(1)) {
      duplicateDeleteCandidates.push(rel);
    }
  }

  const deleted = {
    duplicateFiles: [],
    runtimeManualLogs: [],
    pycacheDirs: [],
  };

  if (APPLY) {
    for (const rel of duplicateDeleteCandidates) {
      try {
        const abs = path.join(ROOT, rel);
        deleted.duplicateFiles.push(await deleteFileSafe(abs));
      } catch {
        // ignore delete failure
      }
    }
    for (const abs of manualLogs) {
      try {
        deleted.runtimeManualLogs.push(await deleteFileSafe(abs));
      } catch {
        // ignore
      }
    }
    for (const abs of pycacheDirs) {
      try {
        deleted.pycacheDirs.push(await deleteDirSafe(abs));
      } catch {
        // ignore
      }
    }
  }

  const report = {
    timestamp: new Date().toISOString(),
    mode: APPLY ? 'apply' : 'dry-run',
    settings: {
      allFolders: ALL_FOLDERS,
      maxHashFileBytes: MAX_HASH_UNLIMITED ? 'unlimited' : MAX_HASH_FILE_BYTES,
      skipDirs: [...SKIP_DIRS],
      skipPrefixes: SKIP_PREFIXES,
      safeDuplicateDeletePrefixes: SAFE_DUPLICATE_DELETE_PREFIXES,
    },
    summary: {
      scannedFiles: files.length,
      duplicateGroups: duplicateGroups.length,
      duplicateFilesTotal: duplicateGroups.reduce((acc, group) => acc + group.files.length, 0),
      duplicateDeleteCandidates: duplicateDeleteCandidates.length,
      runtimeManualLogsFound: manualLogs.length,
      pycacheDirsFound: pycacheDirs.length,
      deletedDuplicateFiles: deleted.duplicateFiles.length,
      deletedRuntimeManualLogs: deleted.runtimeManualLogs.length,
      deletedPycacheDirs: deleted.pycacheDirs.length,
    },
    duplicates: duplicateGroups,
    envFiles: envEntries,
    cleanupPlan: {
      duplicateDeleteCandidates,
      runtimeManualLogs: manualLogs.map((abs) => toRel(abs)),
      pycacheDirs: pycacheDirs.map((abs) => toRel(abs)),
    },
    deleted,
  };

  await fs.writeFile(REPORT_PATH, JSON.stringify(report, null, 2), 'utf8');
  console.log(`[project-audit] report: ${toRel(REPORT_PATH)}`);
  console.log(
    `[project-audit] duplicateGroups=${report.summary.duplicateGroups}, manualLogs=${report.summary.runtimeManualLogsFound}, pycacheDirs=${report.summary.pycacheDirsFound}`
  );
  if (APPLY) {
    console.log(
      `[project-audit] deleted duplicateFiles=${report.summary.deletedDuplicateFiles}, manualLogs=${report.summary.deletedRuntimeManualLogs}, pycacheDirs=${report.summary.deletedPycacheDirs}`
    );
  }
};

main().catch((error) => {
  console.error('[project-audit] failed');
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
