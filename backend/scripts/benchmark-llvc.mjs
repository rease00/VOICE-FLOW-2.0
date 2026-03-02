#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(__filename), "..");
const BACKEND_URL = (process.env.VF_BENCH_BACKEND_URL || "http://127.0.0.1:7800").replace(/\/+$/, "");
const INPUT_PATH = process.env.VF_BENCH_AUDIO || "";
const MODEL_NAME = process.env.VF_BENCH_MODEL || "llvc_hq_cpu";
const OUT_FILE = path.join(ROOT, "artifacts", "llvc_benchmark_report.json");

const PRESETS = ["llvc_hq_cpu", "tts_realtime"];

function sha256(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

async function runOne(preset, inputBytes, inputName) {
  const form = new FormData();
  form.append("file", new Blob([inputBytes], { type: "audio/wav" }), inputName);
  form.append("model_name", MODEL_NAME);
  form.append("preset", preset);
  form.append("pitch_shift", "0");
  form.append("index_rate", "0.5");
  form.append("filter_radius", "3");
  form.append("rms_mix_rate", "1.0");
  form.append("protect", "0.33");
  form.append("f0_method", "rmvpe");

  const started = Date.now();
  const response = await fetch(`${BACKEND_URL}/llvc/convert`, { method: "POST", body: form });
  const elapsedMs = Date.now() - started;
  const payload = await response.arrayBuffer();
  const bytes = Buffer.from(payload);

  return {
    preset,
    ok: response.ok,
    status: response.status,
    elapsedMs,
    outputBytes: bytes.length,
    sha256: bytes.length > 0 ? sha256(bytes) : null,
    engineSelected: response.headers.get("x-vf-engine-selected"),
    engineExecuted: response.headers.get("x-vf-engine-executed"),
    fallbackUsed: response.headers.get("x-vf-llvc-fallback"),
    fallbackReason: response.headers.get("x-vf-llvc-fallback-reason"),
    supportsOneShotCloneAtDecision: response.headers.get("x-vf-supports-one-shot-clone-at-decision"),
  };
}

async function main() {
  if (!INPUT_PATH || !fs.existsSync(INPUT_PATH)) {
    console.error("Set VF_BENCH_AUDIO to a valid local wav path.");
    process.exit(1);
  }
  const inputBytes = fs.readFileSync(INPUT_PATH);
  const inputName = path.basename(INPUT_PATH);
  const rows = [];

  for (const preset of PRESETS) {
    try {
      rows.push(await runOne(preset, inputBytes, inputName));
    } catch (error) {
      rows.push({
        preset,
        ok: false,
        status: 0,
        elapsedMs: 0,
        outputBytes: 0,
        sha256: null,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const report = {
    generatedAt: new Date().toISOString(),
    backendUrl: BACKEND_URL,
    inputPath: INPUT_PATH,
    modelName: MODEL_NAME,
    results: rows,
  };

  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  fs.writeFileSync(OUT_FILE, JSON.stringify(report, null, 2), "utf8");
  console.table(rows);
  console.log(`Saved benchmark report: ${OUT_FILE}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
