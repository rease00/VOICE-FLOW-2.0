#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");

const SERVICES = [
  { id: "media-backend", port: 7800 },
  { id: "gemini-runtime", port: 7810 },
  { id: "kokoro-runtime", port: 7820 },
  { id: "llvc-runtime", port: 7830 },
];

function parsePidsFromText(text) {
  const pids = new Set();
  const lines = String(text || "").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const matches = trimmed.match(/\d+/g);
    if (!matches || matches.length === 0) continue;
    const pid = Number(matches[matches.length - 1]);
    if (Number.isFinite(pid) && pid > 0) pids.add(pid);
  }
  return [...pids];
}

function listListeningPidOnPort(port) {
  const numericPort = Number(port);
  if (!Number.isFinite(numericPort) || numericPort <= 0) return null;

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
      return parsePidsFromText(ps.stdout)[0] || null;
    }

    const netstat = spawnSync(
      "cmd.exe",
      ["/d", "/s", "/c", `netstat -ano -p tcp | findstr /R /C:\":${numericPort} .*LISTENING\"`],
      { cwd: ROOT, encoding: "utf8" }
    );
    if (netstat.status === 0 && netstat.stdout?.trim()) {
      return parsePidsFromText(netstat.stdout)[0] || null;
    }
    return null;
  }

  const lsof = spawnSync("sh", ["-lc", `lsof -tiTCP:${numericPort} -sTCP:LISTEN 2>/dev/null`], {
    cwd: ROOT,
    encoding: "utf8",
  });
  if (lsof.status === 0 && lsof.stdout?.trim()) {
    return parsePidsFromText(lsof.stdout)[0] || null;
  }
  return null;
}

function snapshotListenerPids() {
  const rows = SERVICES.map((service) => ({
    service: service.id,
    port: service.port,
    pid: listListeningPidOnPort(service.port),
  }));
  return rows;
}

function printSnapshot(label, rows) {
  console.log(`\n${label}`);
  console.table(
    rows.map((row) => ({
      service: row.service,
      port: row.port,
      listeningPid: row.pid || "-",
    }))
  );
}

function runBootstrap(command) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ["scripts/bootstrap-services.mjs", command], {
      cwd: ROOT,
      stdio: "inherit",
      env: process.env,
      windowsHide: false,
    });

    child.on("exit", (code, signal) => {
      if (code === 0) {
        resolve({ ok: true });
        return;
      }
      resolve({
        ok: false,
        cause: signal ? `signal ${signal}` : `exit code ${typeof code === "number" ? code : "unknown"}`,
      });
    });

    child.on("error", (error) => {
      resolve({ ok: false, cause: error instanceof Error ? error.message : String(error) });
    });
  });
}

function diffSnapshots(before, after) {
  const afterByService = new Map(after.map((row) => [row.service, row]));
  const diffs = [];
  for (const first of before) {
    const second = afterByService.get(first.service);
    const beforePid = first.pid || null;
    const afterPid = second?.pid || null;
    if (beforePid !== afterPid) {
      diffs.push({
        service: first.service,
        port: first.port,
        beforePid: beforePid || "-",
        afterPid: afterPid || "-",
        status: !beforePid || !afterPid ? "missing" : "changed",
      });
    }
  }
  return diffs;
}

async function main() {
  let exitCode = 0;
  try {
    console.log("[audit-bootstrap-idempotency] Step 1/4: services:down");
    const downInitial = await runBootstrap("down");
    if (!downInitial.ok) {
      throw new Error(`services:down failed before audit (${downInitial.cause || "unknown"})`);
    }

    console.log("[audit-bootstrap-idempotency] Step 2/4: services:bootstrap (first run)");
    const firstUp = await runBootstrap("up");
    if (!firstUp.ok) {
      throw new Error(`first services:bootstrap failed (${firstUp.cause || "unknown"})`);
    }
    const firstSnapshot = snapshotListenerPids();
    printSnapshot("Listener snapshot after first bootstrap", firstSnapshot);

    console.log("[audit-bootstrap-idempotency] Step 3/4: services:bootstrap (second run)");
    const secondUp = await runBootstrap("up");
    if (!secondUp.ok) {
      throw new Error(`second services:bootstrap failed (${secondUp.cause || "unknown"})`);
    }
    const secondSnapshot = snapshotListenerPids();
    printSnapshot("Listener snapshot after second bootstrap", secondSnapshot);

    console.log("[audit-bootstrap-idempotency] Step 4/4: compare snapshots");
    const diffs = diffSnapshots(firstSnapshot, secondSnapshot);
    if (diffs.length > 0) {
      console.error("\nIdempotency audit failed: listener PIDs changed between first and second bootstrap.");
      console.table(diffs);
      throw new Error("bootstrap is not idempotent");
    }

    console.log("\nIdempotency audit passed: listener PIDs are stable across repeated bootstrap runs.");
  } catch (error) {
    exitCode = 1;
    console.error(`\n[audit-bootstrap-idempotency] FAIL: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    console.log("\n[audit-bootstrap-idempotency] Cleanup: services:down");
    const downFinal = await runBootstrap("down");
    if (!downFinal.ok) {
      exitCode = 1;
      console.error(
        `[audit-bootstrap-idempotency] Cleanup warning: services:down failed (${downFinal.cause || "unknown"})`
      );
    }
  }

  process.exit(exitCode);
}

main().catch((error) => {
  console.error(`[audit-bootstrap-idempotency] fatal: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
