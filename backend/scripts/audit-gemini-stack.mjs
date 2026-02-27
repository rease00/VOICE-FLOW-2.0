#!/usr/bin/env node
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const ROOT = process.cwd();
const REPORT_PATH = path.join(ROOT, "artifacts", "gemini_stack_audit.json");
const MEDIA_BASE_URL = String(process.env.VF_MEDIA_BACKEND_URL || "http://127.0.0.1:7800").replace(/\/+$/, "");
const GEMINI_RUNTIME_URL = String(process.env.VF_GEMINI_RUNTIME_URL || "http://127.0.0.1:7810").replace(/\/+$/, "");
const ADMIN_UID = String(process.env.VF_AUDIT_ADMIN_UID || "local_admin").trim() || "local_admin";
const PORTS = [7800, 7810, 7820];
const BODY_SNIPPET_LIMIT = 500;

function truncate(value, max = BODY_SNIPPET_LIMIT) {
  const text = String(value || "").trim();
  if (!text) return "";
  if (text.length <= max) return text;
  return `${text.slice(0, max - 3)}...`;
}

function runSync(command, args, options = {}) {
  return spawnSync(command, args, {
    cwd: ROOT,
    encoding: "utf8",
    ...options,
  });
}

function normalizeArrayPayload(payload) {
  if (!payload) return [];
  if (Array.isArray(payload)) return payload;
  return [payload];
}

function collectListenersWindows() {
  const psScript = `
$ports = @(7800,7810,7820)
$rows = @()
foreach ($port in $ports) {
  $conns = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
  if (-not $conns) { continue }
  $owners = $conns | Select-Object -ExpandProperty OwningProcess -Unique
  foreach ($owner in $owners) {
    $proc = Get-CimInstance Win32_Process -Filter "ProcessId=$owner" -ErrorAction SilentlyContinue
    $rows += [pscustomobject]@{
      port = $port
      pid = $owner
      name = $proc.Name
      commandLine = $proc.CommandLine
    }
  }
}
$rows | ConvertTo-Json -Depth 4 -Compress
`.trim();

  const result = runSync("powershell.exe", ["-NoProfile", "-Command", psScript]);
  if (result.status !== 0) {
    return {
      ok: false,
      error: truncate(result.stderr || result.stdout || "Failed to read listeners via PowerShell."),
      listeners: [],
    };
  }

  let parsed = [];
  try {
    parsed = normalizeArrayPayload(result.stdout ? JSON.parse(result.stdout) : []);
  } catch {
    parsed = [];
  }
  return { ok: true, listeners: parsed };
}

function collectListenersPosix() {
  const result = runSync("sh", ["-lc", "lsof -n -P -iTCP -sTCP:LISTEN 2>/dev/null"]);
  if (result.status !== 0 && !result.stdout) {
    return {
      ok: false,
      error: "lsof unavailable or no listeners found.",
      listeners: [],
    };
  }
  const lines = String(result.stdout || "").split(/\r?\n/).filter(Boolean);
  const listeners = [];
  for (const line of lines.slice(1)) {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 9) continue;
    const command = parts[0];
    const pid = Number(parts[1]);
    const address = parts[8] || "";
    const match = address.match(/:(\d+)\s*\(LISTEN\)$/);
    if (!match) continue;
    const port = Number(match[1]);
    if (!PORTS.includes(port)) continue;
    listeners.push({
      port,
      pid,
      name: command,
      commandLine: line.trim(),
    });
  }
  return { ok: true, listeners };
}

function collectListeners() {
  if (process.platform === "win32") {
    return collectListenersWindows();
  }
  return collectListenersPosix();
}

async function fetchEndpoint(check) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Number(check.timeoutMs || 10000));
  try {
    const response = await fetch(check.url, {
      method: check.method || "GET",
      headers: check.headers || {},
      signal: controller.signal,
    });
    const contentType = String(response.headers.get("content-type") || "").toLowerCase();
    const rawText = await response.text();
    let parsed = null;
    if (rawText) {
      try {
        parsed = JSON.parse(rawText);
      } catch {
        parsed = null;
      }
    }
    return {
      name: check.name,
      method: check.method || "GET",
      url: check.url,
      status: response.status,
      ok: response.ok,
      contentType,
      bodySnippet: truncate(parsed ? JSON.stringify(parsed) : rawText),
      json: parsed,
    };
  } catch (error) {
    return {
      name: check.name,
      method: check.method || "GET",
      url: check.url,
      status: 0,
      ok: false,
      contentType: "",
      bodySnippet: truncate(error instanceof Error ? error.message : String(error)),
      json: null,
    };
  } finally {
    clearTimeout(timeout);
  }
}

function findEndpoint(resultList, name) {
  return resultList.find((item) => item.name === name) || null;
}

function derivePoolReadiness(endpointResults) {
  const backendPoolStatus = findEndpoint(endpointResults, "backend_pool_status");
  const backendPoolReload = findEndpoint(endpointResults, "backend_pool_reload");
  const runtimePoolStatus = findEndpoint(endpointResults, "runtime_pool_status");
  const runtimePoolReload = findEndpoint(endpointResults, "runtime_pool_reload");

  const backendJson = backendPoolStatus?.json && typeof backendPoolStatus.json === "object"
    ? backendPoolStatus.json
    : null;
  const runtimeJson = runtimePoolStatus?.json && typeof runtimePoolStatus.json === "object"
    ? runtimePoolStatus.json
    : null;

  const backendSource = backendJson?.backend?.source || null;
  const backendKeyCount = Number(backendJson?.backend?.pool?.keyCount || 0);
  const runtimeKeyCount = Number(runtimeJson?.pool?.keyCount || 0);

  return {
    backendKeyCount,
    runtimeKeyCount,
    backendSource,
    backendReloadStatus: backendPoolReload?.status || 0,
    runtimeReloadStatus: runtimePoolReload?.status || 0,
    runtimeReloadCompatibility:
      (backendPoolReload?.json && typeof backendPoolReload.json === "object"
        ? backendPoolReload.json?.runtimeReload?.compatibility
        : null) || null,
  };
}

async function main() {
  const startedAt = new Date().toISOString();
  const listeners = collectListeners();
  const adminHeaders = {
    Accept: "application/json",
    "x-dev-uid": ADMIN_UID,
  };

  const endpointChecks = [
    { name: "system_version", method: "GET", url: `${MEDIA_BASE_URL}/system/version`, headers: adminHeaders },
    { name: "backend_pool_status", method: "GET", url: `${MEDIA_BASE_URL}/admin/gemini/pool/status`, headers: adminHeaders },
    { name: "backend_pool_reload", method: "POST", url: `${MEDIA_BASE_URL}/admin/gemini/pool/reload`, headers: adminHeaders },
    { name: "runtime_pool_status", method: "GET", url: `${GEMINI_RUNTIME_URL}/v1/admin/api-pool`, headers: { Accept: "application/json" } },
    { name: "runtime_pool_reload", method: "POST", url: `${GEMINI_RUNTIME_URL}/v1/admin/api-pool/reload`, headers: { Accept: "application/json" } },
    { name: "generation_history", method: "GET", url: `${MEDIA_BASE_URL}/account/generation-history?limit=1`, headers: adminHeaders },
  ];

  const endpointMatrix = [];
  for (const check of endpointChecks) {
    endpointMatrix.push(await fetchEndpoint(check));
  }

  const report = {
    startedAt,
    finishedAt: new Date().toISOString(),
    platform: process.platform,
    node: process.version,
    hostname: os.hostname(),
    cwd: ROOT,
    mediaBaseUrl: MEDIA_BASE_URL,
    geminiRuntimeUrl: GEMINI_RUNTIME_URL,
    adminUid: ADMIN_UID,
    listeners,
    endpointMatrix: endpointMatrix.map((item) => ({
      name: item.name,
      method: item.method,
      url: item.url,
      status: item.status,
      ok: item.ok,
      contentType: item.contentType,
      bodySnippet: item.bodySnippet,
    })),
    poolReadiness: derivePoolReadiness(endpointMatrix),
  };

  await fs.mkdir(path.dirname(REPORT_PATH), { recursive: true });
  await fs.writeFile(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  console.log(`Gemini stack audit written to ${path.relative(ROOT, REPORT_PATH).replace(/\\/g, "/")}`);
  console.log(JSON.stringify(report.poolReadiness, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});

