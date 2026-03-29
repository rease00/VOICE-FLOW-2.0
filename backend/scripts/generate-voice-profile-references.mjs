#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");

const PROFILE_BANK_PATH = path.join(ROOT, "config", "voice_profile_bank.v1.json");
const VOICE_MAP_PATH = path.join(ROOT, "config", "voice_id_map.v1.json");
const REF_DIR = path.join(ROOT, "assets", "voice_profiles", "reference");
const MANIFEST_PATH = path.join(ROOT, "data", "voice-profile-generated-manifest.json");
const REF_DIR_RELATIVE = "assets/voice_profiles/reference";

const GEM_RUNTIME_URL = String(process.env.VF_GEMINI_RUNTIME_URL || "http://127.0.0.1:7810").trim().replace(/\/+$/, "");
const DUNO_RUNTIME_URL = String(
  process.env.VF_DUNO_RUNTIME_URL || process.env.VF_DUNO_MODAL_RUNTIME_URL || ""
).trim().replace(/\/+$/, "");

function parseJson(raw) {
  const clean = String(raw || "").replace(/^\uFEFF/, "");
  return JSON.parse(clean);
}

async function readJson(filePath) {
  const raw = await fs.readFile(filePath, "utf8");
  return parseJson(raw);
}

function toPosixPath(inputPath) {
  return String(inputPath || "").replace(/\\/g, "/");
}

function sampleTextForProfile(profile) {
  const name = String(profile.displayName || profile.profileId || "Speaker").trim();
  return `${name}. VoiceFlow high quality reference sample for narration and dialogue.`;
}

function canonicalVoiceIdEntries(voiceToProfile) {
  const pairs = [];
  for (const [voiceKey, profileId] of Object.entries(voiceToProfile || {})) {
    const key = String(voiceKey || "").trim();
    const profile = String(profileId || "").trim();
    if (!key || !profile) continue;
    if (!/^v\d+$/i.test(key)) continue;
    pairs.push({ voiceId: key, profileId: profile });
  }
  pairs.sort((a, b) => {
    const ai = Number.parseInt(a.voiceId.slice(1), 10);
    const bi = Number.parseInt(b.voiceId.slice(1), 10);
    return ai - bi;
  });
  return pairs;
}

async function synthesizeGemReference({ text, voiceId, traceId }) {
  const endpoint = `${GEM_RUNTIME_URL}/synthesize`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      text,
      voiceName: voiceId,
      voice_id: voiceId,
      language: "en",
      trace_id: traceId,
    }),
  });
  if (!response.ok) {
    const raw = await response.text().catch(() => "");
    const detail = raw ? raw.slice(0, 240) : `http_${response.status}`;
    throw new Error(detail);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length < 128) {
    throw new Error("empty_or_tiny_audio");
  }
  return bytes;
}

async function synthesizeDunoReference({ text, voiceId, traceId }) {
  const endpoint = `${DUNO_RUNTIME_URL}/synthesize`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      text,
      voiceId,
      voice_id: voiceId,
      language: "en",
      trace_id: traceId,
    }),
  });
  if (!response.ok) {
    const raw = await response.text().catch(() => "");
    const detail = raw ? raw.slice(0, 240) : `http_${response.status}`;
    throw new Error(detail);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length < 128) {
    throw new Error("empty_or_tiny_audio");
  }
  return bytes;
}

function buildProfileMappings(voiceMapPayload) {
  const gemVoiceToProfile = voiceMapPayload?.engines?.PRIME?.voiceToProfile || {};
  const dunoVoiceToProfile = voiceMapPayload?.engines?.DUNO?.voiceToProfile || {};

  const gemPairs = canonicalVoiceIdEntries(gemVoiceToProfile);
  const gemProfileToVoice = new Map();
  for (const item of gemPairs) {
    if (!gemProfileToVoice.has(item.profileId)) {
      gemProfileToVoice.set(item.profileId, item.voiceId);
    }
  }

  const dunoProfileToVoice = new Map();
  for (const [voiceId, profileId] of Object.entries(dunoVoiceToProfile || {})) {
    const v = String(voiceId || "").trim();
    const p = String(profileId || "").trim();
    if (!v || !p) continue;
    if (!dunoProfileToVoice.has(p)) {
      dunoProfileToVoice.set(p, v);
    }
  }
  return { gemProfileToVoice, dunoProfileToVoice };
}

function dunoGenderFallbackVoice(profile) {
  const gender = String(profile?.gender || "").trim().toLowerCase();
  if (gender === "male") return "hm_omega";
  return "hf_alpha";
}

async function main() {
  const force = process.argv.includes("--force");
  const noWire = process.argv.includes("--no-wire");
  const bank = await readJson(PROFILE_BANK_PATH);
  const map = await readJson(VOICE_MAP_PATH);

  if (!DUNO_RUNTIME_URL) {
    throw new Error("VF_DUNO_RUNTIME_URL must point to the Modal Duno endpoint.");
  }

  if (!Array.isArray(bank?.profiles)) {
    throw new Error("Invalid profile bank. Expected profiles[]");
  }

  const { gemProfileToVoice, dunoProfileToVoice } = buildProfileMappings(map);

  await fs.mkdir(REF_DIR, { recursive: true });
  const rows = [];

  for (const profile of bank.profiles) {
    const profileId = String(profile?.profileId || "").trim();
    if (!profileId) {
      rows.push({ profileId: "", status: "skip", reason: "missing_profile_id" });
      continue;
    }

    const gemVoiceId = String(gemProfileToVoice.get(profileId) || "").trim();
    const dunoVoiceId = String(dunoProfileToVoice.get(profileId) || "").trim();
    const dunoFallbackVoiceId = dunoGenderFallbackVoice(profile);

    const targetPath = path.join(REF_DIR, `${profileId}.wav`);
    if (!force) {
      try {
        await fs.access(targetPath);
        rows.push({
          profileId,
          status: "skip",
          reason: "exists",
          voiceId: gemVoiceId || dunoVoiceId || dunoFallbackVoiceId,
          targetPath: path.relative(ROOT, targetPath),
        });
        console.log(`[skip] ${profileId} exists`);
        continue;
      } catch {
        // proceed
      }
    }

    const text = sampleTextForProfile(profile);
    let bytes = null;
    let engineUsed = "";
    let voiceUsed = "";
    let gemError = "";
    let dunoError = "";

    if (gemVoiceId) {
      try {
        bytes = await synthesizeGemReference({
          text,
          voiceId: gemVoiceId,
          traceId: `vf_profile_ref_${profileId}_gem`,
        });
        engineUsed = "PRIME";
        voiceUsed = gemVoiceId;
      } catch (error) {
        gemError = error instanceof Error ? error.message : String(error);
      }
    }

    if (!bytes) {
      const fallbackOrder = [dunoVoiceId, dunoFallbackVoiceId].filter(Boolean);
      for (const dunoCandidate of fallbackOrder) {
        try {
          bytes = await synthesizeDunoReference({
            text,
            voiceId: dunoCandidate,
            traceId: `vf_profile_ref_${profileId}_duno`,
          });
          engineUsed = "DUNO";
          voiceUsed = dunoCandidate;
          break;
        } catch (error) {
          dunoError = error instanceof Error ? error.message : String(error);
        }
      }
    }

    if (bytes) {
      await fs.writeFile(targetPath, bytes);
      rows.push({
        profileId,
        status: "ok",
        engine: engineUsed,
        voiceId: voiceUsed,
        bytes: bytes.length,
        targetPath: path.relative(ROOT, targetPath),
        gemError: gemError || undefined,
      });
      console.log(`[ok] ${profileId} (${engineUsed}:${voiceUsed}) -> ${path.relative(ROOT, targetPath)}`);
    } else {
      const reason = [gemError, dunoError].filter(Boolean).join(" | ") || "no_runtime_available";
      rows.push({
        profileId,
        status: "fail",
        engine: "none",
        voiceId: gemVoiceId || dunoVoiceId || dunoFallbackVoiceId || "",
        reason,
      });
      console.log(`[fail] ${profileId} ${reason}`);
    }
  }

  if (!noWire) {
    const rowByProfile = new Map();
    for (const row of rows) {
      const profileId = String(row?.profileId || "").trim();
      if (profileId) rowByProfile.set(profileId, row);
    }

    const wiredAt = new Date().toISOString();
    for (const profile of bank.profiles) {
      const profileId = String(profile?.profileId || "").trim();
      if (!profileId) continue;
      const relPath = `${REF_DIR_RELATIVE}/${profileId}.wav`;
      const absPath = path.join(ROOT, ...relPath.split("/"));
      let exists = false;
      try {
        await fs.access(absPath);
        exists = true;
      } catch {
        exists = false;
      }

      const row = rowByProfile.get(profileId);
      profile.referencePath = toPosixPath(relPath);
      profile.isDownloaded = exists;
      profile.referenceOrigin = "generated-runtime";
      if (row && typeof row.engine === "string" && row.engine.trim()) {
        profile.referenceEngine = row.engine;
      }
      if (row && typeof row.voiceId === "string" && row.voiceId.trim()) {
        profile.referenceVoiceId = row.voiceId;
      }
      if (exists) {
        profile.referenceUpdatedAt = wiredAt;
      }
    }

    await fs.writeFile(PROFILE_BANK_PATH, `${JSON.stringify(bank, null, 2)}\n`, "utf8");
  }

  const summary = {
    generatedAt: new Date().toISOString(),
    note: "Voice profile reference clips generated from runtime mappings with PRIME primary and Duno fallback.",
    runtimeUrls: {
      gem: GEM_RUNTIME_URL,
      duno: DUNO_RUNTIME_URL,
    },
    rows,
  };
  await fs.mkdir(path.dirname(MANIFEST_PATH), { recursive: true });
  await fs.writeFile(MANIFEST_PATH, JSON.stringify(summary, null, 2), "utf8");

  const ok = rows.filter((row) => row.status === "ok").length;
  const skip = rows.filter((row) => row.status === "skip").length;
  const fail = rows.filter((row) => row.status === "fail").length;
  console.log(`Done. ok=${ok} skip=${skip} fail=${fail}`);
  if (!noWire) {
    console.log(`Wired profile bank: ${path.relative(ROOT, PROFILE_BANK_PATH)}`);
  }
  console.log(`Manifest written: ${path.relative(ROOT, MANIFEST_PATH)}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
