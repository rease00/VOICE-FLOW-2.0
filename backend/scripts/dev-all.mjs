#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");
const WORKSPACE_ROOT = path.resolve(ROOT, "..");
const PID_DIR = path.join(ROOT, ".runtime", "pids");

const SERVICES = [
  { id: "media-backend", name: "Media Backend", logFile: ".runtime/logs/media-backend.log" },
  { id: "gemini-runtime", name: "Gemini Runtime", logFile: ".runtime/logs/gemini-runtime.log" },
  { id: "kokoro-runtime", name: "Kokoro Runtime", logFile: ".runtime/logs/kokoro-runtime.log" },
];

const BOOTSTRAP_MODE = String(process.env.VF_DEV_BOOTSTRAP_MODE || "cpu").trim().toLowerCase() === "gpu" ? "gpu" : "cpu";
const BOOTSTRAP_RETRIES = sanitizePositiveInt(process.env.VF_DEV_BOOTSTRAP_RETRIES, 3);
const RETRY_BASE_MS = sanitizePositiveInt(process.env.VF_DEV_RETRY_BASE_MS, 1500);
const RETRY_MAX_MS = sanitizePositiveInt(process.env.VF_DEV_RETRY_MAX_MS, 10000);
const SERVICE_RESTART_MAX = sanitizePositiveInt(process.env.VF_DEV_SERVICE_RESTART_MAX, 3);
const CRASH_WINDOW_MS = sanitizePositiveInt(process.env.VF_DEV_CRASH_WINDOW_MS, 120000);
const MONITOR_INTERVAL_MS = 2500;

let shuttingDown = false;
let viteChild = null;
let monitorTimer = null;
let monitorBusy = false;

const restartState = new Map();
const unhealthyServices = new Set();
const sessionOwnedServiceIds = new Set();
let sessionPids = new Map();
let preSnapshot = new Map();

function sanitizePositiveInt(raw, fallback) {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.floor(parsed);
}

function isPidAlive(pid) {
  if (!pid || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function readPidFile(serviceId) {
  const pidPath = path.join(PID_DIR, `${serviceId}.pid`);
  if (!fs.existsSync(pidPath)) return null;
  const text = fs.readFileSync(pidPath, "utf8").trim();
  if (!text) return null;
  const pid = Number(text);
  if (!Number.isFinite(pid) || pid <= 0) return null;
  return pid;
}

function snapshotRunningServices() {
  const snap = new Map();
  for (const service of SERVICES) {
    const pid = readPidFile(service.id);
    if (pid && isPidAlive(pid)) {
      snap.set(service.id, pid);
    }
  }
  return snap;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function describeBootstrapError(code, signal) {
  if (signal) return `signal ${signal}`;
  if (typeof code === "number") return `exit code ${code}`;
  return "unknown failure";
}

function delayForAttempt(attemptIndex) {
  const exp = RETRY_BASE_MS * (2 ** attemptIndex);
  const capped = Math.min(exp, RETRY_MAX_MS);
  const jitter = Math.floor(Math.random() * Math.min(750, Math.max(100, Math.floor(capped * 0.2))));
  return capped + jitter;
}

function buildBootstrapArgs(command) {
  const args = ["scripts/bootstrap-services.mjs", command];
  if (BOOTSTRAP_MODE === "gpu") args.push("--gpu");
  return args;
}

function printNextSteps(serviceId = null) {
  if (serviceId) {
    const service = SERVICES.find((item) => item.id === serviceId);
    if (service) {
      console.error(`[dev-all] logs: ${service.logFile}`);
    }
  }
  console.error("[dev-all] next steps:");
  console.error("  - npm run services:check");
  console.error("  - npm run services:restart");
  console.error("  - npm run services:down && npm run services:bootstrap");
}

function runBootstrapOnce(attempt, maxAttempts) {
  return new Promise((resolve) => {
    const args = buildBootstrapArgs("up");
    const child = spawn(process.execPath, args, {
      cwd: ROOT,
      stdio: "inherit",
      env: process.env,
    });
    child.on("exit", (code, signal) => {
      if (code === 0) {
        resolve({ ok: true });
        return;
      }
      const cause = describeBootstrapError(code, signal);
      console.error(
        `[dev-all] stage=bootstrap attempt=${attempt}/${maxAttempts} status=fail cause="${cause}"`
      );
      resolve({ ok: false, cause });
    });
    child.on("error", (error) => {
      const cause = error instanceof Error ? error.message : String(error);
      console.error(
        `[dev-all] stage=bootstrap attempt=${attempt}/${maxAttempts} status=fail cause="${cause}"`
      );
      resolve({ ok: false, cause });
    });
  });
}

async function runBootstrapWithRetry() {
  const maxAttempts = BOOTSTRAP_RETRIES + 1;
  for (let i = 0; i < maxAttempts; i += 1) {
    const attempt = i + 1;
    const result = await runBootstrapOnce(attempt, maxAttempts);
    if (result.ok) return true;
    if (attempt >= maxAttempts) {
      console.error(
        `[dev-all] stage=bootstrap status=exhausted attempts=${maxAttempts} cause="${result.cause}"`
      );
      printNextSteps();
      return false;
    }
    const waitMs = delayForAttempt(i);
    console.error(
      `[dev-all] stage=bootstrap status=retry attempt=${attempt}/${maxAttempts} wait_ms=${waitMs}`
    );
    await sleep(waitMs);
  }
  return false;
}

function computeSessionOwnedServices(beforeSnap, afterSnap) {
  const owned = new Set();
  for (const service of SERVICES) {
    const beforePid = beforeSnap.get(service.id);
    const afterPid = afterSnap.get(service.id);
    if (!afterPid) continue;
    if (!beforePid || beforePid !== afterPid) {
      owned.add(service.id);
    }
  }
  return owned;
}

function trimRestartHistory(timestamps, now) {
  return timestamps.filter((ts) => now - ts <= CRASH_WINDOW_MS);
}

function canRestartService(serviceId) {
  const now = Date.now();
  const history = trimRestartHistory(restartState.get(serviceId) || [], now);
  restartState.set(serviceId, history);
  return history.length < SERVICE_RESTART_MAX;
}

function recordRestart(serviceId) {
  const now = Date.now();
  const history = trimRestartHistory(restartState.get(serviceId) || [], now);
  history.push(now);
  restartState.set(serviceId, history);
}

function runServiceRestart(serviceId) {
  return new Promise((resolve) => {
    const args = buildBootstrapArgs("restart");
    args.push(serviceId);
    const child = spawn(process.execPath, args, {
      cwd: ROOT,
      stdio: "inherit",
      env: process.env,
    });
    child.on("exit", (code, signal) => {
      if (code === 0) {
        resolve({ ok: true });
        return;
      }
      resolve({ ok: false, cause: describeBootstrapError(code, signal) });
    });
    child.on("error", (error) => {
      resolve({ ok: false, cause: error instanceof Error ? error.message : String(error) });
    });
  });
}

async function monitorServicesTick() {
  if (shuttingDown) return;
  if (monitorBusy) return;
  monitorBusy = true;
  try {
    for (const serviceId of sessionOwnedServiceIds) {
      const trackedPid = sessionPids.get(serviceId);
      if (!trackedPid) continue;
      if (isPidAlive(trackedPid)) continue;
      if (unhealthyServices.has(serviceId)) continue;
      if (!canRestartService(serviceId)) {
        unhealthyServices.add(serviceId);
        console.error(
          `[dev-all] stage=restart service=${serviceId} status=cap_reached attempts=${SERVICE_RESTART_MAX}`
        );
        printNextSteps(serviceId);
        continue;
      }

      const service = SERVICES.find((item) => item.id === serviceId);
      const history = restartState.get(serviceId) || [];
      const nextAttempt = history.length + 1;
      const maxAttempts = SERVICE_RESTART_MAX;
      console.error(
        `[dev-all] stage=restart service=${serviceId} attempt=${nextAttempt}/${maxAttempts} status=starting`
      );
      recordRestart(serviceId);
      const restartResult = await runServiceRestart(serviceId);
      if (!restartResult.ok) {
        console.error(
          `[dev-all] stage=restart service=${serviceId} attempt=${nextAttempt}/${maxAttempts} status=fail cause="${restartResult.cause}"`
        );
        if (service) {
          printNextSteps(service.id);
        } else {
          printNextSteps();
        }
        if (!canRestartService(serviceId)) {
          unhealthyServices.add(serviceId);
        }
        continue;
      }

      const newPid = readPidFile(serviceId);
      if (!newPid || !isPidAlive(newPid)) {
        console.error(
          `[dev-all] stage=restart service=${serviceId} attempt=${nextAttempt}/${maxAttempts} status=fail cause="pid missing after restart"`
        );
        printNextSteps(serviceId);
        if (!canRestartService(serviceId)) {
          unhealthyServices.add(serviceId);
        }
        continue;
      }
      sessionPids.set(serviceId, newPid);
      console.error(
        `[dev-all] stage=restart service=${serviceId} attempt=${nextAttempt}/${maxAttempts} status=ok pid=${newPid}`
      );
    }
  } catch (error) {
    const cause = error instanceof Error ? error.message : String(error);
    console.error(`[dev-all] stage=monitor status=warn cause="${cause}"`);
    printNextSteps();
  } finally {
    monitorBusy = false;
  }
}

function startMonitor() {
  monitorTimer = setInterval(() => {
    void monitorServicesTick();
  }, MONITOR_INTERVAL_MS);
}

function stopMonitor() {
  if (monitorTimer) {
    clearInterval(monitorTimer);
    monitorTimer = null;
  }
}

async function cleanupSessionServices() {
  stopMonitor();
}

function startVite() {
  return new Promise((resolve) => {
    const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";
    const args = ["--prefix", "frontend", "run", "dev:ui"];

    try {
      viteChild = spawn(npmCmd, args, {
        cwd: WORKSPACE_ROOT,
        stdio: "inherit",
        env: process.env,
        windowsHide: false,
      });
    } catch (error) {
      console.error(
        `[dev-all] stage=vite status=fail cause="${error instanceof Error ? error.message : String(error)}"`
      );
      resolve(1);
      return;
    }

    viteChild.on("error", (error) => {
      console.error(
        `[dev-all] stage=vite status=fail cause="${error instanceof Error ? error.message : String(error)}"`
      );
      resolve(1);
    });

    viteChild.on("exit", (code, signal) => {
      if (signal) {
        resolve(1);
        return;
      }
      resolve(typeof code === "number" ? code : 1);
    });
  });
}

async function shutdown(exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;

  if (viteChild && !viteChild.killed) {
    try {
      viteChild.kill("SIGTERM");
    } catch {
      // ignore
    }
  }
  await cleanupSessionServices();
  console.log("[dev-all] info=services remain active. Use `npm run services:down` to stop them.");
  process.exit(exitCode);
}

process.on("SIGINT", () => {
  void shutdown(0);
});

process.on("SIGTERM", () => {
  void shutdown(0);
});

async function main() {
  preSnapshot = snapshotRunningServices();
  const bootOk = await runBootstrapWithRetry();
  if (!bootOk) {
    await shutdown(1);
    return;
  }

  const postSnapshot = snapshotRunningServices();
  sessionOwnedServiceIds.clear();
  for (const id of computeSessionOwnedServices(preSnapshot, postSnapshot)) {
    sessionOwnedServiceIds.add(id);
  }
  sessionPids = postSnapshot;

  const ownedNames = [...sessionOwnedServiceIds].join(", ") || "(none)";
  console.log(
    `[dev-all] bootstrap=ok mode=${BOOTSTRAP_MODE} session_owned=${ownedNames}`
  );

  startMonitor();
  const viteExit = await startVite();
  await shutdown(viteExit);
}

main().catch(async (error) => {
  console.error(`[dev-all] stage=orchestrator status=fail cause="${error instanceof Error ? error.message : String(error)}"`);
  printNextSteps();
  await shutdown(1);
});
