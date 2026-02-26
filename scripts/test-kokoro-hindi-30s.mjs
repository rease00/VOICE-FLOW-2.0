import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');
const ARTIFACT_DIR = path.join(ROOT, 'artifacts');
const WAV_PATH = path.join(ARTIFACT_DIR, 'kokoro_hi_30s.wav');
const REPORT_PATH = path.join(ARTIFACT_DIR, 'kokoro_hi_30s_report.json');

const MODEL_ID = 'onnx-community/Kokoro-82M-v1.0-ONNX';
const ASR_MODEL_ID = 'Xenova/whisper-tiny';
const VOICE_ID = process.env.VF_KOKORO_TEST_VOICE || 'hf_alpha';

const TARGET_SECONDS = 30;
const MIN_SECONDS = 28;
const MAX_SECONDS = 32;

const HINDI_TEST_TEXT = `नमस्ते, यह तीस सेकंड की हिंदी आवाज़ गुणवत्ता जाँच है।
आज हम स्पष्ट उच्चारण, प्राकृतिक विराम और बोलने की लय की जाँच कर रहे हैं।
अगर आप यह वाक्य साफ़ सुन पा रहे हैं, तो मॉडल सही तरीके से काम कर रहा है।
अब मैं कुछ सामान्य शब्द बोल रही हूँ: सुबह की चाय, हल्की बारिश, बच्चों की हँसी और शाम की ठंडी हवा।
अंत में, कृपया इस ऑडियो को पूरा सुनें और बताइए कि स्पष्टता, गति और प्राकृतिकता कैसी लगी।`;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function round2(value) {
  return Math.round(value * 100) / 100;
}

function durationSeconds(audio) {
  const sampleRate = Number(audio?.sampling_rate) || 24000;
  const sampleCount = audio?.data?.length || 0;
  return sampleCount / sampleRate;
}

function hasAudioSamples(audio) {
  return audio?.data instanceof Float32Array && audio.data.length > 0;
}

function extractAvailableVoices(tts) {
  const candidateLists = [
    tts?.voices,
    tts?.voice_ids,
    tts?.config?.voices,
    tts?.model?.voices,
  ];
  for (const list of candidateLists) {
    if (Array.isArray(list) && list.length) {
      return list.map((entry) => {
        if (typeof entry === 'string') return entry;
        if (typeof entry?.id === 'string') return entry.id;
        if (typeof entry?.name === 'string') return entry.name;
        return null;
      }).filter(Boolean);
    }
  }
  return [];
}

function buildKokoroDiagnostics({ tts, voiceId, text, audio, runtimeVariant, synthesisError }) {
  const availableVoices = extractAvailableVoices(tts);
  const containsHindiScript = /[\u0900-\u097F]/.test(text);
  const voiceLooksHindi = /^h[fm]_/.test(voiceId);
  const voiceInRegistry = availableVoices.length > 0 ? availableVoices.includes(voiceId) : null;
  const sampleCount = audio?.data?.length || 0;
  const synthesisMessage = String(synthesisError?.message || '');
  const lowerMessage = synthesisMessage.toLowerCase();
  const voiceNotFound = lowerMessage.includes('voice "') && lowerMessage.includes('not found');
  const missingHindiDict = lowerMessage.includes('hi_dict');

  let availableVoicesFromError = [];
  const oneOfIndex = synthesisMessage.indexOf('Should be one of:');
  if (oneOfIndex >= 0) {
    const listText = synthesisMessage.slice(oneOfIndex + 'Should be one of:'.length).trim();
    availableVoicesFromError = listText.split(',').map((entry) => entry.trim()).filter(Boolean);
  }

  const possibleCauses = [];
  if (sampleCount === 0) {
    possibleCauses.push('Kokoro pipeline produced zero PCM samples.');
  }
  if (containsHindiScript && !voiceLooksHindi) {
    possibleCauses.push('Hindi text used with non-Hindi voice id (expected hf_* or hm_*).');
  }
  if (voiceInRegistry === false) {
    possibleCauses.push(`Requested voice "${voiceId}" is not present in loaded voice registry.`);
  }
  if (voiceNotFound) {
    possibleCauses.push(`Requested voice "${voiceId}" is not available in this Kokoro model package.`);
  }
  if (containsHindiScript && voiceLooksHindi && voiceNotFound) {
    possibleCauses.push('Loaded Kokoro model appears to be English-only and missing Hindi voices.');
  }
  if (String(synthesisError?.message || '').toLowerCase().includes('phonem')) {
    possibleCauses.push('Phonemizer assets appear missing or failed to load.');
  }
  if (missingHindiDict) {
    possibleCauses.push('Hindi espeak-ng dictionary (hi_dict) is missing from system phonemizer assets.');
  }
  if (!possibleCauses.length) {
    possibleCauses.push('Unknown synthesis regression in Kokoro runtime path.');
  }

  return {
    runtimeVariant,
    voiceId,
    textLength: text.length,
    containsHindiScript,
    voiceLooksHindi,
    voiceRegistry: {
      count: availableVoices.length,
      hasRequestedVoice: voiceInRegistry,
      sample: availableVoices.slice(0, 16),
      fromError: availableVoicesFromError.slice(0, 32),
    },
    audio: {
      sampleCount,
      sampleRate: Number(audio?.sampling_rate) || null,
    },
    synthesisErrorMessage: synthesisMessage || null,
    possibleCauses,
    recommendedChecks: [
      'Confirm requested voice exists in the loaded model package (or override via VF_KOKORO_TEST_VOICE).',
      'For Hindi text, use Hindi-capable model/voices (hf_alpha, hf_beta, hm_omega, hm_psi).',
      'Re-download model cache if voices/phonemizer files are corrupted.',
      'Install/verify espeak-ng language data so hi_dict is available.',
      'Run all-engine runtime audit to verify runtime orchestration before Kokoro test.',
    ],
  };
}

function floatTo16BitPCM(view, offset, input) {
  for (let i = 0; i < input.length; i++, offset += 2) {
    const s = Math.max(-1, Math.min(1, input[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
}

function encodeWav(floatData, sampleRate = 24000) {
  const numChannels = 1;
  const bitsPerSample = 16;
  const blockAlign = numChannels * (bitsPerSample / 8);
  const byteRate = sampleRate * blockAlign;
  const dataSize = floatData.length * 2;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  const writeString = (offset, str) => {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  };

  writeString(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  writeString(36, 'data');
  view.setUint32(40, dataSize, true);

  floatTo16BitPCM(view, 44, floatData);
  return Buffer.from(buffer);
}

async function saveAudioWav(audio, outputPath) {
  if (typeof audio?.save === 'function') {
    await audio.save(outputPath);
    return;
  }

  const sampleRate = Number(audio?.sampling_rate) || 24000;
  const floatData = audio?.data instanceof Float32Array ? audio.data : null;
  if (!floatData || floatData.length === 0) {
    throw new Error('Kokoro returned empty audio data.');
  }

  const wav = encodeWav(floatData, sampleRate);
  await fs.writeFile(outputPath, wav);
}

function resampleLinear(input, srcRate, dstRate) {
  if (srcRate === dstRate) return input;

  const ratio = srcRate / dstRate;
  const outputLength = Math.max(1, Math.round(input.length / ratio));
  const output = new Float32Array(outputLength);

  for (let i = 0; i < outputLength; i++) {
    const position = i * ratio;
    const left = Math.floor(position);
    const right = Math.min(left + 1, input.length - 1);
    const frac = position - left;
    output[i] = input[left] * (1 - frac) + input[right] * frac;
  }

  return output;
}

async function synthesizeAtSpeed(tts, speed) {
  const start = performance.now();
  const audio = await tts.generate(HINDI_TEST_TEXT, {
    voice: VOICE_ID,
    speed,
  });

  const duration = durationSeconds(audio);
  return {
    audio,
    speed,
    duration,
    elapsedMs: performance.now() - start,
  };
}

async function main() {
  let KokoroTTS;
  let env;
  let pipeline;
  let runtimeVariant = 'node';

  try {
    ({ KokoroTTS } = await import('kokoro-js'));
    ({ env, pipeline } = await import('@huggingface/transformers'));
  } catch (nodeImportError) {
    runtimeVariant = 'web-fallback';
    ({ KokoroTTS } = await import('../node_modules/kokoro-js/dist/kokoro.web.js'));
    ({ env, pipeline } = await import('../node_modules/@huggingface/transformers/dist/transformers.web.js'));
    console.warn(`Falling back to web runtime due node import failure: ${nodeImportError?.message || nodeImportError}`);
  }

  await fs.mkdir(ARTIFACT_DIR, { recursive: true });

  env.allowRemoteModels = true;
  env.allowLocalModels = false;
  env.useBrowserCache = false;

  const runtimeStart = performance.now();
  const loadStart = performance.now();

  const tts = await KokoroTTS.from_pretrained(MODEL_ID, {
    dtype: 'q8',
    device: 'cpu',
    progress_callback: (progress) => {
      if (progress?.status === 'progress' && typeof progress.progress === 'number') {
        const pctRaw = progress.progress <= 1 ? progress.progress * 100 : progress.progress;
        const pct = Math.round(pctRaw);
        if (pct % 20 === 0) {
          console.log(`[kokoro] model load ${pct}%`);
        }
      }
    },
  });

  const modelLoadMs = performance.now() - loadStart;

  let synthesisError = null;
  let initial;
  try {
    initial = await synthesizeAtSpeed(tts, 1.0);
  } catch (error) {
    synthesisError = error;
    const diagnostics = buildKokoroDiagnostics({
      tts,
      voiceId: VOICE_ID,
      text: HINDI_TEST_TEXT,
      audio: null,
      runtimeVariant,
      synthesisError,
    });
    const wrapped = new Error(`Kokoro synthesis failed: ${error?.message || String(error)}`);
    wrapped.diagnostics = diagnostics;
    throw wrapped;
  }
  let final = initial;
  const attempts = [
    {
      speed: initial.speed,
      duration: initial.duration,
      elapsedMs: initial.elapsedMs,
      reason: 'initial',
    },
  ];

  if (initial.duration < MIN_SECONDS || initial.duration > MAX_SECONDS) {
    const adjustedSpeed = round2(clamp(initial.duration / TARGET_SECONDS, 0.7, 1.6));
    const adjusted = await synthesizeAtSpeed(tts, adjustedSpeed);
    attempts.push({
      speed: adjusted.speed,
      duration: adjusted.duration,
      elapsedMs: adjusted.elapsedMs,
      reason: 'auto-adjusted',
    });

    final = Math.abs(adjusted.duration - TARGET_SECONDS) < Math.abs(initial.duration - TARGET_SECONDS)
      ? adjusted
      : initial;
  }

  if (!hasAudioSamples(final.audio)) {
    const diagnostics = buildKokoroDiagnostics({
      tts,
      voiceId: VOICE_ID,
      text: HINDI_TEST_TEXT,
      audio: final.audio,
      runtimeVariant,
      synthesisError,
    });
    const error = new Error('Kokoro returned zero-length audio data.');
    error.diagnostics = diagnostics;
    throw error;
  }

  await saveAudioWav(final.audio, WAV_PATH);

  const kokoroFloat = final.audio?.data instanceof Float32Array ? final.audio.data : new Float32Array();
  const kokoroSampleRate = Number(final.audio?.sampling_rate) || 24000;
  const asrInput = resampleLinear(kokoroFloat, kokoroSampleRate, 16000);

  const asrStart = performance.now();
  const transcriber = await pipeline('automatic-speech-recognition', ASR_MODEL_ID);
  const asrOutput = await transcriber(asrInput, {
    language: 'hindi',
    task: 'transcribe',
    chunk_length_s: 30,
    stride_length_s: 5,
  });
  const asrMs = performance.now() - asrStart;

  const transcript = typeof asrOutput?.text === 'string'
    ? asrOutput.text.trim()
    : '';

  const durationOk = final.duration >= MIN_SECONDS && final.duration <= MAX_SECONDS;
  const transcriptOk = transcript.length > 0;
  const diagnostics = buildKokoroDiagnostics({
    tts,
    voiceId: VOICE_ID,
    text: HINDI_TEST_TEXT,
    audio: final.audio,
    runtimeVariant,
    synthesisError,
  });

  const report = {
    timestamp: new Date().toISOString(),
    artifacts: {
      wav: path.relative(ROOT, WAV_PATH),
      report: path.relative(ROOT, REPORT_PATH),
    },
    config: {
      kokoroModel: MODEL_ID,
      asrModel: ASR_MODEL_ID,
      voiceId: VOICE_ID,
      targetSeconds: TARGET_SECONDS,
      acceptableBand: [MIN_SECONDS, MAX_SECONDS],
      text: HINDI_TEST_TEXT,
    },
    synthesis: {
      selectedSpeed: final.speed,
      selectedDurationSeconds: final.duration,
      attempts,
      sampleRate: kokoroSampleRate,
      sampleCount: kokoroFloat.length,
      modelLoadMs,
    },
    asr: {
      transcript,
      transcriptLength: transcript.length,
      elapsedMs: asrMs,
    },
    diagnostics,
    validation: {
      durationInRange: durationOk,
      transcriptNonEmpty: transcriptOk,
      passed: durationOk && transcriptOk,
      manualUiChecklist: [
        'In Studio, choose Kokoro Local engine.',
        'Paste the same Hindi test text from this report.',
        'Generate audio and confirm playback succeeds.',
      ],
    },
    runtime: {
      totalMs: performance.now() - runtimeStart,
      node: process.version,
      platform: process.platform,
      arch: process.arch,
      runtimeVariant,
    },
  };

  await fs.writeFile(REPORT_PATH, JSON.stringify(report, null, 2), 'utf8');

  console.log('Kokoro Hindi 30s test complete.');
  console.log(`WAV: ${path.relative(ROOT, WAV_PATH)}`);
  console.log(`Report: ${path.relative(ROOT, REPORT_PATH)}`);
  console.log(`Duration: ${final.duration.toFixed(2)}s (target ${MIN_SECONDS}-${MAX_SECONDS}s)`);
  console.log(`Transcript length: ${transcript.length}`);
  console.log(`Validation passed: ${report.validation.passed}`);

  if (!report.validation.passed) {
    process.exitCode = 1;
  }
}

main().catch(async (error) => {
  const diagnostics = error?.diagnostics || null;
  const failReport = {
    timestamp: new Date().toISOString(),
    error: {
      message: error?.message || String(error),
      stack: error?.stack || null,
    },
    diagnostics,
  };

  try {
    await fs.mkdir(ARTIFACT_DIR, { recursive: true });
    await fs.writeFile(REPORT_PATH, JSON.stringify(failReport, null, 2), 'utf8');
  } catch {
    // ignore secondary failure
  }

  console.error('Kokoro Hindi 30s test failed.');
  console.error(error);
  process.exitCode = 1;
});
