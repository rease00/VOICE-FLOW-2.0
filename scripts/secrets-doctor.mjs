#!/usr/bin/env node
/**
 * Validates that every credential required by CI/CD is present and reachable.
 * Run locally: `node scripts/secrets-doctor.mjs`
 * In CI: same command — exits 0 only if all green.
 *
 * Reads from process.env. Set them via `.env.local` (loaded automatically) or
 * direct shell exports. Never commits secrets.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

// --- minimal .env loader (no dependency) ---
function loadDotEnv(file) {
  if (!existsSync(file)) return;
  const text = readFileSync(file, "utf8");
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = val;
  }
}
loadDotEnv(join(process.cwd(), ".env.local"));
loadDotEnv(join(process.cwd(), "frontend", ".env.local"));

// --- required secrets registry ---
const REQUIRED = [
  { key: "CLOUDFLARE_API_TOKEN", group: "Cloudflare", probe: probeCloudflare },
  { key: "CLOUDFLARE_ACCOUNT_ID", group: "Cloudflare" },
  { key: "GCP_PROJECT_ID", group: "GCP" },
  { key: "GCP_WIF_PROVIDER", group: "GCP", optional: true, note: "set in CI only (OIDC federation)" },
  { key: "GCP_SERVICE_ACCOUNT", group: "GCP", optional: true, note: "set in CI only" },
  { key: "R2_ACCOUNT_ID", group: "R2" },
  { key: "R2_ACCESS_KEY_ID", group: "R2" },
  { key: "R2_SECRET_ACCESS_KEY", group: "R2" },
  { key: "FIREBASE_SERVICE_ACCOUNT_JSON", group: "Firebase", validate: isJson },
  { key: "STRIPE_SECRET_KEY", group: "Stripe", probe: probeStripe },
  { key: "STRIPE_WEBHOOK_SECRET", group: "Stripe" },
  { key: "GEMINI_RUNTIME_ADMIN_TOKEN", group: "Runtime" },
  { key: "MODAL_TOKEN_ID", group: "Modal", optional: true },
  { key: "MODAL_TOKEN_SECRET", group: "Modal", optional: true },
];

function isJson(v) {
  try { JSON.parse(v); return true; } catch { return false; }
}

async function probeCloudflare() {
  const token = process.env.CLOUDFLARE_API_TOKEN;
  if (!token) return { ok: false, msg: "no token" };
  const res = await fetch("https://api.cloudflare.com/client/v4/user/tokens/verify", {
    headers: { Authorization: `Bearer ${token}` },
  });
  return { ok: res.status === 200, msg: `HTTP ${res.status}` };
}

async function probeStripe() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return { ok: false, msg: "no key" };
  const res = await fetch("https://api.stripe.com/v1/balance", {
    headers: { Authorization: `Bearer ${key}` },
  });
  return { ok: res.status === 200, msg: `HTTP ${res.status}` };
}

// --- run ---
const results = [];
for (const item of REQUIRED) {
  const present = !!process.env[item.key];
  const status = { ...item, present };
  if (!present) {
    status.ok = !!item.optional;
    status.detail = item.optional ? "(optional)" : "MISSING";
  } else if (item.validate && !item.validate(process.env[item.key])) {
    status.ok = false;
    status.detail = "invalid format";
  } else {
    status.ok = true;
    status.detail = "set";
  }
  if (item.probe && present) {
    try {
      const probe = await item.probe();
      status.probe = probe.msg;
      status.ok = status.ok && probe.ok;
    } catch (err) {
      status.probe = `ERR ${err.message}`;
      status.ok = false;
    }
  }
  results.push(status);
}

const groups = {};
for (const r of results) (groups[r.group] ||= []).push(r);

let failed = 0;
console.log("\n=== secrets-doctor ===\n");
for (const [group, items] of Object.entries(groups)) {
  console.log(`[${group}]`);
  for (const r of items) {
    const mark = r.ok ? "✓" : "✗";
    const probe = r.probe ? ` · probe: ${r.probe}` : "";
    console.log(`  ${mark} ${r.key.padEnd(34)} ${r.detail}${probe}`);
    if (!r.ok) failed++;
  }
  console.log();
}

if (failed > 0) {
  console.error(`FAILED — ${failed} credential(s) need attention. See docs/CI_SECRETS.md\n`);
  process.exit(1);
}
console.log("All required credentials are present and valid.\n");
