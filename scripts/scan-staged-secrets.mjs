#!/usr/bin/env node
import { execFileSync } from 'node:child_process';

const REPO_ROOT = String(
  execFileSync('git', ['rev-parse', '--show-toplevel'], {
    cwd: process.cwd(),
    encoding: 'utf8',
  }) || process.cwd()
).trim() || process.cwd();

const MAX_FILE_BYTES = 2 * 1024 * 1024;
const SELF_SCRIPT_PATH = 'scripts/scan-staged-secrets.mjs';
const SKIP_PATHS = new Set([
  SELF_SCRIPT_PATH,
  'backend/scripts/scan-tracked-secrets.mjs',
]);

const SECRET_PATTERNS = [
  { id: 'private_key_block', regex: /-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/i },
  { id: 'service_account_private_key', regex: /"private_key"\s*:\s*"-----BEGIN PRIVATE KEY-----/i },
  { id: 'google_api_key', regex: /AIza[0-9A-Za-z_-]{35}/ },
  { id: 'aws_access_key_id', regex: /\bAKIA[0-9A-Z]{16}\b/ },
  { id: 'github_pat', regex: /\bgh[pousr]_[A-Za-z0-9_]{36,255}\b/ },
  { id: 'slack_token', regex: /\bxox[baprs]-[0-9A-Za-z-]{10,}\b/ },
  { id: 'stripe_live_secret', regex: /\bsk_live_[0-9A-Za-z]{12,}\b/ },
  { id: 'huggingface_token', regex: /\bhf_[A-Za-z0-9]{20,}\b/ },
  {
    id: 'admin_runtime_token_assignment',
    regex: /\b(?:GEMINI_RUNTIME_ADMIN_TOKEN|VF_ADMIN_APPROVAL_TOKEN|VF_ADMIN_UNLOCK_SIGNING_SECRET)\s*[:=]\s*["']?[A-Za-z0-9._\-\/+=]{16,}/i,
  },
];

const PLACEHOLDER_HINTS = [
  /your[_-]?token/i,
  /your[_-]?key/i,
  /placeholder/i,
  /replace[_-]?with/i,
  /replace[_-]?me/i,
  /please[_-]?set/i,
  /redacted/i,
  /demo[-_]?key/i,
  /example/i,
];

const lineOfIndex = (text, index) => text.slice(0, Math.max(0, index)).split(/\r?\n/).length;

const isBinary = (rawBuffer) => rawBuffer.includes(0);

const listStagedFiles = () => {
  const out = execFileSync('git', ['diff', '--cached', '--name-only', '--diff-filter=ACMR'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
  });
  return out
    .split(/\r?\n/)
    .map((row) => row.trim())
    .filter(Boolean);
};

const readStagedFile = (filePath) => {
  const raw = execFileSync('git', ['show', `:${filePath}`], {
    cwd: REPO_ROOT,
    encoding: 'buffer',
    maxBuffer: MAX_FILE_BYTES * 4,
  });
  if (!raw || raw.length === 0) return '';
  if (raw.length > MAX_FILE_BYTES) return '';
  if (isBinary(raw)) return '';
  return raw.toString('utf8');
};

const looksLikePlaceholder = (value) => PLACEHOLDER_HINTS.some((pattern) => pattern.test(value));

const run = async () => {
  const stagedFiles = listStagedFiles();
  if (stagedFiles.length === 0) {
    console.log('[secret-scan] no staged files to scan.');
    return;
  }

  const findings = [];

  for (const filePath of stagedFiles) {
    if (SKIP_PATHS.has(filePath.replace(/\\/g, '/'))) {
      continue;
    }
    let text = '';
    try {
      text = readStagedFile(filePath);
    } catch {
      continue;
    }
    if (!text) continue;

    for (const detector of SECRET_PATTERNS) {
      const match = detector.regex.exec(text);
      if (!match) continue;
      const sample = String(match[0] || '').slice(0, 120);
      if (looksLikePlaceholder(sample)) continue;
      findings.push({
        file: filePath,
        line: lineOfIndex(text, match.index),
        detector: detector.id,
        sample,
      });
    }
  }

  if (findings.length === 0) {
    console.log(`[secret-scan] ok (${stagedFiles.length} staged files scanned).`);
    return;
  }

  console.error('[secret-scan] potential secrets detected in staged content:');
  for (const finding of findings) {
    console.error(`- ${finding.file}:${finding.line} detector=${finding.detector} sample=${finding.sample}`);
  }
  process.exit(1);
};

run().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
