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
const ENV_FILES = [path.join(ROOT, ".env"), path.join(ROOT, "..", ".env")];

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

// Ensure local service launches pick up secrets and runtime config from backend/.env,
// then root/.env as fallback for compatibility.
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
      VF_TTS_ENGINE_CONCURRENCY_KOKORO: String(AUTO_TUNED_CONCURRENCY.kokoroConcurrency),
      GEMINI_BATCH_DEFAULT_PARALLEL: String(AUTO_TUNED_CONCURRENCY.gemBatchDefaultParallel),
      GEMINI_BATCH_MAX_PARALLEL: String(AUTO_TUNED_CONCURRENCY.gemBatchMaxParallel),
      KOKORO_BATCH_DEFAULT_PARALLEL: String(AUTO_TUNED_CONCURRENCY.kokoroBatchDefaultParallel),
      KOKORO_BATCH_MAX_PARALLEL: String(AUTO_TUNED_CONCURRENCY.kokoroBatchMaxParallel),
    }
  : {};

const RETRY_INTERVAL_MS = Number(process.env.VF_BOOTSTRAP_RETRY_INTERVAL_MS || 4000);
const REQUEST_TIMEOUT_MS = Number(process.env.VF_BOOTSTRAP_REQUEST_TIMEOUT_MS || 15000);
const DEFAULT_CHECK_TIMEOUT_MS = Number(process.env.VF_BOOTSTRAP_CHECK_TIMEOUT_MS || 60000);
const FAST_TIMEOUT_MS = Number(process.env.VF_BOOTSTRAP_TIMEOUT_FAST_MS || DEFAULT_CHECK_TIMEOUT_MS);
const KOKORO_TIMEOUT_MS = Number(
  process.env.VF_BOOTSTRAP_TIMEOUT_KOKORO_MS || Math.max(DEFAULT_CHECK_TIMEOUT_MS, 90000)
);
const STARTUP_PID_WAIT_TIMEOUT_MS = Math.max(1000, toIntEnv(process.env.VF_STARTUP_PID_WAIT_TIMEOUT_MS, 12000));
const STARTUP_PID_WAIT_POLL_MS = clampInt(toIntEnv(process.env.VF_STARTUP_PID_WAIT_POLL_MS, 250), 100, 2000);
const LOG_ROTATE_MAX_BYTES = Math.max(0, toIntEnv(process.env.VF_SERVICE_LOG_ROTATE_MAX_BYTES, 20 * 1024 * 1024));
const LOG_ROTATE_KEEP = clampInt(toIntEnv(process.env.VF_SERVICE_LOG_ROTATE_KEEP, 3), 0, 10);
const SERVICE_LOG_TAIL_LINES = clampInt(toIntEnv(process.env.VF_SERVICE_LOG_TAIL_LINES, 20), 0, 200);
const SERVICE_WINDOWS_VISIBLE = toBoolEnv(process.env.VF_SERVICE_WINDOWS_VISIBLE, false);
const DOCTOR_MAX_ATTEMPTS = clampInt(toIntEnv(process.env.VF_BOOTSTRAP_DOCTOR_MAX_ATTEMPTS, 2), 1, 5);
const serviceStartStates = new Map();

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
  const token = String(rawValue || "balanced").trim().toLowerCase();
  if (VALID_CONCURRENCY_PROFILES.has(token)) return token;
  return "balanced";
}

function computeConcurrencyPlan(profile, usableCpu) {
  const safeUsableCpu = Math.max(1, Math.trunc(usableCpu || 1));
  if (profile === "max") {
    const queueWorkers = clampInt(safeUsableCpu + 1, 4, 12);
    const gemConcurrency = clampInt(queueWorkers + 6, 6, 24);
    const kokoroConcurrency = clampInt(Math.round(queueWorkers * 1.0), 3, 12);
    const gemBatchDefaultParallel = clampInt(Math.round(gemConcurrency / 3), 2, 8);
    const gemBatchMaxParallel = clampInt(gemBatchDefaultParallel + 3, gemBatchDefaultParallel, 12);
    const kokoroBatchDefaultParallel = clampInt(Math.round(kokoroConcurrency / 2), 1, 6);
    const kokoroBatchMaxParallel = clampInt(kokoroBatchDefaultParallel + 2, kokoroBatchDefaultParallel, 8);
    return {
      queueWorkers,
      gemConcurrency,
      kokoroConcurrency,
      gemBatchDefaultParallel,
      gemBatchMaxParallel,
      kokoroBatchDefaultParallel,
      kokoroBatchMaxParallel,
    };
  }

  if (profile === "cool") {
    const queueWorkers = clampInt(Math.floor((safeUsableCpu + 1) / 2), 1, 4);
    const gemConcurrency = clampInt(queueWorkers + 2, 3, 8);
    const kokoroConcurrency = clampInt(Math.round(queueWorkers * 0.75), 1, 4);
    const gemBatchDefaultParallel = clampInt(Math.round(gemConcurrency / 3), 1, 3);
    const gemBatchMaxParallel = clampInt(gemBatchDefaultParallel + 1, gemBatchDefaultParallel, 4);
    const kokoroBatchDefaultParallel = clampInt(Math.round(kokoroConcurrency / 2), 1, 2);
    const kokoroBatchMaxParallel = clampInt(kokoroBatchDefaultParallel + 1, kokoroBatchDefaultParallel, 3);
    return {
      queueWorkers,
      gemConcurrency,
      kokoroConcurrency,
      gemBatchDefaultParallel,
      gemBatchMaxParallel,
      kokoroBatchDefaultParallel,
      kokoroBatchMaxParallel,
    };
  }

  // balanced profile
  const queueWorkers = clampInt(safeUsableCpu, 2, 8);
  const gemConcurrency = clampInt(queueWorkers + 4, 4, 16);
  const kokoroConcurrency = clampInt(Math.round(queueWorkers * 0.85), 2, 8);
  const gemBatchDefaultParallel = clampInt(Math.round(gemConcurrency / 3), 2, 6);
  const gemBatchMaxParallel = clampInt(gemBatchDefaultParallel + 2, gemBatchDefaultParallel, 8);
  const kokoroBatchDefaultParallel = clampInt(Math.round(kokoroConcurrency / 2), 1, 4);
  const kokoroBatchMaxParallel = clampInt(kokoroBatchDefaultParallel + 1, kokoroBatchDefaultParallel, 6);
  return {
    queueWorkers,
    gemConcurrency,
    kokoroConcurrency,
    gemBatchDefaultParallel,
    gemBatchMaxParallel,
    kokoroBatchDefaultParallel,
    kokoroBatchMaxParallel,
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
const serviceLogPath = (id) => path.join(LOG_DIR, `${id}.log`);
const serviceStatePath = (id) => path.join(STATE_DIR, `${id}.sha256`);

const SERVICES = [
  {
    id: "media-backend",
    name: "Media Backend",
    port: 7800,
    venv: "media-backend",
    pythonEnvVar: "VF_PYTHON_BIN_MEDIA_BACKEND",
    requirements: ["requirements.txt"],
    sourceFiles: ["app.py", "scripts/bootstrap-services.mjs"],
    command: (pythonBin) => [pythonBin, "app.py"],
    env: (gpu) => ({
      VF_BACKEND_HOST: "127.0.0.1",
      VF_BACKEND_PORT: "7800",
      VF_WHISPER_DEVICE: gpu ? "cuda" : "cpu",
      VF_WHISPER_COMPUTE: gpu ? "float16" : "int8",
      VF_LLVC_DEVICE: process.env.VF_LLVC_DEVICE || (gpu ? "cuda:0" : "cpu:0"),
      VF_LLVC_MODELS_DIR: process.env.VF_LLVC_MODELS_DIR || path.join(ROOT, "models/llvc"),
      VF_LLVC_RUNTIME_URL: process.env.VF_LLVC_RUNTIME_URL || "http://127.0.0.1:7830",
      VF_LLVC_MODEL_REGISTRY_FILE:
        process.env.VF_LLVC_MODEL_REGISTRY_FILE || path.join(ROOT, "config/llvc_model_registry.json"),
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
      ...RUNTIME_CONCURRENCY_ENV,
    }),
  },
  {
    id: "kokoro-runtime",
    name: "Kokoro Runtime",
    port: 7820,
    venv: "kokoro-runtime",
    pythonEnvVar: "VF_PYTHON_BIN_KOKORO_RUNTIME",
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
      ...RUNTIME_CONCURRENCY_ENV,
    }),
  },
  {
    id: "llvc-runtime",
    name: "LLVC Runtime",
    port: 7830,
    venv: "llvc-runtime",
    pythonEnvVar: "VF_PYTHON_BIN_LLVC_RUNTIME",
    requiredPython: { major: 3, minor: 11 },
    requirements: ["engines/llvc-runtime/requirements.txt"],
    sourceFiles: ["engines/llvc-runtime/app.py", "scripts/bootstrap-services.mjs"],
    command: (pythonBin) => [
      pythonBin,
      "-m",
      "uvicorn",
      "app:app",
      "--app-dir",
      "engines/llvc-runtime",
      "--host",
      "127.0.0.1",
      "--port",
      "7830",
    ],
    env: (gpu) => ({
      VF_LLVC_RUNTIME_HOST: "127.0.0.1",
      VF_LLVC_RUNTIME_PORT: "7830",
      VF_LLVC_DEVICE: process.env.VF_LLVC_DEVICE || (gpu ? "cuda:0" : "cpu:0"),
      VF_LLVC_MODELS_DIR: process.env.VF_LLVC_MODELS_DIR || path.join(ROOT, "models/llvc"),
      VF_LLVC_MODEL_REGISTRY_FILE:
        process.env.VF_LLVC_MODEL_REGISTRY_FILE || path.join(ROOT, "config/llvc_model_registry.json"),
      ...RUNTIME_CONCURRENCY_ENV,
    }),
  },
];

const ENGINE_TO_SERVICE_ID = {
  GEM: "gemini-runtime",
  GEMINI: "gemini-runtime",
  GOOD: "gemini-runtime",
  GOOD_RUNTIME: "gemini-runtime",
  GEMINI_2_5_LITE_TTS: "gemini-runtime",
  NEURAL2: "gemini-runtime",
  NEURAL_2: "gemini-runtime",
  NURAL2: "gemini-runtime",
  NURAL_2: "gemini-runtime",
  KOKORO: "kokoro-runtime",
};

const CHECKS = [
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
    serviceId: "kokoro-runtime",
    name: "Kokoro Runtime",
    url: "http://127.0.0.1:7820/health",
    timeoutMs: KOKORO_TIMEOUT_MS,
    validate: (payload) => typeof payload === "object" && payload !== null && payload.ok === true,
  },
  {
    serviceId: "llvc-runtime",
    name: "LLVC Runtime",
    url: "http://127.0.0.1:7830/v1/health",
    timeoutMs: FAST_TIMEOUT_MS,
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

function resolveServicePythonBin(service) {
  const byService = service?.pythonEnvVar ? String(process.env[service.pythonEnvVar] || "").trim() : "";
  if (byService) return byService;
  const byGlobal = String(process.env.VF_PYTHON_BIN || "").trim();
  if (byGlobal) return byGlobal;
  return GLOBAL_PYTHON_BIN;
}

function getPythonVersionTuple(pythonBin) {
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
  return { major, minor, patch, token };
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

function fileSha(service, pythonBin) {
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
  const pyVersion = getPythonVersionTuple(pythonBin).token;
  return sha256(`${pythonBin}\n${pyVersion}\n${requirementSource}\n\n${sourceFileSource}`);
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

  const reqHash = desiredHash || fileSha(service, servicePythonBin);
  const statePath = serviceStatePath(service.id);
  const currentHash = fs.existsSync(statePath) ? fs.readFileSync(statePath, "utf8").trim() : "";
  if (currentHash === reqHash) {
    runServiceFixups(service);
    writePipFreeze(pyPath, service.id);
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
  const servicePythonBin = resolveServicePythonBin(service);
  ensureServicePythonVersion(service, servicePythonBin);
  const desiredFingerprint = fileSha(service, servicePythonBin);
  const statePath = serviceStatePath(service.id);
  const currentFingerprint = fs.existsSync(statePath) ? fs.readFileSync(statePath, "utf8").trim() : "";
  const serviceStale = desiredFingerprint !== currentFingerprint;
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
  fs.rmSync(servicePidPath(service.id), { force: true });
  stopPortListeners(service);

  const pyPath = ensureVenv(service, servicePythonBin, desiredFingerprint);
  const pyVersion = getPythonVersionTuple(pyPath).token;
  console.log(
    `${service.name} runtime: venv=${path.join(VENV_DIR, service.venv)} interpreter=${servicePythonBin} python=${pyVersion}`
  );
  const [cmd, ...args] = service.command(pyPath);
  const logFile = serviceLogPath(service.id);
  rotateServiceLog(logFile);
  const outFd = fs.openSync(logFile, "a");

  const child = spawn(cmd, args, {
    cwd: ROOT,
    env: {
      ...process.env,
      PATH: `${path.dirname(pyPath)}${path.delimiter}${process.env.PATH || ""}`,
      ...(service.env ? service.env(gpuMode) : {}),
    },
    detached: true,
    windowsHide: !SERVICE_WINDOWS_VISIBLE,
    stdio: ["ignore", outFd, outFd],
  });

  child.unref();
  fs.closeSync(outFd);
  const resolvedListeningPid = waitForListeningPid(service);
  const stablePid = resolvedListeningPid || child.pid;
  fs.writeFileSync(servicePidPath(service.id), `${stablePid}\n`, "utf8");
  serviceStartStates.set(service.id, "restarted");
  if (resolvedListeningPid && resolvedListeningPid !== child.pid) {
    console.log(
      `Started ${service.name} (launcher PID ${child.pid}, listener PID ${resolvedListeningPid}) -> ${logFile}`
    );
    printServiceLogTail(service.id, service.name);
    return;
  }
  console.log(`Started ${service.name} (PID ${stablePid}) -> ${logFile}`);
  printServiceLogTail(service.id, service.name);
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
      `Invalid engine "${rawEngine}". Expected one of: GEM, GOOD, NEURAL2, KOKORO.`
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
    serviceId: check.serviceId || "",
    service: check.name,
    status: "FAIL",
    attempts,
    elapsedSec: ((Date.now() - started) / 1000).toFixed(1),
    detail: lastError,
  };
}

async function runChecks(options = {}) {
  const failOnError = options.failOnError !== false;
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
    startService(service, gpuMode);
  }

  let lastResults = [];
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    console.log(`\n[doctor] Health validation attempt ${attempt}/${maxAttempts}`);
    const results = await runChecks({ failOnError: false });
    lastResults = results;

    const failed = results.filter((item) => item.status === "FAIL");
    if (failed.length === 0) {
      printServiceStatusSummary();
      console.log("\nDoctor completed successfully.");
      return;
    }

    if (attempt >= maxAttempts) break;

    const failedServices = resolveFailedServices(results);
    if (failedServices.length === 0) {
      console.warn("[doctor] Failed checks could not be mapped to specific services. Restarting all services.");
      for (const service of SERVICES.slice().reverse()) {
        stopService(service);
      }
      for (const service of SERVICES) {
        startService(service, gpuMode);
      }
      continue;
    }

    console.warn(`[doctor] Restarting unhealthy services: ${failedServices.map((service) => service.id).join(", ")}`);
    for (const service of failedServices) {
      stopService(service);
      startService(service, gpuMode);
    }
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
      `Autotune result: queueWorkers=${AUTO_TUNED_CONCURRENCY.queueWorkers} gemConcurrency=${AUTO_TUNED_CONCURRENCY.gemConcurrency} kokoroConcurrency=${AUTO_TUNED_CONCURRENCY.kokoroConcurrency} gemBatch=${AUTO_TUNED_CONCURRENCY.gemBatchDefaultParallel}/${AUTO_TUNED_CONCURRENCY.gemBatchMaxParallel} kokoroBatch=${AUTO_TUNED_CONCURRENCY.kokoroBatchDefaultParallel}/${AUTO_TUNED_CONCURRENCY.kokoroBatchMaxParallel}`
    );
  } else {
    console.log("Concurrency autotune disabled (VF_AUTO_TUNE_WORKERS=0).");
  }

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

  if (COMMAND === "doctor" || (COMMAND === "check" && REPAIR_MODE)) {
    await runDoctor(GPU_MODE, DOCTOR_MAX_ATTEMPTS);
    return;
  }

  if (COMMAND === "restart") {
    if (COMMAND_ARG) {
      const target = resolveServiceTarget(COMMAND_ARG);
      if (!target) {
        throw new Error(`Unknown restart target "${COMMAND_ARG}". Use a service id or engine (GEM/GOOD/NEURAL2/KOKORO).`);
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
    printServiceStatusSummary();
    console.log("\nRestart completed and endpoint checks passed.");
    return;
  }

  if (COMMAND === "up") {
    for (const service of SERVICES) {
      startService(service, GPU_MODE);
    }
  }

  await runChecks();
  if (COMMAND === "up") {
    printServiceStatusSummary();
  }
  console.log("\nAll endpoint checks passed.");
}

main().catch((error) => {
  console.error(`\nBootstrap error: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
