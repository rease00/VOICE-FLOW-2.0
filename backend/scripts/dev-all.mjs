#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");
const WORKSPACE_ROOT = path.resolve(ROOT, "..");
const PID_DIR = path.join(ROOT, ".runtime", "pids");
const STATE_DIR = path.join(ROOT, ".runtime", "state");
const DEV_ALL_SESSION_FILE = path.join(STATE_DIR, "dev-all-session.json");
const DEV_ALL_SESSION_ID = `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
const SERVICE_CATALOG = [
  { id: "media-backend", name: "Media Backend", logFile: ".runtime/logs/media-backend.log" },
  { id: "gemini-runtime", name: "Gemini Runtime", logFile: ".runtime/logs/gemini-runtime.log" },
  { id: "vertex-text-runtime", name: "Vertex Text Runtime", logFile: ".runtime/logs/vertex-text-runtime.log" },
];
const SERVICES = SERVICE_CATALOG;

const BOOTSTRAP_MODE = String(process.env.VF_DEV_BOOTSTRAP_MODE || "cpu").trim().toLowerCase() === "gpu" ? "gpu" : "cpu";
const KEEP_SERVICES = toBool(process.env.VF_DEV_KEEP_SERVICES, false);
const BOOTSTRAP_RETRIES = sanitizePositiveInt(process.env.VF_DEV_BOOTSTRAP_RETRIES, 3);
const RETRY_BASE_MS = sanitizePositiveInt(process.env.VF_DEV_RETRY_BASE_MS, 1500);
const RETRY_MAX_MS = sanitizePositiveInt(process.env.VF_DEV_RETRY_MAX_MS, 10000);
const SERVICE_RESTART_MAX = sanitizePositiveInt(process.env.VF_DEV_SERVICE_RESTART_MAX, 3);
const CRASH_WINDOW_MS = sanitizePositiveInt(process.env.VF_DEV_CRASH_WINDOW_MS, 120000);
const MONITOR_INTERVAL_MS = 2500;
const AUTO_SEED_FIREBASE_ADMINS = toBool(process.env.VF_DEV_AUTO_SEED_FIREBASE_ADMINS, false);
const WATCHDOG_ENABLED = !KEEP_SERVICES && toBool(process.env.VF_DEV_ENABLE_WATCHDOG, true);
const WATCHDOG_POLL_MS = sanitizePositiveInt(process.env.VF_DEV_WATCHDOG_POLL_MS, 2000);
const WATCHDOG_GRACE_MS = sanitizePositiveInt(process.env.VF_DEV_WATCHDOG_GRACE_MS, 5000);
const UI_SESSION_MONITOR_ENABLED = !KEEP_SERVICES && toBool(process.env.VF_DEV_UI_SESSION_MONITOR_ENABLED, true);
const UI_SESSION_STATUS_URL = String(process.env.VF_DEV_UI_SESSION_STATUS_URL || "http://127.0.0.1:3000/api/dev/session").trim();
const UI_SESSION_MONITOR_INTERVAL_MS = sanitizePositiveInt(process.env.VF_DEV_UI_SESSION_MONITOR_INTERVAL_MS, 5000);
const UI_SESSION_IDLE_SHUTDOWN_MS = sanitizePositiveInt(process.env.VF_DEV_UI_IDLE_SHUTDOWN_MS, 45000);
const UI_SESSION_STATUS_TIMEOUT_MS = sanitizePositiveInt(process.env.VF_DEV_UI_SESSION_STATUS_TIMEOUT_MS, 2000);
const VITE_EXIT_WAIT_MS = sanitizePositiveInt(process.env.VF_DEV_VITE_EXIT_WAIT_MS, 2000);

let shuttingDown = false;
let servicesDownAttempted = false;
let viteChild = null;
let monitorTimer = null;
let monitorBusy = false;
let uiSessionMonitorTimer = null;
let uiSessionMonitorBusy = false;
let uiSessionSeen = false;
let uiSessionIdleSinceMs = 0;

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

function toBool(raw, fallback) {
  const token = String(raw || "").trim().toLowerCase();
  if (!token) return fallback;
  if (["1", "true", "yes", "on"].includes(token)) return true;
  if (["0", "false", "no", "off"].includes(token)) return false;
  return fallback;
}

function ensureRuntimeStateDir() {
  fs.mkdirSync(STATE_DIR, { recursive: true });
}

function writeSessionLease() {
  if (!WATCHDOG_ENABLED) return;
  ensureRuntimeStateDir();
  const payload = {
    sessionId: DEV_ALL_SESSION_ID,
    ownerPid: process.pid,
    startedAtMs: Date.now(),
  };
  fs.writeFileSync(DEV_ALL_SESSION_FILE, `${JSON.stringify(payload)}\n`, "utf8");
}

function clearSessionLease() {
  if (!WATCHDOG_ENABLED) return;
  try {
    if (!fs.existsSync(DEV_ALL_SESSION_FILE)) return;
    const raw = fs.readFileSync(DEV_ALL_SESSION_FILE, "utf8");
    const parsed = JSON.parse(String(raw || "{}"));
    if (String(parsed?.sessionId || "") !== DEV_ALL_SESSION_ID) return;
    fs.rmSync(DEV_ALL_SESSION_FILE, { force: true });
  } catch {
    // ignore lease cleanup errors
  }
}

function startWatchdog() {
  if (!WATCHDOG_ENABLED) return;
  writeSessionLease();
  const args = [
    "scripts/dev-all-watchdog.mjs",
    "--owner-pid",
    String(process.pid),
    "--session-id",
    DEV_ALL_SESSION_ID,
    "--session-file",
    DEV_ALL_SESSION_FILE,
    "--poll-ms",
    String(WATCHDOG_POLL_MS),
    "--grace-ms",
    String(WATCHDOG_GRACE_MS),
  ];
  try {
    const child = spawn(process.execPath, args, {
      cwd: ROOT,
      env: process.env,
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    });
    child.unref();
    console.log(`[dev-all] stage=watchdog status=armed pid=${child.pid}`);
  } catch (error) {
    console.error(
      `[dev-all] stage=watchdog status=warn cause="${error instanceof Error ? error.message : String(error)}"`
    );
  }
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
  console.error("  - npm run services:down && npm run services:doctor");
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

function resolveFirebaseSeedPythonBin() {
  const byService = String(process.env.VF_PYTHON_BIN_MEDIA_BACKEND || "").trim();
  if (byService) return byService;

  const venvPython = path.join(
    ROOT,
    ".venvs",
    "media-backend",
    process.platform === "win32" ? "Scripts" : "bin",
    process.platform === "win32" ? "python.exe" : "python"
  );
  if (fs.existsSync(venvPython)) return venvPython;

  const byGlobal = String(process.env.VF_PYTHON_BIN || "").trim();
  if (byGlobal) return byGlobal;

  return process.platform === "win32" ? "python" : "python3";
}

function hasFirebaseAdminSeedCredentials() {
  return Boolean(
    String(process.env.GOOGLE_APPLICATION_CREDENTIALS || "").trim() ||
    String(process.env.FIREBASE_SERVICE_ACCOUNT_JSON || "").trim()
  );
}

function runFirebaseAdminSeedIfEnabled() {
  if (!AUTO_SEED_FIREBASE_ADMINS) {
    return Promise.resolve(true);
  }

  if (!hasFirebaseAdminSeedCredentials()) {
    console.error('[dev-all] stage=seed status=skip reason="firebase admin credentials not configured"');
    return Promise.resolve(true);
  }

  const pythonBin = resolveFirebaseSeedPythonBin();
  const seedArgs = ["scripts/firebase_seed_admins.py"];
  if (!toBool(process.env.VF_FIRESTORE_ENABLE, true)) {
    seedArgs.push("--skip-firestore");
  }

  return new Promise((resolve) => {
    console.error(
      `[dev-all] stage=seed status=starting python="${path.basename(pythonBin)}" firestore_mode=${seedArgs.includes("--skip-firestore") ? "auth_only" : "auth_and_firestore"}`
    );
    const child = spawn(pythonBin, seedArgs, {
      cwd: ROOT,
      stdio: "inherit",
      env: process.env,
      windowsHide: false,
    });

    child.on("exit", (code, signal) => {
      if (code === 0) {
        console.error("[dev-all] stage=seed status=ok");
        resolve(true);
        return;
      }
      const cause = describeBootstrapError(code, signal);
      console.error(`[dev-all] stage=seed status=fail cause="${cause}"`);
      resolve(false);
    });

    child.on("error", (error) => {
      const cause = error instanceof Error ? error.message : String(error);
      console.error(`[dev-all] stage=seed status=fail cause="${cause}"`);
      resolve(false);
    });
  });
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

function runServicesDown() {
  return new Promise((resolve) => {
    const args = buildBootstrapArgs("down");
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

function runServicesDownSyncIfNeeded(reason = "unexpected_exit") {
  if (KEEP_SERVICES || servicesDownAttempted) return;
  servicesDownAttempted = true;
  try {
    const args = buildBootstrapArgs("down");
    const result = spawnSync(process.execPath, args, {
      cwd: ROOT,
      stdio: "ignore",
      env: process.env,
      windowsHide: true,
    });
    if (result.status !== 0) {
      console.error(`[dev-all] stage=shutdown-sync status=warn reason=${reason} code=${result.status ?? "unknown"}`);
    }
  } catch (error) {
    console.error(
      `[dev-all] stage=shutdown-sync status=warn reason=${reason} cause="${error instanceof Error ? error.message : String(error)}"`
    );
  }
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

async function fetchActiveUiSessionCount() {
  if (!UI_SESSION_STATUS_URL) return null;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    try {
      controller.abort();
    } catch {
      // ignore abort failures
    }
  }, UI_SESSION_STATUS_TIMEOUT_MS);
  try {
    const response = await fetch(UI_SESSION_STATUS_URL, {
      method: "GET",
      cache: "no-store",
      headers: { "cache-control": "no-store" },
      signal: controller.signal,
    });
    if (!response.ok) return null;
    const payload = await response.json();
    const count = Number(payload?.activeSessions || 0);
    if (!Number.isFinite(count) || count < 0) return 0;
    return Math.floor(count);
  } catch {
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function monitorUiSessionsTick() {
  if (!UI_SESSION_MONITOR_ENABLED || shuttingDown) return;
  if (uiSessionMonitorBusy) return;
  uiSessionMonitorBusy = true;
  try {
    const activeCount = await fetchActiveUiSessionCount();
    if (activeCount === null) {
      return;
    }
    if (activeCount > 0) {
      uiSessionSeen = true;
      uiSessionIdleSinceMs = 0;
      return;
    }
    if (!uiSessionSeen) {
      return;
    }
    if (!uiSessionIdleSinceMs) {
      uiSessionIdleSinceMs = Date.now();
      return;
    }
    const idleForMs = Date.now() - uiSessionIdleSinceMs;
    if (idleForMs < UI_SESSION_IDLE_SHUTDOWN_MS) return;
    console.log(
      `[dev-all] stage=ui-session-monitor status=idle active_sessions=0 idle_ms=${idleForMs} -> shutting down`
    );
    void shutdown(0);
  } finally {
    uiSessionMonitorBusy = false;
  }
}

function startUiSessionMonitor() {
  if (!UI_SESSION_MONITOR_ENABLED) return;
  uiSessionMonitorTimer = setInterval(() => {
    void monitorUiSessionsTick();
  }, UI_SESSION_MONITOR_INTERVAL_MS);
}

function stopUiSessionMonitor() {
  if (!uiSessionMonitorTimer) return;
  clearInterval(uiSessionMonitorTimer);
  uiSessionMonitorTimer = null;
}

function waitForChildExit(child, timeoutMs) {
  if (!child) return Promise.resolve(true);
  if (child.exitCode !== null || child.signalCode) return Promise.resolve(true);
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.removeListener("exit", onExit);
      resolve(value);
    };
    const onExit = () => finish(true);
    const timer = setTimeout(() => finish(false), Math.max(1, Math.floor(Number(timeoutMs || 0))));
    child.once("exit", onExit);
  });
}

function forceKillProcessTree(pid) {
  const safePid = Number(pid);
  if (!Number.isFinite(safePid) || safePid <= 0) return;
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/PID", String(safePid), "/T", "/F"], {
      stdio: "ignore",
      windowsHide: true,
    });
    return;
  }
  try {
    process.kill(safePid, "SIGKILL");
  } catch {
    // ignore
  }
}

async function stopViteChild() {
  if (!viteChild) return;
  const child = viteChild;
  viteChild = null;
  if (child.exitCode !== null || child.signalCode) return;
  try {
    child.kill("SIGTERM");
  } catch {
    // ignore
  }
  const exitedGracefully = await waitForChildExit(child, VITE_EXIT_WAIT_MS);
  if (exitedGracefully) return;
  forceKillProcessTree(child.pid);
  await waitForChildExit(child, 1000);
}

async function cleanupSessionServices() {
  stopMonitor();
  stopUiSessionMonitor();
}

function startVite() {
  return new Promise((resolve) => {
    const frontendRoot = path.join(WORKSPACE_ROOT, "frontend");
    const npmExecPath = process.env.npm_execpath;
    if (!npmExecPath) {
      console.error('[dev-all] stage=vite status=fail cause="npm_execpath is not set"');
      resolve(1);
      return;
    }
    const args = [npmExecPath, "run", "dev:ui"];

    try {
      viteChild = spawn(process.execPath, args, {
        cwd: frontendRoot,
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

  await stopViteChild();
  await cleanupSessionServices();
  if (KEEP_SERVICES) {
    console.log("[dev-all] info=services remain active (VF_DEV_KEEP_SERVICES=1). Use `npm run services:down` to stop them.");
  } else {
    servicesDownAttempted = true;
    console.log("[dev-all] info=stopping local services (default auto-stop behavior).");
    const downResult = await runServicesDown();
    if (!downResult.ok) {
      console.error(
        `[dev-all] stage=shutdown status=warn cause="${downResult.cause || "services:down failed"}"`
      );
      printNextSteps();
    }
  }
  clearSessionLease();
  process.exit(exitCode);
}

process.on("SIGINT", () => {
  void shutdown(0);
});

process.on("SIGTERM", () => {
  void shutdown(0);
});

process.on("SIGHUP", () => {
  void shutdown(0);
});

process.on("uncaughtException", (error) => {
  console.error(`[dev-all] stage=orchestrator status=panic cause="${error instanceof Error ? error.stack || error.message : String(error)}"`);
  void shutdown(1);
});

process.on("unhandledRejection", (reason) => {
  console.error(`[dev-all] stage=orchestrator status=panic cause="${reason instanceof Error ? reason.stack || reason.message : String(reason)}"`);
  void shutdown(1);
});

process.on("exit", () => {
  clearSessionLease();
  runServicesDownSyncIfNeeded("process_exit");
});

async function main() {
  startWatchdog();
  preSnapshot = snapshotRunningServices();
  const bootOk = await runBootstrapWithRetry();
  if (!bootOk) {
    await shutdown(1);
    return;
  }

  const seedOk = await runFirebaseAdminSeedIfEnabled();
  if (!seedOk) {
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
  startUiSessionMonitor();
  const viteExit = await startVite();
  await shutdown(viteExit);
}

main().catch(async (error) => {
  console.error(`[dev-all] stage=orchestrator status=fail cause="${error instanceof Error ? error.message : String(error)}"`);
  printNextSteps();
  await shutdown(1);
});
