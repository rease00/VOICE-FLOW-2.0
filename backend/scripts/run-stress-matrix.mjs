#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { buildAuditHeaders, classifyAuditFailure, fetchJsonWithTimeout, normalizeBaseUrl } from "./lib/audit-helpers.mjs";
import { runCommand } from "./lib/process-runner.mjs";

const backendRoot = process.cwd();
const workspaceRoot = path.resolve(backendRoot, "..");
const outputDir = path.join(workspaceRoot, "output", "audit");
const outPath = path.join(outputDir, "stress_matrix.json");
const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";
const backendBaseUrl = normalizeBaseUrl(process.env.VF_MEDIA_BACKEND_URL, "http://127.0.0.1:7800");
const deploymentProfile = String(process.env.VF_LOAD_PROFILE || "cloudrun-2vcpu").trim() || "cloudrun-2vcpu";

const steps = [
  { name: "audit:gemini-stack", args: ["run", "audit:gemini-stack"] },
  { name: "audit:media", args: ["run", "audit:media"] },
  { name: "test:contracts", args: ["run", "test:contracts"] },
  { name: "audit:tts:hindi", args: ["run", "audit:tts:hindi"] },
  { name: "audit:tts:longtext:smoke", args: ["run", "audit:tts:longtext:smoke"] },
  { name: "audit:tts:longtext:matrix", args: ["run", "audit:tts:longtext:matrix"] },
  {
    name: "ci:reliability (gates on)",
    args: ["run", "ci:reliability"],
    env: {
      VF_ENABLE_LOAD_GATE: "1",
      VF_ENABLE_LOAD_GATE_100: "1",
      VF_ENABLE_LIVE_AUDIT_GATE: "1",
    },
  },
  { name: "audit:tts:live:50", args: ["run", "audit:tts:live:50"] },
  { name: "test:load:50:node", args: ["run", "test:load:50:node"] },
  { name: "test:load:50:k6", args: ["run", "test:load:50:k6"] },
  { name: "test:load:100:node", args: ["run", "test:load:100:node"] },
  { name: "test:load:100:k6", args: ["run", "test:load:100:k6"] },
];

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchJson(url, headers = {}) {
  const result = await fetchJsonWithTimeout(
    url,
    {
      method: "GET",
      headers,
    },
    10_000
  );
  return {
    ok: result.ok,
    status: result.status,
    payload: result.payload,
    classification: classifyAuditFailure(result),
  };
}

async function collectBackendChecks(authHeaders) {
  const [health, status, queue] = await Promise.all([
    fetchJson(`${backendBaseUrl}/health`, authHeaders),
    fetchJson(`${backendBaseUrl}/tts/engines/status`, authHeaders),
    fetchJson(`${backendBaseUrl}/admin/tts/queue/metrics`, authHeaders),
  ]);

  return {
    ok: health.ok && status.ok && queue.ok,
    health,
    enginesStatus: status,
    queueMetrics: queue,
  };
}

async function runStep(step, authHeaders) {
  const startedAt = new Date().toISOString();
  const preCheck = await collectBackendChecks(authHeaders);
  const result = await runCommand(npmCmd, step.args, {
    cwd: backendRoot,
    env: { ...process.env, VF_LOAD_PROFILE: deploymentProfile, ...(step.env || {}) },
    stdio: "inherit",
  });
  const finishedAt = new Date().toISOString();
  const postCheck = await collectBackendChecks(authHeaders);

  return {
    name: step.name,
    command: result.command,
    startedAt,
    finishedAt,
    elapsedMs: result.elapsedMs,
    ok: result.ok,
    code: result.code,
    error: result.error,
    preCheck,
    postCheck,
  };
}

async function main() {
  const { headers: authHeaders, auth } = buildAuditHeaders(
    { Accept: "application/json" },
    { scriptName: "audit:stress:matrix", defaultDevUid: "local_admin" }
  );

  await fs.mkdir(outputDir, { recursive: true });
  const report = {
    generatedAt: new Date().toISOString(),
    deploymentProfile,
    backendRoot,
    workspaceRoot,
    backendBaseUrl,
    authMode: auth.mode,
    steps: [],
    summary: {
      total: steps.length,
      passed: 0,
      failed: 0,
    },
  };

  for (const step of steps) {
    console.log(`\n[stress-matrix] running ${step.name}`);
    const result = await runStep(step, authHeaders);
    report.steps.push(result);
    if (result.ok) {
      report.summary.passed += 1;
    } else {
      report.summary.failed += 1;
    }
    await delay(600);
  }

  report.summary.totalElapsedMs = report.steps.reduce((sum, step) => sum + Number(step.elapsedMs || 0), 0);
  report.summary.passedAll = report.summary.failed === 0;

  await fs.writeFile(outPath, JSON.stringify(report, null, 2), "utf8");
  console.log(`\n[stress-matrix] wrote ${path.relative(workspaceRoot, outPath).replace(/\\/g, "/")}`);
  if (!report.summary.passedAll) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
