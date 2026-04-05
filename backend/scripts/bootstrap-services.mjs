#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");
const ENV_FILES = [
  path.join(ROOT, ".env.local"),
  path.join(ROOT, "..", ".env.local"),
  path.join(ROOT, ".env"),
  path.join(ROOT, "..", ".env"),
];

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
    const existing = process.env[key];
    if (existing !== undefined && String(existing).trim() !== "") continue;

    const rawValue = normalized.slice(equalsIndex + 1);
    process.env[key] = parseEnvValue(rawValue);
  }
}

// Ensure local service launches pick up secrets and runtime config from
// backend/.env.local and root/.env.local first, then .env fallbacks.
for (const envPath of ENV_FILES) {
  loadDotEnv(envPath);
}

const DEFAULT_PYTHON_BIN = process.platform === "win32" ? "python" : "python3";
const GLOBAL_PYTHON_BIN = process.env.VF_PYTHON_BIN || DEFAULT_PYTHON_BIN;
const VENV_DIR = path.join(ROOT, ".venvs");
const RUNTIME_DIR = path.join(ROOT, ".runtime");
const PID_DIR = path.join(RUNTIME_DIR, "pids");
const LOG_DIR = path.join(RUNTIME_DIR, "logs");
const STATE_DIR = path.join(RUNTIME_DIR, "state");
const LAUNCHER_DIR = path.join(RUNTIME_DIR, "launchers");

const VALID_CONCURRENCY_PROFILES = new Set(["balanced", "max", "cool"]);
const AUTO_TUNE_WORKERS = toBoolEnv(process.env.VF_AUTO_TUNE_WORKERS, true);
const CONCURRENCY_PROFILE = resolveConcurrencyProfile(process.env.VF_CONCURRENCY_PROFILE);
const LOGICAL_CPU_COUNT = resolveLogicalCpuCount();
const HOST_RESERVED_CPUS = clampInt(toIntEnv(process.env.VF_HOST_RESERVED_CPUS, 2), 0, Math.max(0, LOGICAL_CPU_COUNT - 1));
const USABLE_CPU_COUNT = Math.max(1, LOGICAL_CPU_COUNT - HOST_RESERVED_CPUS);
const AUTO_TUNED_CONCURRENCY = computeConcurrencyPlan(CONCURRENCY_PROFILE, USABLE_CPU_COUNT);
const RUNTIME_CONCURRENCY_ENV = AUTO_TUNE_WORKERS
  ? {
      VF_AUTO_TUNE_WORKERS: "1",
      VF_CONCURRENCY_PROFILE: CONCURRENCY_PROFILE,
      VF_HOST_RESERVED_CPUS: String(HOST_RESERVED_CPUS),
      VF_TTS_QUEUE_WORKER_COUNT: String(AUTO_TUNED_CONCURRENCY.queueWorkers),
      VF_TTS_ENGINE_CONCURRENCY_GEM: String(AUTO_TUNED_CONCURRENCY.gemConcurrency),
      GEMINI_BATCH_DEFAULT_PARALLEL: String(AUTO_TUNED_CONCURRENCY.gemBatchDefaultParallel),
      GEMINI_BATCH_MAX_PARALLEL: String(AUTO_TUNED_CONCURRENCY.gemBatchMaxParallel),
    }
  : {};

const RETRY_INTERVAL_MS = Number(process.env.VF_BOOTSTRAP_RETRY_INTERVAL_MS || 4000);
const REQUEST_TIMEOUT_MS = Number(process.env.VF_BOOTSTRAP_REQUEST_TIMEOUT_MS || 15000);
const DEFAULT_CHECK_TIMEOUT_MS = Number(process.env.VF_BOOTSTRAP_CHECK_TIMEOUT_MS || 60000);
const FAST_TIMEOUT_MS = Number(process.env.VF_BOOTSTRAP_TIMEOUT_FAST_MS || DEFAULT_CHECK_TIMEOUT_MS);
const STARTUP_HEALTH_RETRY_INTERVAL_MS = clampInt(
  toIntEnv(process.env.VF_STARTUP_HEALTH_RETRY_INTERVAL_MS, 1000),
  250,
  10000
);
const POST_START_VERIFY_TIMEOUT_MS = clampInt(
  toIntEnv(process.env.VF_POST_START_VERIFY_TIMEOUT_MS, 5000),
  1000,
  30000
);
const CHECK_WAIT_LOG_AFTER_MS = Math.max(0, toIntEnv(process.env.VF_CHECK_WAIT_LOG_AFTER_MS, 8000));
const STARTUP_PID_WAIT_TIMEOUT_MS = Math.max(1000, toIntEnv(process.env.VF_STARTUP_PID_WAIT_TIMEOUT_MS, 12000));
const STARTUP_PID_WAIT_POLL_MS = clampInt(toIntEnv(process.env.VF_STARTUP_PID_WAIT_POLL_MS, 250), 100, 2000);
const LOG_ROTATE_MAX_BYTES = Math.max(0, toIntEnv(process.env.VF_SERVICE_LOG_ROTATE_MAX_BYTES, 20 * 1024 * 1024));
const LOG_ROTATE_KEEP = clampInt(toIntEnv(process.env.VF_SERVICE_LOG_ROTATE_KEEP, 3), 0, 10);
const SERVICE_LOG_TAIL_LINES = clampInt(toIntEnv(process.env.VF_SERVICE_LOG_TAIL_LINES, 20), 0, 200);
const SERVICE_WINDOWS_VISIBLE = toBoolEnv(process.env.VF_SERVICE_WINDOWS_VISIBLE, true);
const DOCTOR_MAX_ATTEMPTS = clampInt(toIntEnv(process.env.VF_BOOTSTRAP_DOCTOR_MAX_ATTEMPTS, 2), 1, 5);
const serviceStartStates = new Map();
const pythonVersionCache = new Map();

function toIntEnv(raw, fallback) {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.trunc(parsed);
}

function toBoolEnv(raw, fallback) {
  const token = String(raw || "").trim().toLowerCase();
  if (!token) return fallback;
  if (["1", "true", "yes", "on"].includes(token)) return true;
  if (["0", "false", "no", "off"].includes(token)) return false;
  return fallback;
}

function clampInt(value, min, max) {
  return Math.max(min, Math.min(max, Math.trunc(value)));
}

function resolveLogicalCpuCount() {
  try {
    if (typeof os.availableParallelism === "function") {
      const value = Number(os.availableParallelism());
      if (Number.isFinite(value) && value > 0) return Math.trunc(value);
    }
  } catch {
    // ignore
  }
  const fallback = Number((os.cpus() || []).length);
  if (Number.isFinite(fallback) && fallback > 0) return Math.trunc(fallback);
  return 1;
}

function resolveConcurrencyProfile(rawValue) {
  const token = String(rawValue || "cool").trim().toLowerCase();
  if (VALID_CONCURRENCY_PROFILES.has(token)) return token;
  return "cool";
}

function computeConcurrencyPlan(profile, usableCpu) {
  const safeUsableCpu = Math.max(1, Math.trunc(usableCpu || 1));
  if (profile === "max") {
    const queueWorkers = clampInt(safeUsableCpu + 1, 4, 12);
    const gemConcurrency = clampInt(queueWorkers + 6, 6, 24);
    const gemBatchDefaultParallel = clampInt(Math.round(gemConcurrency / 3), 2, 8);
    const gemBatchMaxParallel = clampInt(gemBatchDefaultParallel + 3, gemBatchDefaultParallel, 12);
    return {
      queueWorkers,
      gemConcurrency,
      gemBatchDefaultParallel,
      gemBatchMaxParallel,
    };
  }

  if (profile === "cool") {
    const queueWorkers = clampInt(Math.floor((safeUsableCpu + 1) / 2), 1, 4);
    const gemConcurrency = clampInt(queueWorkers + 2, 3, 8);
    const gemBatchDefaultParallel = clampInt(Math.round(gemConcurrency / 3), 1, 3);
    const gemBatchMaxParallel = clampInt(gemBatchDefaultParallel + 1, gemBatchDefaultParallel, 4);
    return {
      queueWorkers,
      gemConcurrency,
      gemBatchDefaultParallel,
      gemBatchMaxParallel,
    };
  }

  // balanced profile
  const queueWorkers = clampInt(safeUsableCpu, 2, 8);
  const gemConcurrency = clampInt(queueWorkers + 4, 4, 16);
  const gemBatchDefaultParallel = clampInt(Math.round(gemConcurrency / 3), 2, 6);
  const gemBatchMaxParallel = clampInt(gemBatchDefaultParallel + 2, gemBatchDefaultParallel, 8);
  return {
    queueWorkers,
    gemConcurrency,
    gemBatchDefaultParallel,
    gemBatchMaxParallel,
  };
}

const argv = process.argv.slice(2);
const POSITIONAL_ARGS = argv.filter((arg) => !arg.startsWith("-"));
const COMMAND = (POSITIONAL_ARGS[0] || "up").toLowerCase();
const COMMAND_ARG = POSITIONAL_ARGS[1] || "";
const GPU_MODE = argv.includes("--gpu");
const REPAIR_MODE = argv.includes("--repair");
const VALID_COMMANDS = new Set(["up", "check", "down", "switch", "restart", "doctor"]);

if (!VALID_COMMANDS.has(COMMAND)) {
  console.error(`Unknown command "${COMMAND}". Use one of: up, check, down, switch, restart, doctor.`);
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
const serviceLauncherPidPath = (id) => path.join(PID_DIR, `${id}.launcher.pid`);
const serviceLogPath = (id) => path.join(LOG_DIR, `${id}.log`);
const serviceStatePath = (id) => path.join(STATE_DIR, `${id}.sha256`);
const serviceInstallStatePath = (id) => path.join(STATE_DIR, `${id}.install.sha256`);
const serviceLauncherPath = (id) => path.join(LAUNCHER_DIR, `${id}.ps1`);
const serviceLauncherCmdPath = (id) => path.join(LAUNCHER_DIR, `${id}.cmd`);

const BASE_SERVICES = [
  {
    id: "media-backend",
    name: "Media Backend",
    port: 7800,
    venv: "media-backend",
    pythonEnvVar: "VF_PYTHON_BIN_MEDIA_BACKEND",
    requirements: ["requirements.txt"],
    sourceFiles: ["app.py", "scripts/bootstrap-services.mjs"],
    command: (pythonBin) => [
      pythonBin,
      "-m",
      "uvicorn",
      "app:app",
      "--app-dir",
      ".",
      "--host",
      "127.0.0.1",
      "--port",
      "7800",
    ],
    env: (gpu) => ({
      VF_BACKEND_HOST: "127.0.0.1",
      VF_BACKEND_PORT: "7800",
      VF_TTS_RUNTIME_URL: "http://127.0.0.1:7810",
      VF_VERTEX_TEXT_RUNTIME_URL: "http://127.0.0.1:7820",
      VF_WHISPER_DEVICE: "cpu",
      VF_WHISPER_COMPUTE: "int8",
      CUDA_VISIBLE_DEVICES: "",
      ...RUNTIME_CONCURRENCY_ENV,
    }),
  },
  {
    id: "gemini-runtime",
    name: "Gemini Runtime",
    port: 7810,
    venv: "gemini-runtime",
    pythonEnvVar: "VF_PYTHON_BIN_GEMINI_RUNTIME",
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
    env: () => ({
      VF_RUNTIME_NAME: "tts-runtime",
      VF_RUNTIME_ROLE: "tts_only",
      VF_TTS_TEXTTOSPEECH_ONLY: "1",
      CUDA_VISIBLE_DEVICES: "",
      ...RUNTIME_CONCURRENCY_ENV,
    }),
  },
  {
    id: "vertex-text-runtime",
    name: "Vertex Text Runtime",
    port: 7820,
    venv: "vertex-text-runtime",
    pythonEnvVar: "VF_PYTHON_BIN_VERTEX_TEXT_RUNTIME",
    requirements: ["engines/vertex-text-runtime/requirements.txt"],
    sourceFiles: [
      "engines/vertex-text-runtime/app.py",
      "engines/gemini-runtime/app.py",
      "scripts/bootstrap-services.mjs",
    ],
    command: (pythonBin) => [
      pythonBin,
      "-m",
      "uvicorn",
      "app:app",
      "--app-dir",
      "engines/vertex-text-runtime",
      "--host",
      "127.0.0.1",
      "--port",
      "7820",
    ],
    env: () => ({
      VF_RUNTIME_NAME: "vertex-text-runtime",
      VF_RUNTIME_ROLE: "text_only",
      VF_RUNTIME_FORCE_AUTH_MODE: "vertex",
      CUDA_VISIBLE_DEVICES: "",
      ...RUNTIME_CONCURRENCY_ENV,
    }),
  },
];

const SERVICES = BASE_SERVICES;

const ENGINE_TO_SERVICE_ID = {
  PRIME: "gemini-runtime",
  GEMINI: "gemini-runtime",
  VECTOR: "gemini-runtime",
  NEURAL_2: "gemini-runtime",
  NURAL2: "gemini-runtime",
  NURAL_2: "gemini-runtime",
};

const BASE_CHECKS = [
  {
    serviceId: "media-backend",
    name: "Media Backend",
    url: "http://127.0.0.1:7800/health",
    timeoutMs: FAST_TIMEOUT_MS,
    validate: (payload) => typeof payload === "object" && payload !== null && typeof payload.ok === "boolean",
  },
  {
    serviceId: "gemini-runtime",
    name: "Gemini Runtime",
    url: "http://127.0.0.1:7810/health",
    timeoutMs: FAST_TIMEOUT_MS,
    validate: (payload) => typeof payload === "object" && payload !== null && payload.ok === true,
  },
  {
    serviceId: "vertex-text-runtime",
    name: "Vertex Text Runtime",
    url: "http://127.0.0.1:7820/health",
    timeoutMs: FAST_TIMEOUT_MS,
    validate: (payload) => typeof payload === "object" && payload !== null && payload.ok === true,
  },
];

const CHECKS = BASE_CHECKS;

function ensureDirs() {
  fs.mkdirSync(VENV_DIR, { recursive: true });
  fs.mkdirSync(PID_DIR, { recursive: true });
  fs.mkdirSync(LOG_DIR, { recursive: true });
  fs.mkdirSync(STATE_DIR, { recursive: true });
  fs.mkdirSync(LAUNCHER_DIR, { recursive: true });
}

function sha256(content) {
  return crypto.createHash("sha256").update(content).digest("hex");
}

function resolveServicePythonBin(service) {
  const byService = service?.pythonEnvVar ? String(process.env[service.pythonEnvVar] || "").trim() : "";
  if (byService) return byService;
  const byGlobal = String(process.env.VF_PYTHON_BIN || "").trim();
  if (byGlobal) return byGlobal;
  return GLOBAL_PYTHON_BIN;
}

function getPythonVersionTuple(pythonBin) {
  const cacheKey = String(pythonBin || "").trim();
  if (cacheKey && pythonVersionCache.has(cacheKey)) {
    return pythonVersionCache.get(cacheKey);
  }
  const probe = spawnSync(
    pythonBin,
    ["-c", "import sys; print(f'{sys.version_info[0]}.{sys.version_info[1]}.{sys.version_info[2]}')"],
    { cwd: ROOT, encoding: "utf8" }
  );
  if (probe.status !== 0) {
    throw new Error(`Python binary is not usable: ${pythonBin}`);
  }
  const token = String(probe.stdout || "").trim();
  const [major, minor, patch] = token.split(".").map((item) => Number(item));
  if (![major, minor, patch].every((item) => Number.isFinite(item))) {
    throw new Error(`Failed to parse Python version from ${pythonBin}: ${token || "<empty>"}`);
  }
  const result = { major, minor, patch, token };
  if (cacheKey) {
    pythonVersionCache.set(cacheKey, result);
  }
  return result;
}

function ensureServicePythonVersion(service, pythonBin) {
  if (!service?.requiredPython) return;
  const current = getPythonVersionTuple(pythonBin);
  const required = service.requiredPython;
  const expected = `${required.major}.${required.minor}.x`;
  if (current.major !== required.major || current.minor !== required.minor) {
    throw new Error(
      `${service.name} requires Python ${expected} but resolved ${pythonBin} -> ${current.token}. ` +
      `Set ${service.pythonEnvVar || "VF_PYTHON_BIN"} to a compatible interpreter.`
    );
  }
}

function fileSha(service, pythonBin, options = {}) {
  const excludeBootstrapFile = options.excludeBootstrapFile === true;
  const sourceFileSource = (service.sourceFiles || [])
    .filter((sourcePath) => !(excludeBootstrapFile && sourcePath === "scripts/bootstrap-services.mjs"))
    .map((sourcePath) => {
      const abs = path.join(ROOT, sourcePath);
      if (!fs.existsSync(abs)) {
        return `# ${sourcePath}\n<missing>`;
      }
      return `# ${sourcePath}\n${fs.readFileSync(abs, "utf8")}`;
    })
    .join("\n\n");
  if (service.runtime === "node") {
    return sha256(`${process.execPath}\n${process.version}\n${sourceFileSource}`);
  }
  const requirementSource = service.requirements
    .map((reqPath) => {
      const abs = path.join(ROOT, reqPath);
      if (!fs.existsSync(abs)) {
        throw new Error(`Missing requirements file: ${reqPath}`);
      }
      return `# ${reqPath}\n${fs.readFileSync(abs, "utf8")}`;
    })
    .join("\n\n");
  const pyVersion = getPythonVersionTuple(pythonBin).token;
  return sha256(`${pythonBin}\n${pyVersion}\n${requirementSource}\n\n${sourceFileSource}`);
}

function installSha(service, pythonBin) {
  return fileSha(service, pythonBin, { excludeBootstrapFile: true });
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

function resolveEffectiveGpuMode(service, requestedGpuMode) {
  void service;
  void requestedGpuMode;
  return false;
}

function runServiceFixups(_service) {}

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
    stdio: "inherit",
  });
  return probe.status === 0;
}

function writePipFreeze(pyPath, serviceId) {
  const freeze = spawnSync(pyPath, ["-m", "pip", "freeze"], {
    cwd: ROOT,
    encoding: "utf8",
  });
  if (freeze.status !== 0) {
    return;
  }
  const freezePath = path.join(STATE_DIR, `${serviceId}.pip-freeze.txt`);
  fs.writeFileSync(freezePath, String(freeze.stdout || ""), "utf8");
}

function ensureVenv(service, servicePythonBin, desiredHash) {
  const venvName = service.venv;
  const venvRoot = path.join(VENV_DIR, venvName);
  const pyPath = pythonPathFor(venvName);

  if (fs.existsSync(pyPath) && !isPythonUsable(pyPath)) {
    console.warn(`Rebuilding unusable venv "${venvName}"...`);
    fs.rmSync(venvRoot, { recursive: true, force: true });
  }

  if (!fs.existsSync(pyPath)) {
    runCommand(servicePythonBin, ["-m", "venv", venvRoot]);
  }

  if (service.setupHook) {
    service.setupHook();
  }

  const reqHash = desiredHash || installSha(service, servicePythonBin);
  const statePath = serviceInstallStatePath(service.id);
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
  writePipFreeze(pyPath, service.id);
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

function readLauncherPid(serviceId) {
  const pidFile = serviceLauncherPidPath(serviceId);
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
    const netstat = spawnSync(
      "cmd.exe",
      ["/d", "/s", "/c", `netstat -ano -p tcp | findstr /R /C:\":${numericPort} .*LISTENING\"`],
      { cwd: ROOT, encoding: "utf8" }
    );
    if (netstat.status === 0 && netstat.stdout?.trim()) {
      return parsePidsFromText(netstat.stdout);
    }

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

function waitForListeningPid(service, timeoutMs = STARTUP_PID_WAIT_TIMEOUT_MS, pollMs = STARTUP_PID_WAIT_POLL_MS) {
  if (!service?.port) return null;
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const listeners = listListeningPidsOnPort(service.port);
    if (listeners.length > 0) return listeners[0];
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, pollMs);
  }
  return null;
}

function rotateServiceLog(logFile) {
  if (LOG_ROTATE_KEEP <= 0 || LOG_ROTATE_MAX_BYTES <= 0) return;
  if (!fs.existsSync(logFile)) return;
  const logSize = fs.statSync(logFile).size;
  if (!Number.isFinite(logSize) || logSize < LOG_ROTATE_MAX_BYTES) return;

  const oldest = `${logFile}.${LOG_ROTATE_KEEP}`;
  fs.rmSync(oldest, { force: true });
  for (let index = LOG_ROTATE_KEEP - 1; index >= 1; index -= 1) {
    const src = `${logFile}.${index}`;
    const dst = `${logFile}.${index + 1}`;
    if (!fs.existsSync(src)) continue;
    fs.rmSync(dst, { force: true });
    fs.renameSync(src, dst);
  }
  fs.renameSync(logFile, `${logFile}.1`);
  console.log(`Rotated log file: ${path.relative(ROOT, logFile)}`);
}

function printServiceLogTail(serviceId, serviceName) {
  if (SERVICE_LOG_TAIL_LINES <= 0) return;
  const logFile = serviceLogPath(serviceId);
  if (!fs.existsSync(logFile)) return;
  const text = fs.readFileSync(logFile, "utf8");
  const lines = String(text || "").split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length === 0) return;
  const tail = lines.slice(-SERVICE_LOG_TAIL_LINES);
  console.log(`\n[${serviceName}] recent log lines (${tail.length}):`);
  for (const line of tail) {
    console.log(line);
  }
}

function toPowerShellSingleQuoted(value) {
  return `'${String(value || "").replace(/'/g, "''")}'`;
}

function toCmdDoubleQuoted(value) {
  return `"${String(value || "").replace(/"/g, '""')}"`;
}

function buildVisibleWindowsServiceScript(service, cmd, args, logFile) {
  const title = `V FLOW AI - ${service.name}`;
  const serializedArgs = args.map((arg) => toPowerShellSingleQuoted(arg)).join(", ");
  return [
    "$ErrorActionPreference = 'Continue'",
    "$ProgressPreference = 'SilentlyContinue'",
    `$Host.UI.RawUI.WindowTitle = ${toPowerShellSingleQuoted(title)}`,
    `Set-Location -LiteralPath ${toPowerShellSingleQuoted(ROOT)}`,
    `$cmd = ${toPowerShellSingleQuoted(cmd)}`,
    `$argList = @(${serializedArgs})`,
    `& $cmd @argList *>&1 | Tee-Object -FilePath ${toPowerShellSingleQuoted(logFile)} -Append`,
    "$exitCode = if ($LASTEXITCODE -is [int]) { $LASTEXITCODE } else { 0 }",
    "if ($exitCode -ne 0) {",
    "  Write-Host ''",
    "  Write-Host \"[V FLOW AI] Process exited with code $exitCode\" -ForegroundColor Red",
    "  Read-Host 'Press Enter to close this window' | Out-Null",
    "}",
    "exit $exitCode",
  ].join("\r\n");
}

function writeVisibleWindowsServiceLauncher(service, cmd, args, logFile) {
  const launcherPath = serviceLauncherPath(service.id);
  const wrapperPath = serviceLauncherCmdPath(service.id);
  fs.writeFileSync(launcherPath, buildVisibleWindowsServiceScript(service, cmd, args, logFile), "utf8");
  fs.writeFileSync(
    wrapperPath,
    [
      "@echo off",
      `title V FLOW AI - ${service.name}`,
      `cd /d ${toCmdDoubleQuoted(ROOT)}`,
      `powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File ${toCmdDoubleQuoted(launcherPath)}`,
      "exit /b %ERRORLEVEL%",
      "",
    ].join("\r\n"),
    "utf8"
  );
  return wrapperPath;
}

function spawnVisibleWindowsService(service, cmd, args, env, logFile) {
  const wrapperPath = writeVisibleWindowsServiceLauncher(service, cmd, args, logFile);
  return spawn("cmd.exe", ["/d", "/c", path.basename(wrapperPath)], {
    cwd: LAUNCHER_DIR,
    env,
    detached: true,
    windowsHide: false,
    stdio: "ignore",
  });
}

function terminatePid(pid, label) {
  if (!pid || !isPidAlive(pid)) return;
  if (label) {
    console.log(`Stopping ${label} (PID ${pid})...`);
  }

  if (process.platform === "win32") {
    spawnSync("taskkill.exe", ["/PID", String(pid), "/T", "/F"], {
      cwd: ROOT,
      stdio: "ignore",
    });
    const start = Date.now();
    while (Date.now() - start < 2000) {
      if (!isPidAlive(pid)) break;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
    }
    return;
  }

  try {
    process.kill(pid, "SIGTERM");
  } catch {
    // ignore
  }

  const start = Date.now();
  while (Date.now() - start < 3000) {
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
  const launcherPid = readLauncherPid(service.id);
  if (launcherPid) {
    if (isPidAlive(launcherPid)) {
      terminatePid(launcherPid, `${service.name} window`);
    }
    fs.rmSync(serviceLauncherPidPath(service.id), { force: true });
  }

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

function startService(service, gpuMode, options = {}) {
  const printLogTail = options.printLogTail !== false;
  const effectiveGpuMode = resolveEffectiveGpuMode(service, gpuMode);
  const servicePythonBin = service.runtime === "node" ? null : resolveServicePythonBin(service);
  if (service.runtime !== "node") {
    ensureServicePythonVersion(service, servicePythonBin);
  }
  const desiredFingerprint = fileSha(service, servicePythonBin);
  const desiredInstallFingerprint =
    service.runtime === "node" ? desiredFingerprint : installSha(service, servicePythonBin);
  const statePath = serviceStatePath(service.id);
  const currentFingerprint = fs.existsSync(statePath) ? fs.readFileSync(statePath, "utf8").trim() : "";
  const serviceStale = desiredFingerprint !== currentFingerprint;
  const trackedLauncherPid = readLauncherPid(service.id);
  const trackedLauncherAlive = trackedLauncherPid && isPidAlive(trackedLauncherPid);
  const trackedPid = readPid(service.id);
  const trackedAlive = trackedPid && isPidAlive(trackedPid);
  const listeningPids = service.port ? listListeningPidsOnPort(service.port) : [];
  const listeningPid = listeningPids[0] || null;

  if (!serviceStale && listeningPid) {
    if (trackedPid !== listeningPid) {
      fs.writeFileSync(servicePidPath(service.id), `${listeningPid}\n`, "utf8");
      serviceStartStates.set(service.id, "adopted");
      console.log(`${service.name} PID reconciled to listener PID ${listeningPid}.`);
    } else {
      serviceStartStates.set(service.id, "running");
    }
    console.log(`${service.name} already running (PID ${listeningPid}).`);
    return;
  }

  if (!serviceStale && !service.port && trackedAlive) {
    serviceStartStates.set(service.id, "running");
    console.log(`${service.name} already running (PID ${trackedPid}).`);
    return;
  }

  if (trackedAlive) {
    terminatePid(
      trackedPid,
      serviceStale ? `${service.name} source updated` : `${service.name} stale process`
    );
  }
  if (trackedLauncherAlive) {
    terminatePid(
      trackedLauncherPid,
      serviceStale ? `${service.name} source updated window` : `${service.name} stale window`
    );
  }
  fs.rmSync(servicePidPath(service.id), { force: true });
  fs.rmSync(serviceLauncherPidPath(service.id), { force: true });
  stopPortListeners(service);

  let runtimeBinDir = "";
  let runtimePath = null;
  if (service.runtime === "node") {
    runtimeBinDir = path.dirname(process.execPath);
    console.log(`${service.name} runtime: node=${process.execPath} version=${process.version}`);
  } else {
    const pyPath = ensureVenv(service, servicePythonBin, desiredInstallFingerprint);
    const pyVersion = getPythonVersionTuple(pyPath).token;
    runtimeBinDir = path.dirname(pyPath);
    runtimePath = pyPath;
    console.log(
      `${service.name} runtime: venv=${path.join(VENV_DIR, service.venv)} interpreter=${servicePythonBin} python=${pyVersion}`
    );
  }
  const [cmd, ...args] = service.command(runtimePath);
  const logFile = serviceLogPath(service.id);
  rotateServiceLog(logFile);
  const childEnv = {
    ...process.env,
    PATH: `${runtimeBinDir}${path.delimiter}${process.env.PATH || ""}`,
    ...(service.env ? service.env(effectiveGpuMode) : {}),
  };

  let child;
  if (process.platform === "win32" && SERVICE_WINDOWS_VISIBLE) {
    child = spawnVisibleWindowsService(service, cmd, args, childEnv, logFile);
    fs.writeFileSync(serviceLauncherPidPath(service.id), `${child.pid}\n`, "utf8");
  } else {
    const outFd = fs.openSync(logFile, "a");
    child = spawn(cmd, args, {
      cwd: ROOT,
      env: childEnv,
      detached: true,
      windowsHide: !SERVICE_WINDOWS_VISIBLE,
      stdio: ["ignore", outFd, outFd],
    });
    fs.closeSync(outFd);
    fs.rmSync(serviceLauncherPidPath(service.id), { force: true });
  }

  child.unref();
  const resolvedListeningPid = waitForListeningPid(service);
  const stablePid = resolvedListeningPid || child.pid;
  fs.writeFileSync(servicePidPath(service.id), `${stablePid}\n`, "utf8");
  fs.writeFileSync(statePath, `${desiredFingerprint}\n`, "utf8");
  serviceStartStates.set(service.id, "restarted");
  if (resolvedListeningPid && resolvedListeningPid !== child.pid) {
    console.log(
      `Started ${service.name} (launcher PID ${child.pid}, listener PID ${resolvedListeningPid}) -> ${logFile}`
    );
    if (printLogTail) {
      printServiceLogTail(service.id, service.name);
    }
    return;
  }
  console.log(`Started ${service.name} (PID ${stablePid}) -> ${logFile}`);
  if (printLogTail) {
    printServiceLogTail(service.id, service.name);
  }
}

function resolveSwitchTarget(rawEngine) {
  const normalized = (rawEngine || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_]/g, "_")
    .replace(/__+/g, "_");
  const serviceId = ENGINE_TO_SERVICE_ID[normalized];
  if (!serviceId) {
    throw new Error(
      `Invalid engine "${rawEngine}". Expected one of: PRIME or VECTOR.`
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

function getCheckForService(serviceOrId) {
  const serviceId =
    typeof serviceOrId === "string" ? String(serviceOrId).trim() : String(serviceOrId?.id || "").trim();
  if (!serviceId) return null;
  return CHECKS.find((check) => String(check.serviceId || "").trim() === serviceId) || null;
}

function describeCheckError(error) {
  if (!(error instanceof Error)) return String(error);
  const parts = [];
  const cause = error.cause;
  if (cause && typeof cause === "object") {
    const code = typeof cause.code === "string" ? cause.code.trim() : "";
    const address = typeof cause.address === "string" ? cause.address.trim() : "";
    const port = Number.isFinite(cause.port) ? String(cause.port) : "";
    if (code) parts.push(code);
    if (address && port) parts.push(`${address}:${port}`);
    else if (address) parts.push(address);
    else if (port) parts.push(port);
  }
  if (parts.length === 0) return error.message;
  return `${error.message} (${parts.join(" ")})`;
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

async function runCheck(check, options = {}) {
  const timeoutMs = Math.max(250, toIntEnv(options.timeoutMs, check.timeoutMs));
  const retryIntervalMs = Math.max(100, toIntEnv(options.retryIntervalMs, RETRY_INTERVAL_MS));
  const logRetries = options.logRetries !== false;
  const quietStartMs = Math.max(0, toIntEnv(options.quietStartMs, CHECK_WAIT_LOG_AFTER_MS));
  const started = Date.now();
  let attempts = 0;
  let lastError = "No response";

  while (Date.now() - started < timeoutMs) {
    attempts += 1;
    try {
      const payload = await getJson(check.url);
      if (check.validate(payload)) {
        return {
          serviceId: check.serviceId || "",
          service: check.name,
          status: "PASS",
          attempts,
          elapsedSec: ((Date.now() - started) / 1000).toFixed(1),
          detail: "ok",
        };
      }
      lastError = "Validation failed";
    } catch (error) {
      lastError = describeCheckError(error);
    }

    const elapsed = Date.now() - started;
    const remaining = timeoutMs - elapsed;
    if (remaining <= 0) break;
    if (logRetries && elapsed >= quietStartMs) {
      console.log(
        `[wait] ${check.name} attempt ${attempts} failed (${lastError}). Retrying in ${Math.round(
          retryIntervalMs / 1000
        )}s...`
      );
    }
    await sleep(Math.min(retryIntervalMs, remaining));
  }

  return {
    serviceId: check.serviceId || "",
    service: check.name,
    status: "FAIL",
    attempts,
    elapsedSec: ((Date.now() - started) / 1000).toFixed(1),
    detail: lastError,
  };
}

async function warmStartedServices(services, options = {}) {
  const checks = services
    .map((service) => ({ service, check: getCheckForService(service) }))
    .filter((entry) => entry.check);

  if (checks.length === 0) return [];
  if (options.announce !== false) {
    console.log("\nWaiting for runtime health...");
  }

  const results = await Promise.all(
    checks.map(async ({ service, check }) => {
      const result = await runCheck(check, {
        timeoutMs: options.timeoutMs ?? check.timeoutMs,
        retryIntervalMs: options.retryIntervalMs ?? STARTUP_HEALTH_RETRY_INTERVAL_MS,
        logRetries: options.logRetries ?? false,
        quietStartMs: options.quietStartMs ?? Number.MAX_SAFE_INTEGER,
      });
      if (options.logReady !== false) {
        if (result.status === "PASS") {
          console.log(`[ready] ${service.name}`);
        } else {
          console.warn(`[warmup] ${service.name}: ${result.detail}`);
        }
      }
      return result;
    })
  );

  return results;
}

async function runChecks(options = {}) {
  const failOnError = options.failOnError !== false;
  const timeoutMs = Number.isFinite(Number(options.timeoutMs)) ? Number(options.timeoutMs) : undefined;
  const retryIntervalMs = Number.isFinite(Number(options.retryIntervalMs))
    ? Number(options.retryIntervalMs)
    : undefined;
  const logRetries = options.logRetries !== false;
  const quietStartMs = Number.isFinite(Number(options.quietStartMs)) ? Number(options.quietStartMs) : undefined;
  const announce = options.announce !== false;
  const onlyServiceIds = Array.isArray(options.onlyServiceIds) && options.onlyServiceIds.length > 0
    ? new Set(options.onlyServiceIds.map((value) => String(value || "").trim()).filter(Boolean))
    : null;
  const selectedChecks = onlyServiceIds
    ? CHECKS.filter((check) => onlyServiceIds.has(String(check.serviceId || "").trim()))
    : CHECKS;
  if (announce) {
    console.log("\nRunning endpoint validation...");
  }
  const endpointResults = await Promise.all(
    selectedChecks.map(async (check) => {
      const result = await runCheck(check, {
        timeoutMs,
        retryIntervalMs,
        logRetries,
        quietStartMs,
      });
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
  const results = [...endpointResults];
  console.table(results);
  if (failOnError && results.some((item) => item.status === "FAIL")) {
    throw new Error("One or more endpoint checks failed.");
  }
  return results;
}

function resolveFailedServices(results) {
  const failedServiceIds = new Set(
    results
      .filter((item) => item.status === "FAIL" && typeof item.serviceId === "string" && item.serviceId.trim())
      .map((item) => String(item.serviceId).trim())
  );
  return SERVICES.filter((service) => failedServiceIds.has(service.id));
}

async function runDoctor(gpuMode, maxAttempts = DOCTOR_MAX_ATTEMPTS) {
  for (const service of SERVICES) {
    startService(service, gpuMode, { printLogTail: false });
  }
  await warmStartedServices(SERVICES, {
    retryIntervalMs: STARTUP_HEALTH_RETRY_INTERVAL_MS,
    logRetries: false,
  });

  let lastResults = [];
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    console.log(`\n[doctor] Health validation attempt ${attempt}/${maxAttempts}`);
    const results = await runChecks({
      failOnError: false,
      timeoutMs: POST_START_VERIFY_TIMEOUT_MS,
      retryIntervalMs: STARTUP_HEALTH_RETRY_INTERVAL_MS,
      logRetries: false,
      quietStartMs: POST_START_VERIFY_TIMEOUT_MS,
    });
    lastResults = results;

    const failed = results.filter((item) => item.status === "FAIL");
    if (failed.length === 0) {
      printServiceStatusSummary();
      console.log("\nDoctor completed successfully.");
      return;
    }
    const assetFailure = failed.find((item) => String(item.serviceId || "") === "video-assets");
    if (assetFailure) {
      throw new Error(String(assetFailure.detail || "Video pipeline assets are missing."));
    }

    if (attempt >= maxAttempts) break;

    const failedServices = resolveFailedServices(results);
    if (failedServices.length === 0) {
      console.warn("[doctor] Failed checks could not be mapped to specific services. Restarting all services.");
      for (const service of SERVICES.slice().reverse()) {
        stopService(service);
      }
      for (const service of SERVICES) {
        startService(service, gpuMode, { printLogTail: false });
      }
      await warmStartedServices(SERVICES, {
        retryIntervalMs: STARTUP_HEALTH_RETRY_INTERVAL_MS,
        logRetries: false,
      });
      continue;
    }

    console.warn(`[doctor] Restarting unhealthy services: ${failedServices.map((service) => service.id).join(", ")}`);
    for (const service of failedServices) {
      stopService(service);
      startService(service, gpuMode, { printLogTail: false });
    }
    await warmStartedServices(failedServices, {
      retryIntervalMs: STARTUP_HEALTH_RETRY_INTERVAL_MS,
      logRetries: false,
    });
  }

  const failedLabels = lastResults
    .filter((item) => item.status === "FAIL")
    .map((item) => String(item.service || "unknown"))
    .join(", ");
  throw new Error(
    `Doctor failed after ${maxAttempts} attempt(s). Unhealthy services: ${failedLabels || "unknown"}.`
  );
}

function printServiceStatusSummary() {
  const rows = SERVICES.map((service) => {
    const trackedPid = readPid(service.id);
    const listeningPid = service.port ? listListeningPidsOnPort(service.port)[0] || null : trackedPid;
    let state = serviceStartStates.get(service.id);
    if (!state) {
      if (listeningPid) state = trackedPid && trackedPid !== listeningPid ? "adopted" : "running";
      else state = "missing";
    }
    return {
      service: service.id,
      port: service.port || "-",
      trackedPid: trackedPid || "-",
      listeningPid: listeningPid || "-",
      state,
      log: path.relative(ROOT, serviceLogPath(service.id)),
    };
  });
  console.log("\nService status summary:");
  console.table(rows);
}

async function main() {
  ensureDirs();
  serviceStartStates.clear();
  if (AUTO_TUNE_WORKERS) {
    console.log(
      `Concurrency autotune enabled: profile=${CONCURRENCY_PROFILE} logicalCpu=${LOGICAL_CPU_COUNT} reserved=${HOST_RESERVED_CPUS} usable=${USABLE_CPU_COUNT}`
    );
    console.log(
      `Autotune result: queueWorkers=${AUTO_TUNED_CONCURRENCY.queueWorkers} gemConcurrency=${AUTO_TUNED_CONCURRENCY.gemConcurrency} gemBatch=${AUTO_TUNED_CONCURRENCY.gemBatchDefaultParallel}/${AUTO_TUNED_CONCURRENCY.gemBatchMaxParallel}`
    );
  } else {
    console.log("Concurrency autotune disabled (VF_AUTO_TUNE_WORKERS=0).");
  }

  if (GPU_MODE) {
    console.log("GPU mode enabled for eligible local runtimes. Duno is backend-only and uses the Modal endpoint.");
  }

  if (COMMAND === "down") {
    for (const service of BASE_SERVICES.slice().reverse()) {
      stopService(service);
    }
    console.log("\nAll local services stopped.");
    return;
  }

  if (COMMAND === "switch") {
    const target = resolveSwitchTarget(COMMAND_ARG);
    startService(target.service, GPU_MODE, { printLogTail: false });
    await warmStartedServices([target.service], {
      retryIntervalMs: STARTUP_HEALTH_RETRY_INTERVAL_MS,
      logRetries: false,
      announce: false,
    });
    console.log(`\nEnsured TTS engine: ${target.normalized} (${target.service.name})`);
    return;
  }

  if (COMMAND === "doctor" || (COMMAND === "check" && REPAIR_MODE)) {
    await runDoctor(GPU_MODE, DOCTOR_MAX_ATTEMPTS);
    return;
  }

  if (COMMAND === "restart") {
    if (COMMAND_ARG) {
      const target = resolveServiceTarget(COMMAND_ARG);
      if (!target) {
        throw new Error(`Unknown restart target "${COMMAND_ARG}". Use a service id or engine (PRIME/VECTOR).`);
      }
      stopService(target);
      startService(target, GPU_MODE, { printLogTail: false });
      await warmStartedServices([target], {
        retryIntervalMs: STARTUP_HEALTH_RETRY_INTERVAL_MS,
        logRetries: false,
      });
      await runChecks({
        onlyServiceIds: [target.id],
        timeoutMs: POST_START_VERIFY_TIMEOUT_MS,
        retryIntervalMs: STARTUP_HEALTH_RETRY_INTERVAL_MS,
        logRetries: false,
        quietStartMs: POST_START_VERIFY_TIMEOUT_MS,
      });
    } else {
      for (const service of BASE_SERVICES.slice().reverse()) {
        stopService(service);
      }
      for (const service of SERVICES) {
        startService(service, GPU_MODE, { printLogTail: false });
      }
      await warmStartedServices(SERVICES, {
        retryIntervalMs: STARTUP_HEALTH_RETRY_INTERVAL_MS,
        logRetries: false,
      });
      await runChecks({
        timeoutMs: POST_START_VERIFY_TIMEOUT_MS,
        retryIntervalMs: STARTUP_HEALTH_RETRY_INTERVAL_MS,
        logRetries: false,
        quietStartMs: POST_START_VERIFY_TIMEOUT_MS,
      });
    }
    if (!COMMAND_ARG) {
      printServiceStatusSummary();
    }
    console.log("\nRestart completed and endpoint checks passed.");
    return;
  }

  if (COMMAND === "up") {
    for (const service of SERVICES) {
      startService(service, GPU_MODE, { printLogTail: false });
    }
    await warmStartedServices(SERVICES, {
      retryIntervalMs: STARTUP_HEALTH_RETRY_INTERVAL_MS,
      logRetries: false,
    });
  }

  await runChecks({
    timeoutMs: COMMAND === "up" ? POST_START_VERIFY_TIMEOUT_MS : undefined,
    retryIntervalMs: COMMAND === "up" ? STARTUP_HEALTH_RETRY_INTERVAL_MS : undefined,
    logRetries: COMMAND === "up" ? false : true,
    quietStartMs: COMMAND === "up" ? POST_START_VERIFY_TIMEOUT_MS : undefined,
  });
  if (COMMAND === "up") {
    printServiceStatusSummary();
  }
  console.log("\nAll endpoint checks passed.");
}

main().catch((error) => {
  console.error(`\nBootstrap error: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
