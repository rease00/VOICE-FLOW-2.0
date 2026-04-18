#!/usr/bin/env node
/**
 * Guards against committing files with names that break Windows or look
 * like accidental absolute-path captures.
 *
 * Run via pre-commit hook OR `node scripts/guard-reserved-names.mjs`.
 * Exits non-zero if any offending path is staged or present at repo root.
 */
import { execSync } from "node:child_process";
import path from "node:path";

const RESERVED = new Set([
  "CON", "PRN", "AUX", "NUL",
  "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8", "COM9",
  "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
]);

// Windows path-shaped filename like "CUsers1wasi..." (a flattened path string).
const PATH_SHAPED = /^([A-Z]Users[A-Za-z0-9_]+|[A-Z]:[\\/])/;

function getStaged() {
  try {
    const out = execSync("git diff --cached --name-only --diff-filter=A", {
      encoding: "utf8",
    });
    return out.split(/\r?\n/).filter(Boolean);
  } catch {
    return [];
  }
}

function getAllTracked() {
  try {
    const out = execSync("git ls-files", { encoding: "utf8" });
    return out.split(/\r?\n/).filter(Boolean);
  } catch {
    return [];
  }
}

const target = process.argv.includes("--all") ? getAllTracked() : getStaged();
const offenders = [];

for (const file of target) {
  const base = path.basename(file);
  const stem = base.replace(/\.[^.]+$/, "").toUpperCase();
  if (RESERVED.has(stem)) {
    offenders.push({ file, reason: `reserved Windows device name "${stem}"` });
    continue;
  }
  if (PATH_SHAPED.test(base)) {
    offenders.push({ file, reason: "filename looks like a flattened absolute path" });
  }
}

if (offenders.length > 0) {
  console.error("\n[guard-reserved-names] BLOCKED — fix these before committing:\n");
  for (const o of offenders) {
    console.error(`  ✗ ${o.file}\n      ${o.reason}`);
  }
  console.error("\nRename or delete the file. On Windows, delete via:");
  console.error('  cmd /c del "\\\\?\\<absolute path>"\n');
  process.exit(1);
}

if (process.argv.includes("--verbose")) {
  console.log("[guard-reserved-names] OK");
}
