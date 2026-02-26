#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");
const ENV_FILE = path.join(ROOT, ".env");

function parseEnvValue(rawValue) {
  const trimmed = rawValue.trim();
  if (!trimmed) return "";

  const quote = trimmed[0];
  const isQuoted =
    (quote === '"' && trimmed.endsWith('"')) || (quote === "'" && trimmed.endsWith("'"));
  if (!isQuoted) return trimmed;

  let inner = trimmed.slice(1, -1);
  if (quote === '"') {
    inner = inner
      .replace(/\\n/g, "\n")
      .replace(/\\r/g, "\r")
      .replace(/\\t/g, "\t")
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, "\\");
  }
  return inner;
}

function loadDotEnv(filePath) {
  if (!fs.existsSync(filePath)) return;

  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const normalized = trimmed.startsWith("export ") ? trimmed.slice(7).trim() : trimmed;
    const equalsIndex = normalized.indexOf("=");
    if (equalsIndex <= 0) continue;

    const key = normalized.slice(0, equalsIndex).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    if (process.env[key] !== undefined) continue;

    const rawValue = normalized.slice(equalsIndex + 1);
    process.env[key] = parseEnvValue(rawValue);
  }
}

// Ensure local service launches pick up secrets and runtime config from .env.
loadDotEnv(ENV_FILE);

const PYTHON_BIN = process.env.VF_PYTHON_BIN || (process.platform === "win32" ? "python" : "python3");
const VENV_DIR = path.join(ROOT, ".venvs");
const RUNTIME_DIR = path.join(ROOT, ".runtime");
const PID_DIR = path.join(RUNTIME_DIR, "pids");
const LOG_DIR = path.join(RUNTIME_DIR, "logs");
const STATE_DIR = path.join(RUNTIME_DIR, "state");

const RETRY_INTERVAL_MS = Number(process.env.VF_BOOTSTRAP_RETRY_INTERVAL_MS || 4000);
const REQUEST_TIMEOUT_MS = Number(process.env.VF_BOOTSTRAP_REQUEST_TIMEOUT_MS || 15000);
const DEFAULT_CHECK_TIMEOUT_MS = Number(process.env.VF_BOOTSTRAP_CHECK_TIMEOUT_MS || 60000);
const FAST_TIMEOUT_MS = Number(process.env.VF_BOOTSTRAP_TIMEOUT_FAST_MS || DEFAULT_CHECK_TIMEOUT_MS);
const KOKORO_TIMEOUT_MS = Number(
  process.env.VF_BOOTSTRAP_TIMEOUT_KOKORO_MS || Math.max(DEFAULT_CHECK_TIMEOUT_MS, 90000)
);

const argv = process.argv.slice(2);
const POSITIONAL_ARGS = argv.filter((arg) => !arg.startsWith("-"));
const COMMAND = (POSITIONAL_ARGS[0] || "up").toLowerCase();
const COMMAND_ARG = POSITIONAL_ARGS[1] || "";
const GPU_MODE = argv.includes("--gpu");
const VALID_COMMANDS = new Set(["up", "check", "down", "switch", "restart"]);

if (!VALID_COMMANDS.has(COMMAND)) {
  console.error(`Unknown command "${COMMAND}". Use one of: up, check, down, switch, restart.`);
  process.exit(1);
}

const pythonPathFor = (venvName) =>
  path.join(
    VENV_DIR,
    venvName,
    process.platform === "win32" ? "Scripts" : "bin",
    process.platform === "win32" ? "python.exe" : "python"
  );

const servicePidPath = (id) => path.join(PID_DIR, `${id}.pid`);
const serviceLogPath = (id) => path.join(LOG_DIR, `${id}.log`);
const serviceStatePath = (id) => path.join(STATE_DIR, `${id}.sha256`);

const SERVICES = [
  {
    id: "media-backend",
    name: "Media Backend",
    port: 7800,
    venv: "media-backend",
    requirements: ["backend/requirements.txt"],
    sourceFiles: ["backend/app.py", "scripts/bootstrap-services.mjs"],
    command: (pythonBin) => [pythonBin, "backend/app.py"],
    env: (gpu) => ({
      VF_BACKEND_HOST: "127.0.0.1",
      VF_BACKEND_PORT: "7800",
      VF_WHISPER_DEVICE: gpu ? "cuda" : "cpu",
      VF_WHISPER_COMPUTE: gpu ? "float16" : "int8",
      VF_RVC_DEVICE: process.env.VF_RVC_DEVICE || (gpu ? "cuda:0" : "cpu:0"),
      VF_RVC_MODELS_DIR: process.env.VF_RVC_MODELS_DIR || path.join(ROOT, "backend/models/rvc"),
    }),
  },
  {
    id: "gemini-runtime",
    name: "Gemini Runtime",
    port: 7810,
    venv: "gemini-runtime",
    requirements: ["engines/gemini-runtime/requirements.txt"],
    sourceFiles: ["engines/gemini-runtime/app.py", "scripts/bootstrap-services.mjs"],
    command: (pythonBin) => [
      pythonBin,
      "-m",
      "uvicorn",
      "app:app",
      "--app-dir",
      "engines/gemini-runtime",
      "--host",
      "127.0.0.1",
      "--port",
      "7810",
    ],
    env: () => ({}),
  },
  {
    id: "kokoro-runtime",
    name: "Kokoro Runtime",
    port: 7820,
    venv: "kokoro-runtime",
    requirements: ["engines/kokoro-runtime/requirements.txt"],
    sourceFiles: ["engines/kokoro-runtime/app.py", "scripts/bootstrap-services.mjs"],
    command: (pythonBin) => [
      pythonBin,
      "-m",
      "uvicorn",
      "app:app",
      "--app-dir",
      "engines/kokoro-runtime",
      "--host",
      "127.0.0.1",
      "--port",
      "7820",
    ],
    env: (gpu) => ({
      KOKORO_DEVICE: gpu ? "cuda" : "cpu",
    }),
  },
];

const ENGINE_TO_SERVICE_ID = {
  GEM: "gemini-runtime",
  GEMINI: "gemini-runtime",
  KOKORO: "kokoro-runtime",
};

const CHECKS = [
  {
    name: "Media Backend",
    url: "http://127.0.0.1:7800/health",
    timeoutMs: FAST_TIMEOUT_MS,
    validate: (payload) => typeof payload === "object" && payload !== null && typeof payload.ok === "boolean",
  },
  {
    name: "Gemini Runtime",
    url: "http://127.0.0.1:7810/health",
    timeoutMs: FAST_TIMEOUT_MS,
    validate: (payload) => typeof payload === "object" && payload !== null && payload.ok === true,
  },
  {
    name: "Kokoro Runtime",
    url: "http://127.0.0.1:7820/health",
    timeoutMs: KOKORO_TIMEOUT_MS,
    validate: (payload) => typeof payload === "object" && payload !== null && payload.ok === true,
  },
];

function ensureDirs() {
  fs.mkdirSync(VENV_DIR, { recursive: true });
  fs.mkdirSync(PID_DIR, { recursive: true });
  fs.mkdirSync(LOG_DIR, { recursive: true });
  fs.mkdirSync(STATE_DIR, { recursive: true });
}

function sha256(content) {
  return crypto.createHash("sha256").update(content).digest("hex");
}

function fileSha(service) {
  const requirementSource = service.requirements
    .map((reqPath) => {
      const abs = path.join(ROOT, reqPath);
      if (!fs.existsSync(abs)) {
        throw new Error(`Missing requirements file: ${reqPath}`);
      }
      return `# ${reqPath}\n${fs.readFileSync(abs, "utf8")}`;
    })
    .join("\n\n");
  const sourceFileSource = (service.sourceFiles || [])
    .map((sourcePath) => {
      const abs = path.join(ROOT, sourcePath);
      if (!fs.existsSync(abs)) {
        return `# ${sourcePath}\n<missing>`;
      }
      return `# ${sourcePath}\n${fs.readFileSync(abs, "utf8")}`;
    })
    .join("\n\n");
  return sha256(`${requirementSource}\n\n${sourceFileSource}`);
}

function resolveServiceTarget(rawTarget) {
  const input = String(rawTarget || "").trim();
  if (!input) return null;
  const normalized = input.toUpperCase().replace(/[^A-Z_]/g, "_").replace(/__+/g, "_");
  const engineServiceId = ENGINE_TO_SERVICE_ID[normalized];
  if (engineServiceId) {
    const service = SERVICES.find((item) => item.id === engineServiceId);
    if (service) return service;
  }
  const direct = SERVICES.find((item) => item.id === input);
  if (direct) return direct;
  return null;
}

function ensureKokoroTorchRuntimeDlls() {
  if (process.platform !== "win32") return;

  const scriptsDir = path.join(VENV_DIR, "kokoro-runtime", "Scripts");
  const torchLibDir = path.join(VENV_DIR, "kokoro-runtime", "Lib", "site-packages", "torch", "lib");
  if (!fs.existsSync(scriptsDir) || !fs.existsSync(torchLibDir)) return;

  const dllNames = [
    "concrt140.dll",
    "msvcp140.dll",
    "msvcp140_1.dll",
    "msvcp140_2.dll",
    "msvcp140_atomic_wait.dll",
    "msvcp140_codecvt_ids.dll",
    "vcamp140.dll",
    "vcomp140.dll",
    "vcruntime140.dll",
    "vcruntime140_1.dll",
    "vcruntime140_threads.dll",
  ];

  let copied = 0;
  let skippedLocked = 0;
  for (const dllName of dllNames) {
    const source = path.join(scriptsDir, dllName);
    if (!fs.existsSync(source)) continue;
    const target = path.join(torchLibDir, dllName);
    if (fs.existsSync(target)) continue;

    try {
      fs.copyFileSync(source, target);
      copied += 1;
    } catch (error) {
      if (error && ["EBUSY", "EPERM", "EACCES"].includes(error.code) && fs.existsSync(target)) {
        skippedLocked += 1;
        continue;
      }
      throw error;
    }
  }

  if (copied > 0) {
    console.log(`Synced ${copied} MSVC runtime DLL(s) into Kokoro torch lib.`);
  }
  if (skippedLocked > 0) {
    console.log(`Skipped ${skippedLocked} locked MSVC DLL(s); existing files were kept.`);
  }
}

function runServiceFixups(service) {
  if (service.id === "kokoro-runtime") {
    ensureKokoroTorchRuntimeDlls();
  }
}

function runCommand(cmd, args, options = {}) {
  const printable = [cmd, ...args].join(" ");
  console.log(`\n$ ${printable}`);
  const result = spawnSync(cmd, args, {
    cwd: options.cwd || ROOT,
    env: { ...process.env, ...(options.env || {}) },
    stdio: "inherit",
  });
  if (result.status !== 0) {
    throw new Error(`Command failed (${result.status ?? "unknown"}): ${printable}`);
  }
}

function isPythonUsable(pythonBin) {
  const probe = spawnSync(pythonBin, ["-V"], {
    cwd: ROOT,
    stdio: "ignore",
  });
  return probe.status === 0;
}

function ensureVenv(service) {
  const venvName = service.venv;
  const venvRoot = path.join(VENV_DIR, venvName);
  const pyPath = pythonPathFor(venvName);

  if (fs.existsSync(pyPath) && !isPythonUsable(pyPath)) {
    console.warn(`Rebuilding unusable venv "${venvName}"...`);
    fs.rmSync(venvRoot, { recursive: true, force: true });
  }

  if (!fs.existsSync(pyPath)) {
    runCommand(PYTHON_BIN, ["-m", "venv", venvRoot]);
  }

  if (service.setupHook) {
    service.setupHook();
  }

  const reqHash = fileSha(service);
  const statePath = serviceStatePath(service.id);
  const currentHash = fs.existsSync(statePath) ? fs.readFileSync(statePath, "utf8").trim() : "";
  if (currentHash === reqHash) {
    runServiceFixups(service);
    return pyPath;
  }

  runCommand(pyPath, ["-m", "pip", "install", "--upgrade", "pip", "setuptools", "wheel"]);
  for (const reqPath of service.requirements) {
    runCommand(pyPath, ["-m", "pip", "install", "-r", reqPath]);
  }
  if (service.postInstallHook) {
    service.postInstallHook(pyPath);
  }

  fs.writeFileSync(statePath, `${reqHash}\n`, "utf8");
  runServiceFixups(service);
  return pyPath;
}

function readPid(serviceId) {
  const pidFile = servicePidPath(serviceId);
  if (!fs.existsSync(pidFile)) return null;
  const pidText = fs.readFileSync(pidFile, "utf8").trim();
  if (!pidText) return null;
  const pid = Number(pidText);
  return Number.isFinite(pid) ? pid : null;
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

function parsePidsFromText(text) {
  const pids = new Set();
  const lines = String(text || "").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const matches = trimmed.match(/\d+/g);
    if (!matches || matches.length === 0) continue;
    const pid = Number(matches[matches.length - 1]);
    if (Number.isFinite(pid) && pid > 0) {
      pids.add(pid);
    }
  }
  return [...pids];
}

function listListeningPidsOnPort(port) {
  const numericPort = Number(port);
  if (!Number.isFinite(numericPort) || numericPort <= 0) return [];

  if (process.platform === "win32") {
    const ps = spawnSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-Command",
        `Get-NetTCPConnection -LocalPort ${numericPort} -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique`,
      ],
      { cwd: ROOT, encoding: "utf8" }
    );
    if (ps.status === 0 && ps.stdout?.trim()) {
      return parsePidsFromText(ps.stdout);
    }

    const netstat = spawnSync(
      "cmd.exe",
      ["/d", "/s", "/c", `netstat -ano -p tcp | findstr /R /C:\":${numericPort} .*LISTENING\"`],
      { cwd: ROOT, encoding: "utf8" }
    );
    if (netstat.status === 0 && netstat.stdout?.trim()) {
      return parsePidsFromText(netstat.stdout);
    }
    return [];
  }

  const lsof = spawnSync("sh", ["-lc", `lsof -tiTCP:${numericPort} -sTCP:LISTEN 2>/dev/null`], {
    cwd: ROOT,
    encoding: "utf8",
  });
  if (lsof.status === 0 && lsof.stdout?.trim()) {
    return parsePidsFromText(lsof.stdout);
  }
  return [];
}

function terminatePid(pid, label) {
  if (!pid || !isPidAlive(pid)) return;
  if (label) {
    console.log(`Stopping ${label} (PID ${pid})...`);
  }

  try {
    process.kill(pid, "SIGTERM");
  } catch {
    // ignore
  }

  const start = Date.now();
  while (Date.now() - start < 10000) {
    if (!isPidAlive(pid)) break;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 200);
  }

  if (isPidAlive(pid)) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // ignore
    }
  }
}

function stopPortListeners(service, exceptPid = null) {
  if (!service.port) return;
  const listeners = listListeningPidsOnPort(service.port).filter((pid) => !exceptPid || pid !== exceptPid);
  for (const pid of listeners) {
    terminatePid(pid, `${service.name} port ${service.port}`);
  }
}

function stopService(service) {
  const pid = readPid(service.id);
  if (!pid) {
    stopPortListeners(service);
    return;
  }

  if (!isPidAlive(pid)) {
    fs.rmSync(servicePidPath(service.id), { force: true });
    stopPortListeners(service);
    return;
  }

  terminatePid(pid, service.name);
  fs.rmSync(servicePidPath(service.id), { force: true });
  stopPortListeners(service, pid);
}

function startService(service, gpuMode) {
  const desiredFingerprint = fileSha(service);
  const statePath = serviceStatePath(service.id);
  const currentFingerprint = fs.existsSync(statePath) ? fs.readFileSync(statePath, "utf8").trim() : "";
  const serviceStale = desiredFingerprint !== currentFingerprint;
  const existingPid = readPid(service.id);
  const existingAlive = existingPid && isPidAlive(existingPid);

  stopPortListeners(service, existingAlive ? existingPid : null);

  if (existingAlive) {
    if (service.port) {
      const listeners = listListeningPidsOnPort(service.port);
      if (listeners.includes(existingPid)) {
        if (serviceStale) {
          terminatePid(existingPid, `${service.name} source updated`);
          fs.rmSync(servicePidPath(service.id), { force: true });
          stopPortListeners(service, existingPid);
        } else {
          console.log(`${service.name} already running (PID ${existingPid}).`);
          return;
        }
      } else {
        terminatePid(existingPid, `${service.name} stale process`);
        fs.rmSync(servicePidPath(service.id), { force: true });
      }
    } else {
      console.log(`${service.name} already running (PID ${existingPid}).`);
      return;
    }
  }

  stopPortListeners(service);

  const pyPath = ensureVenv(service);
  const [cmd, ...args] = service.command(pyPath);
  const logFile = serviceLogPath(service.id);
  const outFd = fs.openSync(logFile, "a");

  const child = spawn(cmd, args, {
    cwd: ROOT,
    env: {
      ...process.env,
      PATH: `${path.dirname(pyPath)}${path.delimiter}${process.env.PATH || ""}`,
      ...(service.env ? service.env(gpuMode) : {}),
    },
    detached: true,
    windowsHide: true,
    stdio: ["ignore", outFd, outFd],
  });

  child.unref();
  fs.closeSync(outFd);
  fs.writeFileSync(servicePidPath(service.id), `${child.pid}\n`, "utf8");
  console.log(`Started ${service.name} (PID ${child.pid}) -> ${logFile}`);
}

function resolveSwitchTarget(rawEngine) {
  const normalized = (rawEngine || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z_]/g, "_")
    .replace(/__+/g, "_");
  const serviceId = ENGINE_TO_SERVICE_ID[normalized];
  if (!serviceId) {
    throw new Error(
      `Invalid engine "${rawEngine}". Expected one of: GEM, KOKORO.`
    );
  }
  const service = SERVICES.find((item) => item.id === serviceId);
  if (!service) {
    throw new Error(`No service mapping found for engine "${rawEngine}".`);
  }
  return { normalized, service };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getJson(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: ctrl.signal,
    });
    const text = await response.text();
    let payload;
    try {
      payload = text ? JSON.parse(text) : null;
    } catch {
      payload = text;
    }
    if (!response.ok) {
      const detail = typeof payload === "string" ? payload : JSON.stringify(payload);
      throw new Error(`HTTP ${response.status}: ${detail}`);
    }
    return payload;
  } finally {
    clearTimeout(timer);
  }
}

async function runCheck(check) {
  const started = Date.now();
  let attempts = 0;
  let lastError = "No response";

  while (Date.now() - started < check.timeoutMs) {
    attempts += 1;
    try {
      const payload = await getJson(check.url);
      if (check.validate(payload)) {
        return {
          service: check.name,
          status: "PASS",
          attempts,
          elapsedSec: ((Date.now() - started) / 1000).toFixed(1),
          detail: "ok",
        };
      }
      lastError = "Validation failed";
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }

    const elapsed = Date.now() - started;
    const remaining = check.timeoutMs - elapsed;
    if (remaining <= 0) break;
    console.log(
      `[wait] ${check.name} attempt ${attempts} failed (${lastError}). Retrying in ${Math.round(
        RETRY_INTERVAL_MS / 1000
      )}s...`
    );
    await sleep(Math.min(RETRY_INTERVAL_MS, remaining));
  }

  return {
    service: check.name,
    status: "FAIL",
    attempts,
    elapsedSec: ((Date.now() - started) / 1000).toFixed(1),
    detail: lastError,
  };
}

async function runChecks() {
  console.log("\nRunning endpoint validation...");
  const results = await Promise.all(
    CHECKS.map(async (check) => {
      const result = await runCheck(check);
      if (result.status === "FAIL") {
        if (check.optional) {
          result.status = "WARN";
          console.warn(`[warn] ${check.name}: ${result.detail}`);
        } else {
          console.error(`[fail] ${check.name}: ${result.detail}`);
        }
      } else {
        console.log(`[ok] ${check.name}`);
      }
      return result;
    })
  );
  console.table(results);
  if (results.some((item) => item.status === "FAIL")) {
    throw new Error("One or more endpoint checks failed.");
  }
}

async function main() {
  ensureDirs();

  if (GPU_MODE) {
    console.log("GPU mode enabled for local runtimes.");
  }

  if (COMMAND === "down") {
    for (const service of SERVICES.slice().reverse()) {
      stopService(service);
    }
    console.log("\nAll local services stopped.");
    return;
  }

  if (COMMAND === "switch") {
    const target = resolveSwitchTarget(COMMAND_ARG);
    startService(target.service, GPU_MODE);
    console.log(`\nEnsured TTS engine: ${target.normalized} (${target.service.name})`);
    return;
  }

  if (COMMAND === "restart") {
    if (COMMAND_ARG) {
      const target = resolveServiceTarget(COMMAND_ARG);
      if (!target) {
        throw new Error(`Unknown restart target "${COMMAND_ARG}". Use a service id or engine (GEM/KOKORO).`);
      }
      stopService(target);
      startService(target, GPU_MODE);
    } else {
      for (const service of SERVICES.slice().reverse()) {
        stopService(service);
      }
      for (const service of SERVICES) {
        startService(service, GPU_MODE);
      }
    }
    await runChecks();
    console.log("\nRestart completed and endpoint checks passed.");
    return;
  }

  if (COMMAND === "up") {
    for (const service of SERVICES) {
      startService(service, GPU_MODE);
    }
  }

  await runChecks();
  console.log("\nAll endpoint checks passed.");
}

main().catch((error) => {
  console.error(`\nBootstrap error: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
