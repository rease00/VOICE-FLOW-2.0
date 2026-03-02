#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

const backendRoot = process.cwd();
const workspaceRoot = path.resolve(backendRoot, "..");
const outputDir = path.join(workspaceRoot, "output", "audit");
const outPath = path.join(outputDir, "stress_matrix.json");
const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";

const steps = [
  { name: "audit:gemini-stack", args: ["run", "audit:gemini-stack"] },
  { name: "audit:media", args: ["run", "audit:media"] },
  { name: "test:contracts", args: ["run", "test:contracts"] },
  { name: "audit:tts:hindi", args: ["run", "audit:tts:hindi"] },
  { name: "audit:tts:longtext:smoke", args: ["run", "audit:tts:longtext:smoke"] },
  { name: "audit:tts:longtext:matrix", args: ["run", "audit:tts:longtext:matrix"] },
  { name: "test:tts:llvc:multispeaker", args: ["run", "test:tts:llvc:multispeaker"] },
  {
    name: "ci:reliability (gates on)",
    args: ["run", "ci:reliability"],
    env: {
      VF_ENABLE_LOAD_GATE: "1",
      VF_ENABLE_LIVE_AUDIT_GATE: "1",
      VF_ENABLE_LLVC_MAPPING_AUDIT_GATE: "1",
    },
  },
  { name: "audit:tts:live:50", args: ["run", "audit:tts:live:50"] },
  { name: "test:load:50:node", args: ["run", "test:load:50:node"] },
  { name: "test:load:50:k6", args: ["run", "test:load:50:k6"] },
];

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchJson(url, headers = {}) {
  try {
    const res = await fetch(url, { headers });
    const text = await res.text();
    let payload = null;
    try {
      payload = text ? JSON.parse(text) : null;
    } catch {
      payload = text;
    }
    return { ok: res.ok, status: res.status, payload };
  } catch (error) {
    return { ok: false, status: 0, payload: String(error instanceof Error ? error.message : error) };
  }
}

function runStep(step) {
  return new Promise((resolve) => {
    const startedAt = new Date().toISOString();
    const startedMs = Date.now();
    const child = spawn(npmCmd, step.args, {
      cwd: backendRoot,
      stdio: "inherit",
      env: { ...process.env, ...(step.env || {}) },
      shell: false,
      windowsHide: true,
    });

    child.on("error", (error) => {
      const finishedAt = new Date().toISOString();
      resolve({
        name: step.name,
        startedAt,
        finishedAt,
        elapsedMs: Date.now() - startedMs,
        ok: false,
        code: 1,
        error: error instanceof Error ? error.message : String(error),
      });
    });

    child.on("close", async (code) => {
      const finishedAt = new Date().toISOString();
      const health = await fetchJson("http://127.0.0.1:7800/health");
      const status = await fetchJson("http://127.0.0.1:7800/tts/engines/status");
      const queue = await fetchJson("http://127.0.0.1:7800/admin/tts/queue/metrics", { "x-dev-uid": "local_admin" });
      resolve({
        name: step.name,
        command: `${npmCmd} ${step.args.join(" ")}`,
        startedAt,
        finishedAt,
        elapsedMs: Date.now() - startedMs,
        ok: code === 0,
        code: code ?? 1,
        postCheck: {
          health,
          enginesStatus: status,
          queueMetrics: queue,
        },
      });
    });
  });
}

async function main() {
  await fs.mkdir(outputDir, { recursive: true });
  const report = {
    generatedAt: new Date().toISOString(),
    backendRoot,
    workspaceRoot,
    steps: [],
    summary: {
      total: steps.length,
      passed: 0,
      failed: 0,
    },
  };

  for (const step of steps) {
    console.log(`\n[stress-matrix] running ${step.name}`);
    const result = await runStep(step);
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
