import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const backendRoot = path.resolve(__dirname, '..');
const artifactsRoot = path.join(backendRoot, 'artifacts', 'dubbing');

const args = new Set(process.argv.slice(2));
const applyChanges = args.has('--apply');
const runFirestoreScan = args.has('--firestore');

const TARGET_KEYS = new Set(['engineExecutedDisplay']);

const summary = {
  mode: applyChanges ? 'apply' : 'dry-run',
  artifacts: {
    root: artifactsRoot,
    scanned: 0,
    changed: 0,
    skipped: 0,
    errors: 0,
    sampleChanges: [],
  },
  firestore: {
    enabled: runFirestoreScan,
    scannedDocs: 0,
    changedDocs: 0,
    skippedDocs: 0,
    errors: 0,
    detail: '',
  },
};

const isPlusLabel = (value) => {
  return typeof value === 'string' && value.trim().toUpperCase() === 'PLUS';
};

const clone = (value) => JSON.parse(JSON.stringify(value));

const rewriteEngineDisplayLabels = (value) => {
  let changed = false;

  const visit = (node) => {
    if (Array.isArray(node)) {
      for (const item of node) {
        visit(item);
      }
      return;
    }
    if (!node || typeof node !== 'object') return;

    for (const [key, raw] of Object.entries(node)) {
      if (TARGET_KEYS.has(key) && isPlusLabel(raw)) {
        node[key] = 'PRIME';
        changed = true;
        continue;
      }
      if (raw && typeof raw === 'object') {
        visit(raw);
      }
    }
  };

  const next = clone(value);
  visit(next);
  return { next, changed };
};

const collectReportFiles = async (rootDir) => {
  const out = [];

  const walk = async (dir) => {
    let entries = [];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
        continue;
      }
      if (entry.isFile() && entry.name.toLowerCase() === 'report.json') {
        out.push(fullPath);
      }
    }
  };

  await walk(rootDir);
  return out.sort((a, b) => a.localeCompare(b));
};

const processArtifactReports = async () => {
  const files = await collectReportFiles(artifactsRoot);

  if (!files.length) {
    summary.artifacts.detail = 'No local dubbing report artifacts found.';
    return;
  }

  for (const filePath of files) {
    summary.artifacts.scanned += 1;
    let rawText = '';
    let parsed = null;

    try {
      rawText = await fs.readFile(filePath, 'utf8');
      parsed = JSON.parse(rawText);
    } catch (error) {
      summary.artifacts.errors += 1;
      summary.artifacts.sampleChanges.push({
        file: filePath,
        error: `Failed to read/parse JSON: ${String(error?.message || error)}`,
      });
      continue;
    }

    const { next, changed } = rewriteEngineDisplayLabels(parsed);
    if (!changed) {
      summary.artifacts.skipped += 1;
      continue;
    }

    summary.artifacts.changed += 1;

    if (summary.artifacts.sampleChanges.length < 12) {
      summary.artifacts.sampleChanges.push({
        file: filePath,
        before: 'engineExecutedDisplay=PLUS',
        after: 'engineExecutedDisplay=PRIME',
      });
    }

    if (!applyChanges) continue;

    try {
      await fs.writeFile(filePath, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
    } catch (error) {
      summary.artifacts.errors += 1;
      summary.artifacts.sampleChanges.push({
        file: filePath,
        error: `Failed to write JSON: ${String(error?.message || error)}`,
      });
    }
  }

  summary.artifacts.detail = applyChanges
    ? 'Artifact backfill applied.'
    : 'Dry-run only. Re-run with --apply to persist changes.';
};

const runOptionalFirestoreBackfill = () => {
  if (!runFirestoreScan) {
    summary.firestore.skippedDocs = 1;
    summary.firestore.detail = 'Firestore scan skipped (use --firestore to enable).';
    return;
  }

  const pythonProgram = String(process.env.PYTHON || 'python').trim() || 'python';
  const pythonScript = String.raw`
import json
import os
import sys

apply_mode = '--apply' in sys.argv

summary = {
    'scannedDocs': 0,
    'changedDocs': 0,
    'skippedDocs': 0,
    'errors': 0,
    'detail': '',
}

def is_plus(value):
    return isinstance(value, str) and value.strip().upper() == 'PLUS'

def rewrite(node):
    changed = False
    if isinstance(node, dict):
        for key, value in list(node.items()):
            if key == 'engineExecutedDisplay' and is_plus(value):
                node[key] = 'PRIME'
                changed = True
            elif isinstance(value, (dict, list)):
                _, child_changed = rewrite(value)
                if child_changed:
                    changed = True
    elif isinstance(node, list):
        for item in node:
            _, child_changed = rewrite(item)
            if child_changed:
                changed = True
    return node, changed

try:
    import firebase_admin
    from firebase_admin import firestore
except Exception as exc:
    summary['skippedDocs'] = 1
    summary['detail'] = f'firebase_admin unavailable: {exc}'
    print(json.dumps(summary))
    raise SystemExit(0)

try:
    app = firebase_admin.get_app()
except Exception:
    try:
        app = firebase_admin.initialize_app()
    except Exception as exc:
        summary['skippedDocs'] = 1
        summary['detail'] = f'Firebase init skipped: {exc}'
        print(json.dumps(summary))
        raise SystemExit(0)

try:
    db = firestore.client(app=app)
except Exception as exc:
    summary['skippedDocs'] = 1
    summary['detail'] = f'Firestore client unavailable: {exc}'
    print(json.dumps(summary))
    raise SystemExit(0)

collections_raw = os.getenv('VF_FIRESTORE_BACKFILL_COLLECTIONS', 'dubbing_jobs,generation_history')
collections = [token.strip() for token in collections_raw.split(',') if token.strip()]
limit = int(os.getenv('VF_FIRESTORE_BACKFILL_LIMIT', '5000') or '5000')
remaining = max(0, limit)

for collection_name in collections:
    if remaining <= 0:
        break
    try:
        stream = db.collection(collection_name).limit(remaining).stream()
    except Exception as exc:
        summary['errors'] += 1
        summary['detail'] += f' [{collection_name}] stream failed: {exc}'
        continue

    for doc in stream:
        if remaining <= 0:
            break
        remaining -= 1
        summary['scannedDocs'] += 1

        try:
            payload = doc.to_dict() or {}
        except Exception as exc:
            summary['errors'] += 1
            summary['detail'] += f' [{collection_name}/{doc.id}] read failed: {exc}'
            continue

        updated, changed = rewrite(payload)
        if not changed:
            summary['skippedDocs'] += 1
            continue

        summary['changedDocs'] += 1
        if not apply_mode:
            continue

        try:
            doc.reference.set(updated, merge=True)
        except Exception as exc:
            summary['errors'] += 1
            summary['detail'] += f' [{collection_name}/{doc.id}] write failed: {exc}'

if not summary['detail']:
    summary['detail'] = 'Firestore scan completed.' if apply_mode else 'Firestore dry-run completed.'

print(json.dumps(summary))
`;

  const result = spawnSync(pythonProgram, ['-c', pythonScript, applyChanges ? '--apply' : '--dry-run'], {
    encoding: 'utf8',
    env: process.env,
  });

  if (result.error) {
    summary.firestore.errors += 1;
    summary.firestore.detail = `Failed to run Python Firestore scan: ${String(result.error.message || result.error)}`;
    return;
  }

  const stdout = String(result.stdout || '').trim();
  const lines = stdout ? stdout.split(/\r?\n/) : [];
  const lastLine = lines.length ? lines[lines.length - 1] : '{}';

  try {
    const parsed = JSON.parse(lastLine);
    summary.firestore.scannedDocs = Number(parsed.scannedDocs || 0);
    summary.firestore.changedDocs = Number(parsed.changedDocs || 0);
    summary.firestore.skippedDocs = Number(parsed.skippedDocs || 0);
    summary.firestore.errors = Number(parsed.errors || 0);
    summary.firestore.detail = String(parsed.detail || '');
  } catch (error) {
    summary.firestore.errors += 1;
    summary.firestore.detail = `Could not parse Firestore scan output: ${String(error?.message || error)}`;
  }

  if (result.status && result.status !== 0) {
    summary.firestore.errors += 1;
    const stderr = String(result.stderr || '').trim();
    if (stderr) {
      summary.firestore.detail = `${summary.firestore.detail} stderr=${stderr}`.trim();
    }
  }
};

await processArtifactReports();
runOptionalFirestoreBackfill();

console.log(JSON.stringify(summary, null, 2));

if (summary.artifacts.errors > 0 || summary.firestore.errors > 0) {
  process.exitCode = 1;
}
