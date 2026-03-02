#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");

const PROFILE_BANK_PATH = path.join(ROOT, "config", "voice_profile_bank.v1.json");
const REF_DIR = path.join(ROOT, "assets", "voice_profiles", "reference");
const MANIFEST_PATH = path.join(ROOT, "data", "voice-profile-download-manifest.json");
const ALLOWED_LICENSES = new Set(["CC0", "Public Domain", "CC-BY", "CC BY", "CC-BY-4.0", "CC BY 4.0"]);

async function readBank() {
  const raw = await fs.readFile(PROFILE_BANK_PATH, "utf8");
  const parsed = JSON.parse(raw);
  if (!parsed || !Array.isArray(parsed.profiles)) {
    throw new Error("Invalid voice profile bank format: profiles[] is required.");
  }
  return parsed;
}

async function ensureDir(targetPath) {
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
}

function safeFileName(name) {
  return String(name || "")
    .trim()
    .replace(/[^a-z0-9_\-.]+/gi, "_")
    .replace(/^\.+/, "")
    .slice(0, 120);
}

function extFromUrl(url) {
  try {
    const token = new URL(url);
    const ext = path.extname(token.pathname || "").toLowerCase();
    if (ext && ext.length <= 8) return ext;
  } catch {
    // ignore
  }
  return ".wav";
}

async function downloadProfileAudio(profile, force) {
  const profileId = String(profile.profileId || "").trim();
  const sourceUrl = String(profile.sourceUrl || "").trim();
  const license = String(profile.license || "").trim();

  if (!profileId) {
    return { profileId: "", skipped: true, reason: "missing_profile_id" };
  }
  if (!sourceUrl) {
    return { profileId, skipped: true, reason: "missing_source_url" };
  }
  if (!ALLOWED_LICENSES.has(license)) {
    return { profileId, skipped: true, reason: `license_not_allowed:${license || "unknown"}` };
  }

  const ext = extFromUrl(sourceUrl);
  const fileName = `${safeFileName(profileId)}${ext}`;
  const targetPath = path.join(REF_DIR, fileName);

  if (!force) {
    try {
      await fs.access(targetPath);
      return { profileId, skipped: true, reason: "exists", targetPath: path.relative(ROOT, targetPath) };
    } catch {
      // continue
    }
  }

  const response = await fetch(sourceUrl);
  if (!response.ok) {
    return { profileId, skipped: true, reason: `http_${response.status}`, sourceUrl };
  }

  const bytes = Buffer.from(await response.arrayBuffer());
  await ensureDir(targetPath);
  await fs.writeFile(targetPath, bytes);

  return {
    profileId,
    skipped: false,
    bytes: bytes.length,
    targetPath: path.relative(ROOT, targetPath),
    sourceUrl,
    license,
  };
}

async function writeManifest(bank, rows) {
  const manifest = {
    generatedAt: new Date().toISOString(),
    profileBankVersion: bank.version || "0",
    note: "Only open-licensed profiles are downloaded. Missing sourceUrl profiles are recorded as skipped.",
    profiles: rows,
  };
  await ensureDir(MANIFEST_PATH);
  await fs.writeFile(MANIFEST_PATH, JSON.stringify(manifest, null, 2), "utf8");
}

async function main() {
  const force = process.argv.includes("--force");
  const bank = await readBank();
  const rows = [];
  for (const profile of bank.profiles) {
    // eslint-disable-next-line no-await-in-loop
    const row = await downloadProfileAudio(profile, force);
    rows.push(row);
    const status = row.skipped ? "skip" : "ok";
    console.log(`[${status}] ${row.profileId || "<unknown>"} ${row.reason || row.targetPath || ""}`.trim());
  }
  await writeManifest(bank, rows);
  console.log(`Manifest written: ${path.relative(ROOT, MANIFEST_PATH)}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
