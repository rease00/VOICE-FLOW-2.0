#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const backendRoot = path.resolve(__dirname, "..");
const workspaceRoot = path.resolve(backendRoot, "..");
const outputDir = path.join(workspaceRoot, "output", "audit");

const EXCLUDE_DIRS = new Set([
  ".git",
  "node_modules",
  "dist",
  ".venvs",
  ".runtime",
  "artifacts",
  "models",
  "mcp-before-revert",
  "mcp-after-revert",
  "test-results",
]);

const FRONTEND_EXT = new Set([".ts", ".tsx"]);
const BACKEND_EXT = new Set([".py", ".mjs", ".js"]);

function walkFiles(rootDir, wantedExt) {
  const out = [];
  const stack = [rootDir];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) continue;
    let entries = [];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (EXCLUDE_DIRS.has(entry.name)) continue;
        stack.push(full);
        continue;
      }
      if (!entry.isFile()) continue;
      const ext = path.extname(entry.name).toLowerCase();
      if (wantedExt.has(ext)) {
        out.push(full);
      }
    }
  }
  return out;
}

function parseJsLikeFunctions(filePath, relPath) {
  const content = fs.readFileSync(filePath, "utf8");
  const lines = content.split(/\r?\n/);
  const entries = [];
  const seen = new Set();
  const addEntry = (lineNumber, name, kind) => {
    const key = `${lineNumber}:${name}:${kind}`;
    if (seen.has(key)) return;
    seen.add(key);
    entries.push({ file: relPath, line: lineNumber, name, kind });
  };
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] || "";

    let m = line.match(/^\s*(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*\(/);
    if (m) {
      addEntry(i + 1, m[1], "function_declaration");
      continue;
    }

    m = line.match(/^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][A-Za-z0-9_$]*)\s*=>/);
    if (m) {
      addEntry(i + 1, m[1], "arrow_function");
      continue;
    }

    m = line.match(/^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*=\s*(?:async\s*)?function\b/);
    if (m) {
      addEntry(i + 1, m[1], "function_expression");
      continue;
    }

    m = line.match(/^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*=/);
    if (m) {
      const name = m[1];
      const preview = lines.slice(i, Math.min(lines.length, i + 10)).join(" ");
      if (/(=>|function\b|\buseCallback\s*\(|\buseMemo\s*\(|\buseEffect\s*\()/.test(preview)) {
        addEntry(i + 1, name, "variable_function_like");
        continue;
      }
    }

    m = line.match(/^\s*(?:async\s+)?([A-Za-z_$][A-Za-z0-9_$]*)\s*\([^;]*\)\s*\{/);
    if (m) {
      const name = m[1];
      const skip = new Set(["if", "for", "while", "switch", "catch", "constructor"]);
      if (!skip.has(name)) {
        addEntry(i + 1, name, "method_or_function");
      }
    }
  }
  return entries;
}

function parsePythonFunctions(filePath, relPath) {
  const content = fs.readFileSync(filePath, "utf8");
  const lines = content.split(/\r?\n/);
  const entries = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] || "";
    let m = line.match(/^\s*def\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/);
    if (m) {
      entries.push({ file: relPath, line: i + 1, name: m[1], kind: "def" });
      continue;
    }
    m = line.match(/^\s*async\s+def\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/);
    if (m) {
      entries.push({ file: relPath, line: i + 1, name: m[1], kind: "async_def" });
    }
  }
  return entries;
}

function buildManifest(sectionRoot, exts, parserByExt) {
  const files = walkFiles(sectionRoot, exts).sort((a, b) => a.localeCompare(b));
  const functions = [];
  for (const filePath of files) {
    const relPath = path.relative(workspaceRoot, filePath).replace(/\\/g, "/");
    const ext = path.extname(filePath).toLowerCase();
    const parser = parserByExt.get(ext);
    if (!parser) continue;
    try {
      functions.push(...parser(filePath, relPath));
    } catch {
      // Ignore parse failures for manifest generation
    }
  }
  const perFile = new Map();
  for (const fn of functions) {
    perFile.set(fn.file, (perFile.get(fn.file) || 0) + 1);
  }
  return {
    generatedAt: new Date().toISOString(),
    sectionRoot: path.relative(workspaceRoot, sectionRoot).replace(/\\/g, "/"),
    fileCount: files.length,
    functionCount: functions.length,
    files: files.map((f) => path.relative(workspaceRoot, f).replace(/\\/g, "/")),
    functionCountByFile: Array.from(perFile.entries())
      .map(([file, count]) => ({ file, count }))
      .sort((a, b) => b.count - a.count || a.file.localeCompare(b.file)),
    functions,
  };
}

const frontendManifest = buildManifest(
  path.join(workspaceRoot, "frontend"),
  FRONTEND_EXT,
  new Map([
    [".ts", parseJsLikeFunctions],
    [".tsx", parseJsLikeFunctions],
  ])
);

const backendManifest = buildManifest(
  path.join(workspaceRoot, "backend"),
  BACKEND_EXT,
  new Map([
    [".py", parsePythonFunctions],
    [".mjs", parseJsLikeFunctions],
    [".js", parseJsLikeFunctions],
  ])
);

fs.mkdirSync(outputDir, { recursive: true });
fs.writeFileSync(path.join(outputDir, "function_manifest_frontend.json"), JSON.stringify(frontendManifest, null, 2), "utf8");
fs.writeFileSync(path.join(outputDir, "function_manifest_backend.json"), JSON.stringify(backendManifest, null, 2), "utf8");

console.log(`Wrote ${path.join("output", "audit", "function_manifest_frontend.json")}`);
console.log(`Wrote ${path.join("output", "audit", "function_manifest_backend.json")}`);
console.log(`Frontend: files=${frontendManifest.fileCount} functions=${frontendManifest.functionCount}`);
console.log(`Backend: files=${backendManifest.fileCount} functions=${backendManifest.functionCount}`);
