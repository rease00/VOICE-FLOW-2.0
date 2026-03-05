#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const REPO_ROOT = String(
  execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: process.cwd(), encoding: 'utf8' }) || process.cwd()
).trim() || process.cwd();
const MAX_FILE_BYTES = 2 * 1024 * 1024;
const CONFIG_PREFIXES = [
  'backend/config/',
  'infra/cloudrun/',
  'k8s/',
];
const ENV_FILE_PATTERNS = [
  /^\.env(\..+)?$/i,
  /^backend\/\.env(\..+)?$/i,
  /^frontend\/\.env(\..+)?$/i,
];

const SECRET_PATTERNS = [
  { id: 'gemini_api_key', regex: /AIza[0-9A-Za-z_-]{20,}/g },
  { id: 'stripe_secret_key', regex: /\bsk_(?:live|test)_[0-9A-Za-z]{12,}\b/g },
  { id: 'private_key_block', regex: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g },
  { id: 'service_account_private_key', regex: /"private_key"\s*:\s*"-----BEGIN PRIVATE KEY-----/g },
];

const isConfigScope = (filePath) => {
  const normalized = filePath.replace(/\\/g, '/');
  if (CONFIG_PREFIXES.some((prefix) => normalized.startsWith(prefix))) return true;
  return ENV_FILE_PATTERNS.some((pattern) => pattern.test(normalized));
};

const listTrackedFiles = () => {
  const output = execFileSync('git', ['ls-files'], { cwd: REPO_ROOT, encoding: 'utf8' });
  return output
    .split(/\r?\n/)
    .map((row) => row.trim())
    .filter(Boolean)
    .filter((filePath) => isConfigScope(filePath));
};

const lineOfIndex = (text, index) => {
  const prefix = text.slice(0, Math.max(0, index));
  return prefix.split(/\r?\n/).length;
};

const run = async () => {
  const trackedFiles = listTrackedFiles();
  const findings = [];

  for (const relativePath of trackedFiles) {
    const absolutePath = path.join(REPO_ROOT, relativePath);
    let stat;
    try {
      stat = await fs.stat(absolutePath);
    } catch {
      continue;
    }
    if (!stat.isFile() || stat.size > MAX_FILE_BYTES) {
      continue;
    }

    let rawText = '';
    try {
      rawText = await fs.readFile(absolutePath, 'utf8');
    } catch {
      continue;
    }

    for (const pattern of SECRET_PATTERNS) {
      pattern.regex.lastIndex = 0;
      const match = pattern.regex.exec(rawText);
      if (!match) continue;
      findings.push({
        file: relativePath,
        line: lineOfIndex(rawText, match.index),
        detector: pattern.id,
        sample: String(match[0] || '').slice(0, 80),
      });
    }
  }

  if (findings.length === 0) {
    console.log(`[secret-scan] ok (${trackedFiles.length} tracked config files scanned).`);
    return;
  }

  console.error('[secret-scan] potential secrets detected in tracked config files:');
  for (const finding of findings) {
    console.error(`- ${finding.file}:${finding.line} detector=${finding.detector} sample=${finding.sample}`);
  }
  process.exit(1);
};

run().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
