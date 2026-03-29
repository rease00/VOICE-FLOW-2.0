#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const REPO_ROOT = String(
  execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: process.cwd(), encoding: 'utf8' }) || process.cwd()
).trim() || process.cwd();
const MAX_FILE_BYTES = 2 * 1024 * 1024;
const SKIP_PATHS = new Set([
  'backend/scripts/scan-tracked-secrets.mjs',
  'scripts/scan-staged-secrets.mjs',
]);

const SECRET_DETECTORS = [
  { id: 'gemini_api_key', regex: /AIza[0-9A-Za-z_-]{20,}/g },
  { id: 'stripe_secret_key', regex: /\bsk_(?:live|test)_[0-9A-Za-z]{12,}\b/g },
  { id: 'private_key_block', regex: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE\s+KEY-----/g },
  { id: 'service_account_private_key', regex: /"private_key"\s*:\s*"-----BEGIN\s+PRIVATE\s+KEY-----/g },
  {
    id: 'firebase_service_account_json',
    match: (text) => {
      const serviceAccount = /"type"\s*:\s*"service_account"/i.exec(text);
      if (!serviceAccount) return null;
      const privateKey = /"private_key"\s*:\s*"-----BEGIN\s+PRIVATE\s+KEY-----/i.exec(text);
      if (!privateKey) return null;
      return privateKey;
    },
  },
];

const listTrackedFiles = () => {
  const output = execFileSync('git', ['ls-files'], { cwd: REPO_ROOT, encoding: 'utf8' });
  return output
    .split(/\r?\n/)
    .map((row) => row.trim())
    .filter(Boolean)
    .filter((filePath) => !SKIP_PATHS.has(filePath.replace(/\\/g, '/')));
};

const lineOfIndex = (text, index) => {
  const prefix = text.slice(0, Math.max(0, index));
  return prefix.split(/\r?\n/).length;
};

const isLikelyText = (buffer) => {
  if (!buffer || buffer.length === 0) return true;
  const sampleLength = Math.min(buffer.length, 4096);
  let suspicious = 0;
  for (let index = 0; index < sampleLength; index += 1) {
    const byte = buffer[index];
    if (byte === 0) return false;
    const isControl = byte < 32 || (byte >= 127 && byte <= 159);
    const isAllowedControl = byte === 9 || byte === 10 || byte === 13 || byte === 12 || byte === 8;
    if (isControl && !isAllowedControl) suspicious += 1;
  }
  return (suspicious / sampleLength) < 0.3;
};

const collectRegexMatches = (regex, text) => {
  const matches = [];
  regex.lastIndex = 0;
  let match = null;
  while ((match = regex.exec(text)) !== null) {
    matches.push(match);
    if (match[0] === '') {
      regex.lastIndex += 1;
    }
  }
  return matches;
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

    let rawBuffer = null;
    try {
      rawBuffer = await fs.readFile(absolutePath);
    } catch {
      continue;
    }
    if (!isLikelyText(rawBuffer)) {
      continue;
    }
    const rawText = rawBuffer.toString('utf8');

    for (const pattern of SECRET_DETECTORS) {
      const matches = 'regex' in pattern
        ? collectRegexMatches(pattern.regex, rawText)
        : (() => {
            const match = pattern.match(rawText);
            return match ? [match] : [];
          })();
      for (const match of matches) {
        if (!match) continue;
        const sample = String(match[0] || '').slice(0, 80);
        const matchIndex = typeof match.index === 'number' ? match.index : rawText.indexOf(sample);
        findings.push({
          file: relativePath,
          line: lineOfIndex(rawText, Math.max(0, matchIndex)),
          detector: pattern.id,
          sample,
        });
      }
    }
  }

  if (findings.length === 0) {
    console.log(`[secret-scan] ok (${trackedFiles.length} tracked files scanned; text-safe, size-capped).`);
    return;
  }

  console.error('[secret-scan] potential secrets detected in tracked files:');
  for (const finding of findings) {
    console.error(`- ${finding.file}:${finding.line} detector=${finding.detector} sample=${finding.sample}`);
  }
  process.exit(1);
};

run().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
