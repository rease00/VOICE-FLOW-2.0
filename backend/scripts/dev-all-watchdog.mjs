#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");

const argv = process.argv.slice(2);
const readArg = (flag, fallback = "") => {
  const index = argv.indexOf(flag);
  if (index < 0) return fallback;
  if (index + 1 >= argv.length) return fallback;
  return String(argv[index + 1] || "");
};

const OWNER_PID = Number(readArg("--owner-pid", "0"));
const SESSION_ID = readArg("--session-id", "").trim();
const SESSION_FILE = readArg("--session-file", path.join(ROOT, ".runtime", "state", "dev-all-session.json"));
const POLL_MS = Math.max(250, Math.floor(Number(readArg("--poll-ms", "2000")) || 2000));
const GRACE_MS = Math.max(1000, Math.floor(Number(readArg("--grace-ms", "5000")) || 5000));

function isPidAlive(pid) {
  if (!pid || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function readSessionLease() {
  try {
    if (!fs.existsSync(SESSION_FILE)) return null;
    const raw = fs.readFileSync(SESSION_FILE, "utf8");
    const parsed = JSON.parse(String(raw || "{}"));
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function sessionLeaseMatches() {
  const lease = readSessionLease();
  if (!lease) return false;
  return (
    String(lease.sessionId || "") === SESSION_ID &&
    Number(lease.ownerPid || 0) === OWNER_PID
  );
}

function clearSessionLeaseIfOwned() {
  if (!sessionLeaseMatches()) return;
  try {
    fs.rmSync(SESSION_FILE, { force: true });
  } catch {
    // ignore
  }
}

function runServicesDownSync() {
  const args = ["scripts/bootstrap-services.mjs", "down"];
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const result = spawnSync(process.execPath, args, {
      cwd: ROOT,
      stdio: "ignore",
      env: process.env,
      windowsHide: true,
    });
    if (result.status === 0) return true;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1000);
  }
  return false;
}

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  if (!Number.isFinite(OWNER_PID) || OWNER_PID <= 0) return;
  if (!SESSION_ID) return;

  let ownerDeadAtMs = 0;
  while (true) {
    if (isPidAlive(OWNER_PID)) {
      ownerDeadAtMs = 0;
      await sleep(POLL_MS);
      continue;
    }
    if (!ownerDeadAtMs) {
      ownerDeadAtMs = Date.now();
      await sleep(POLL_MS);
      continue;
    }
    if (Date.now() - ownerDeadAtMs < GRACE_MS) {
      await sleep(POLL_MS);
      continue;
    }
    if (!sessionLeaseMatches()) return;
    runServicesDownSync();
    clearSessionLeaseIfOwned();
    return;
  }
}

main().catch(() => {
  // Watchdog must remain silent and fail-safe.
});
