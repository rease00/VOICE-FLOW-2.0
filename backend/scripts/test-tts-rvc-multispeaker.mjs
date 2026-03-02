#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

const ROOT = process.cwd();
const ARTIFACT_DIR = path.join(ROOT, 'artifacts');
const REPORT_PATH = path.join(ARTIFACT_DIR, 'tts_rvc_multispeaker_report.json');
const AUDIO_DIR = path.join(ARTIFACT_DIR, 'tts_rvc_multispeaker_audio');

const BACKEND_URL = String(process.env.VF_MEDIA_BACKEND_URL || 'http://127.0.0.1:7800').replace(/\/+$/, '');
const TEST_UID = String(process.env.VF_MULTI_TEST_UID || 'local_admin').trim() || 'local_admin';
const WAIT_MS = parsePositiveInt(process.env.VF_MULTI_TEST_WAIT_MS, 25_000, 1_000, 60_000);
const REQUEST_TIMEOUT_MS = parsePositiveInt(process.env.VF_MULTI_TEST_REQUEST_TIMEOUT_MS, 80_000, 5_000, 180_000);
const JOB_POLL_TIMEOUT_MS = parsePositiveInt(process.env.VF_MULTI_TEST_JOB_TIMEOUT_MS, 90_000, 10_000, 300_000);
const JOB_POLL_INTERVAL_MS = parsePositiveInt(process.env.VF_MULTI_TEST_JOB_POLL_MS, 1_200, 200, 5_000);
const GEM_SAMPLE_COUNT = parsePositiveInt(process.env.VF_MULTI_TEST_GEM_COUNT, 6, 1, 30);
const KOKORO_SAMPLE_COUNT = parsePositiveInt(process.env.VF_MULTI_TEST_KOKORO_COUNT, 6, 1, 30);
const SAVE_AUDIO = parseBool(process.env.VF_MULTI_TEST_SAVE_AUDIO, false);
const REQUIRE_POST_RVC = parseBool(process.env.VF_MULTI_TEST_REQUIRE_POST_RVC, false);
const MIN_AUDIO_BYTES = parsePositiveInt(process.env.VF_MULTI_TEST_MIN_AUDIO_BYTES, 512, 64, 32_000);
const GEM_FALLBACK_RUNTIME_VOICES = ['achernar', 'charon', 'kore', 'fenrir', 'achird', 'aoede'];

function parsePositiveInt(raw, fallback, min, max) {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  const rounded = Math.round(parsed);
  if (rounded < min) return min;
  if (rounded > max) return max;
  return rounded;
}

function parseBool(raw, fallback) {
  if (raw === undefined || raw === null) return fallback;
  const token = String(raw).trim().toLowerCase();
  if (!token) return fallback;
  if (['1', 'true', 'yes', 'on'].includes(token)) return true;
  if (['0', 'false', 'no', 'off'].includes(token)) return false;
  return fallback;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeHeaders(input) {
  const out = {};
  if (!input || typeof input !== 'object') return out;
  for (const [key, value] of Object.entries(input)) {
    out[String(key || '').toLowerCase()] = String(value ?? '');
  }
  return out;
}

function responseHeadersToObject(headers) {
  const out = {};
  headers.forEach((value, key) => {
    out[String(key || '').toLowerCase()] = String(value ?? '');
  });
  return out;
}

function safeFileName(input, fallback) {
  const candidate = String(input || '').trim();
  if (!candidate) return fallback;
  const sanitized = candidate.replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/^_+/, '').slice(0, 90);
  return sanitized || fallback;
}

function truncateText(value, maxLen = 320) {
  const text = String(value ?? '');
  if (text.length <= maxLen) return text;
  return `${text.slice(0, Math.max(0, maxLen - 3))}...`;
}

async function fetchWithTimeout(url, init = {}, timeoutMs = REQUEST_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function fetchJson(url, timeoutMs = REQUEST_TIMEOUT_MS) {
  const res = await fetchWithTimeout(
    url,
    {
      method: 'GET',
      headers: { Accept: 'application/json' },
    },
    timeoutMs
  );
  const text = await res.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = text;
  }
  if (!res.ok) {
    throw new Error(`${url} -> ${res.status} ${typeof payload === 'string' ? payload : JSON.stringify(payload)}`);
  }
  return payload;
}

function chooseVoices(voices, limit) {
  if (!Array.isArray(voices)) return [];
  const selected = [];
  const seen = new Set();
  for (const voice of voices) {
    if (!voice || typeof voice !== 'object') continue;
    const voiceId = String(voice.voice_id || '').trim();
    if (!voiceId || seen.has(voiceId)) continue;
    seen.add(voiceId);
    selected.push(voice);
    if (selected.length >= limit) break;
  }
  return selected;
}

function withGemFallbackVoices(selectedVoices, limit) {
  const out = Array.isArray(selectedVoices) ? [...selectedVoices] : [];
  const seen = new Set();
  for (const voice of out) {
    const voiceId = String(voice?.voice_id || '').trim().toLowerCase();
    const runtimeVoice = String(voice?.voice || '').trim().toLowerCase();
    if (voiceId) seen.add(`id:${voiceId}`);
    if (runtimeVoice) seen.add(`runtime:${runtimeVoice}`);
  }
  for (const runtimeVoice of GEM_FALLBACK_RUNTIME_VOICES) {
    if (out.length >= limit) break;
    const key = `runtime:${runtimeVoice.toLowerCase()}`;
    if (seen.has(key)) continue;
    out.push({
      voice_id: `fallback_${runtimeVoice}`,
      voice: runtimeVoice,
      name: `Fallback ${runtimeVoice}`,
      source: 'script-fallback',
    });
    seen.add(key);
  }
  return out.slice(0, limit);
}

function resolveGemVoiceName(voice) {
  const runtimeVoice = String(voice?.voice || '').trim();
  if (runtimeVoice) return runtimeVoice;
  const mappedName = String(voice?.mapped_name || voice?.name || '').trim();
  if (mappedName) return mappedName;
  return 'Fenrir';
}

function resolveKokoroVoiceId(voice) {
  return String(voice?.voice_id || voice?.voice || '').trim() || 'hf_alpha';
}

function lookupMappedProfileId(catalog, engine, voice) {
  const engines = catalog?.engines && typeof catalog.engines === 'object' ? catalog.engines : {};
  const enginePayload = engines[engine] && typeof engines[engine] === 'object' ? engines[engine] : {};
  const voiceToProfile =
    enginePayload.voiceToProfile && typeof enginePayload.voiceToProfile === 'object'
      ? enginePayload.voiceToProfile
      : {};
  const candidates = [
    String(voice?.voice_id || '').trim(),
    String(voice?.voice || '').trim(),
    String(voice?.voice_id || '').trim().toLowerCase(),
    String(voice?.voice || '').trim().toLowerCase(),
  ].filter(Boolean);
  for (const key of candidates) {
    const value = String(voiceToProfile[key] || '').trim();
    if (value) return value;
  }
  return '';
}

function ensureAudioBytes(buffer, context) {
  if (!(buffer instanceof Uint8Array) || buffer.byteLength < MIN_AUDIO_BYTES) {
    throw new Error(`${context}: audio payload too small (${buffer?.byteLength || 0} bytes)`);
  }
}

function extractJobId(payload, headers) {
  if (payload && typeof payload === 'object') {
    const jobId = String(payload.jobId || payload.requestId || payload.id || '').trim();
    if (jobId) return jobId;
  }
  const headerJob = String(headers['x-vf-job-id'] || headers['x-vf-request-id'] || '').trim();
  return headerJob;
}

async function pollJobUntilComplete(jobId, report) {
  const deadline = Date.now() + JOB_POLL_TIMEOUT_MS;
  let chunkCursor = 0;
  let liveChunksObserved = 0;
  let liveChunkSeenBeforeComplete = false;
  while (Date.now() < deadline) {
    const res = await fetchWithTimeout(
      `${BACKEND_URL}/tts/jobs/${encodeURIComponent(jobId)}?includeResult=1&includeChunks=1&chunkCursor=${encodeURIComponent(String(chunkCursor))}&chunkLimit=2&includeChunkAudio=0`,
      {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          'x-dev-uid': TEST_UID,
        },
      },
      REQUEST_TIMEOUT_MS
    );
    const text = await res.text();
    let payload = null;
    try {
      payload = text ? JSON.parse(text) : null;
    } catch {
      payload = text;
    }
    if (!res.ok) {
      throw new Error(`poll ${jobId} -> ${res.status} ${typeof payload === 'string' ? payload : JSON.stringify(payload)}`);
    }
    const chunks = Array.isArray(payload?.chunks) ? payload.chunks : [];
    if (chunks.length > 0) {
      liveChunkSeenBeforeComplete = true;
      const maxIndex = chunks.reduce((max, item) => {
        const idx = Number(item?.index);
        if (!Number.isFinite(idx)) return max;
        return Math.max(max, Math.round(idx));
      }, -1);
      if (maxIndex >= 0) chunkCursor = Math.max(chunkCursor, maxIndex + 1);
      liveChunksObserved += chunks.length;
    } else {
      const chunkCursorNext = Number(payload?.chunkCursorNext);
      if (Number.isFinite(chunkCursorNext) && chunkCursorNext > chunkCursor) {
        chunkCursor = Math.round(chunkCursorNext);
      }
    }
    const status = String(payload?.status || '').trim().toLowerCase();
    if (status === 'completed') {
      const result = payload?.result && typeof payload.result === 'object' ? payload.result : null;
      const audioBase64 = String(result?.audioBase64 || '').trim();
      if (!audioBase64) {
        throw new Error(`job ${jobId} completed without audioBase64 result payload`);
      }
      const buffer = Buffer.from(audioBase64, 'base64');
      const headers = normalizeHeaders(result?.headers || {});
      ensureAudioBytes(buffer, `job ${jobId}`);
      return {
        statusCode: 200,
        headers,
        audioBytes: buffer,
        fromJob: true,
        liveChunksObserved,
        liveChunkSeenBeforeComplete,
      };
    }
    if (status === 'failed' || status === 'cancelled') {
      throw new Error(`job ${jobId} ended with status=${status}`);
    }
    await sleep(JOB_POLL_INTERVAL_MS);
  }
  throw new Error(`job ${jobId} did not complete within ${JOB_POLL_TIMEOUT_MS}ms`);
}

function evaluatePostRvcHeaders(headers, report, label) {
  const conversion = String(headers['x-vf-post-tts-conversion'] || '').trim();
  const profile = String(headers['x-vf-post-tts-profile'] || '').trim();
  const model = String(headers['x-vf-post-tts-model'] || '').trim();
  if (REQUIRE_POST_RVC && conversion !== 'rvc') {
    report.failures.push(`${label}: expected x-vf-post-tts-conversion=rvc but got "${conversion || 'missing'}"`);
  } else if (!conversion) {
    report.warnings.push(`${label}: x-vf-post-tts-conversion header missing`);
  }
  if (conversion === 'rvc') {
    if (!profile) report.failures.push(`${label}: missing x-vf-post-tts-profile for rvc conversion`);
    if (!model) report.failures.push(`${label}: missing x-vf-post-tts-model for rvc conversion`);
  }
  return { conversion, profile, model };
}

function buildRequestId(prefix) {
  return `${prefix}_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
}

async function synthesizeOnce(payload, report) {
  const url = `${BACKEND_URL}/tts/synthesize?wait_ms=${encodeURIComponent(String(WAIT_MS))}`;
  const res = await fetchWithTimeout(
    url,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, audio/wav',
        'x-dev-uid': TEST_UID,
      },
      body: JSON.stringify({
        ...payload,
        stream: true,
      }),
    },
    REQUEST_TIMEOUT_MS
  );

  const headers = responseHeadersToObject(res.headers);
  const contentType = String(headers['content-type'] || '').toLowerCase();
  if (res.status === 200 && contentType.includes('audio/')) {
    const audioBytes = Buffer.from(await res.arrayBuffer());
    ensureAudioBytes(audioBytes, payload.request_id || 'tts');
    return { statusCode: 200, headers, audioBytes, fromJob: false, liveChunksObserved: 0, liveChunkSeenBeforeComplete: false };
  }

  const bodyText = await res.text();
  let bodyPayload = null;
  try {
    bodyPayload = bodyText ? JSON.parse(bodyText) : null;
  } catch {
    bodyPayload = bodyText;
  }

  if (res.status === 202) {
    const jobId = extractJobId(bodyPayload, headers);
    if (!jobId) {
      throw new Error(`202 accepted but no job id. body=${JSON.stringify(bodyPayload)}`);
    }
    return pollJobUntilComplete(jobId, report);
  }

  const errorBody = typeof bodyPayload === 'string' ? bodyPayload : JSON.stringify(bodyPayload);
  throw new Error(`synthesize failed (${res.status}) ${truncateText(errorBody, 1200)}`);
}

async function maybeWriteAudio(filename, bytes) {
  if (!SAVE_AUDIO) return;
  await fs.mkdir(AUDIO_DIR, { recursive: true });
  const filePath = path.join(AUDIO_DIR, filename);
  await fs.writeFile(filePath, bytes);
}

async function main() {
  const startedAt = new Date().toISOString();
  const report = {
    startedAt,
    backendUrl: BACKEND_URL,
    testUid: TEST_UID,
    settings: {
      waitMs: WAIT_MS,
      requestTimeoutMs: REQUEST_TIMEOUT_MS,
      jobPollTimeoutMs: JOB_POLL_TIMEOUT_MS,
      jobPollIntervalMs: JOB_POLL_INTERVAL_MS,
      gemSampleCount: GEM_SAMPLE_COUNT,
      kokoroSampleCount: KOKORO_SAMPLE_COUNT,
      saveAudio: SAVE_AUDIO,
      requirePostRvc: REQUIRE_POST_RVC,
    },
    checks: {},
    singleSpeaker: [],
    multiSpeaker: null,
    directRvcGateway: null,
    warnings: [],
    failures: [],
    passed: false,
  };

  let firstAudioForRvc = null;
  const successfulGemRuntimeVoices = [];

  try {
    const [health, status] = await Promise.all([
      fetchJson(`${BACKEND_URL}/health`),
      fetchJson(`${BACKEND_URL}/tts/engines/status`),
    ]);
    let catalog = null;
    try {
      catalog = await fetchJson(`${BACKEND_URL}/tts/voice-mapping/catalog`);
    } catch (error) {
      report.warnings.push(
        `/tts/voice-mapping/catalog unavailable; mapping assertions skipped (${error instanceof Error ? error.message : String(error)})`
      );
    }
    const [gemVoicesPayload, kokoroVoicesPayload] = await Promise.all([
      fetchJson(`${BACKEND_URL}/tts/engines/voices?engine=GEM`),
      fetchJson(`${BACKEND_URL}/tts/engines/voices?engine=KOKORO`),
    ]);
    let rvcModelsPayload = { models: [] };
    try {
      rvcModelsPayload = await fetchJson(`${BACKEND_URL}/rvc/models`);
    } catch (error) {
      report.warnings.push(
        `/rvc/models unavailable; direct /rvc/convert gateway check may be skipped (${error instanceof Error ? error.message : String(error)})`
      );
    }

    report.checks.healthOk = Boolean(health?.ok);
    report.checks.engineStatusOk = Boolean(status?.ok);
    report.checks.rvcModels = Array.isArray(rvcModelsPayload?.models) ? rvcModelsPayload.models : [];
    report.checks.voiceMappingVersion = catalog?.version || null;

    const hasCatalog = Boolean(catalog && typeof catalog === 'object' && catalog.engines && typeof catalog.engines === 'object');

    const gemVoices = withGemFallbackVoices(chooseVoices(gemVoicesPayload?.voices || [], GEM_SAMPLE_COUNT), GEM_SAMPLE_COUNT);
    const kokoroVoices = chooseVoices(kokoroVoicesPayload?.voices || [], KOKORO_SAMPLE_COUNT);
    if (gemVoices.length === 0) report.failures.push('No GEM voices available from /tts/engines/voices');
    if (kokoroVoices.length === 0) report.failures.push('No KOKORO voices available from /tts/engines/voices');

    for (const voice of gemVoices) {
      const runtimeVoice = resolveGemVoiceName(voice);
      const expectedProfileId = hasCatalog ? lookupMappedProfileId(catalog, 'GEM', voice) : '';
      if (hasCatalog && !expectedProfileId) {
        report.failures.push(`GEM voice mapping missing for voice_id=${voice.voice_id}`);
      }
      const requestId = buildRequestId(`gem_${voice.voice_id}`);
      const payload = {
        engine: 'GEM',
        request_id: requestId,
        text: `GEM multi-speaker bank test for ${voice.name || voice.voice_id}. This validates mapped speaker output.`,
        voice_id: runtimeVoice,
        voiceName: runtimeVoice,
        language: 'en',
      };
      try {
        const result = await synthesizeOnce(payload, report);
        if (!firstAudioForRvc) firstAudioForRvc = result.audioBytes;
        const postHeaders = evaluatePostRvcHeaders(result.headers, report, `GEM:${voice.voice_id}`);
        report.singleSpeaker.push({
          engine: 'GEM',
          voiceId: String(voice.voice_id || ''),
          runtimeVoice,
          mappedName: String(voice.name || ''),
          expectedProfileId,
          bytes: result.audioBytes.byteLength,
          fromJob: result.fromJob,
          liveChunksObserved: Number(result.liveChunksObserved || 0),
          liveChunkSeenBeforeComplete: Boolean(result.liveChunkSeenBeforeComplete),
          postTts: postHeaders,
          ok: true,
        });
        if (result.fromJob && !result.liveChunkSeenBeforeComplete) {
          report.failures.push(`GEM ${voice.voice_id}: expected live chunks before completion when stream=true.`);
        }
        if (!successfulGemRuntimeVoices.includes(runtimeVoice)) {
          successfulGemRuntimeVoices.push(runtimeVoice);
        }
        await maybeWriteAudio(
          safeFileName(`gem_${voice.voice_id}_${runtimeVoice}.wav`, `gem_${voice.voice_id}.wav`),
          result.audioBytes
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const looksUnsupportedVoice =
          /voice name/i.test(message) &&
          /not supported/i.test(message) &&
          /(gem|gemini)/i.test(message);
        if (looksUnsupportedVoice) {
          report.singleSpeaker.push({
            engine: 'GEM',
            voiceId: String(voice.voice_id || ''),
            runtimeVoice,
            ok: false,
            skipped: true,
            reason: 'runtime_rejected_voice_name',
            error: truncateText(message, 280),
          });
          report.warnings.push(
            `GEM ${voice.voice_id} skipped: runtime rejected advertised voice "${runtimeVoice}" as unsupported.`
          );
          continue;
        }
        report.singleSpeaker.push({
          engine: 'GEM',
          voiceId: String(voice.voice_id || ''),
          runtimeVoice,
          ok: false,
          error: truncateText(message, 280),
        });
        report.warnings.push(`GEM ${voice.voice_id} failed in this run: ${truncateText(message, 180)}`);
      }
    }

    for (const voice of kokoroVoices) {
      const voiceId = resolveKokoroVoiceId(voice);
      const expectedProfileId = hasCatalog ? lookupMappedProfileId(catalog, 'KOKORO', voice) : '';
      if (hasCatalog && !expectedProfileId) {
        report.failures.push(`KOKORO voice mapping missing for voice_id=${voice.voice_id}`);
      }
      const requestId = buildRequestId(`kokoro_${voice.voice_id}`);
      const payload = {
        engine: 'KOKORO',
        request_id: requestId,
        text: `Kokoro mapped speaker test for ${voice.name || voice.voice_id}.`,
        voice_id: voiceId,
        language: 'en',
      };
      try {
        const result = await synthesizeOnce(payload, report);
        if (!firstAudioForRvc) firstAudioForRvc = result.audioBytes;
        const postHeaders = evaluatePostRvcHeaders(result.headers, report, `KOKORO:${voice.voice_id}`);
        report.singleSpeaker.push({
          engine: 'KOKORO',
          voiceId: String(voice.voice_id || ''),
          runtimeVoice: voiceId,
          mappedName: String(voice.name || ''),
          expectedProfileId,
          bytes: result.audioBytes.byteLength,
          fromJob: result.fromJob,
          liveChunksObserved: Number(result.liveChunksObserved || 0),
          liveChunkSeenBeforeComplete: Boolean(result.liveChunkSeenBeforeComplete),
          postTts: postHeaders,
          ok: true,
        });
        if (result.fromJob && !result.liveChunkSeenBeforeComplete) {
          report.failures.push(`KOKORO ${voice.voice_id}: expected live chunks before completion when stream=true.`);
        }
        await maybeWriteAudio(
          safeFileName(`kokoro_${voice.voice_id}_${voiceId}.wav`, `kokoro_${voice.voice_id}.wav`),
          result.audioBytes
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        report.singleSpeaker.push({
          engine: 'KOKORO',
          voiceId: String(voice.voice_id || ''),
          runtimeVoice: voiceId,
          ok: false,
          error: truncateText(message, 280),
        });
        report.warnings.push(`KOKORO ${voice.voice_id} failed in this run: ${truncateText(message, 180)}`);
      }
    }

    const multiSpeakerCandidates =
      successfulGemRuntimeVoices.length >= 2
        ? [successfulGemRuntimeVoices[0], successfulGemRuntimeVoices[1]]
        : GEM_FALLBACK_RUNTIME_VOICES.slice(0, 2);
    if (multiSpeakerCandidates.length >= 2) {
      const speakerA = String(multiSpeakerCandidates[0] || '').trim();
      const speakerB = String(multiSpeakerCandidates[1] || '').trim();
      if (successfulGemRuntimeVoices.length < 2) {
        report.warnings.push(
          `Using fallback GEM voices for multi-speaker test: ${speakerA}, ${speakerB} (insufficient successful single-speaker GEM voices).`
        );
      }
      const requestId = buildRequestId('gem_multispeaker');
      const multiPayload = {
        engine: 'GEM',
        request_id: requestId,
        text: [
          'Narrator: Welcome to the multi-speaker RVC verification.',
          'Guest: We are testing alternating speaker lines.',
          'Narrator: The output should remain coherent and mapped.',
          'Guest: Conversion should be applied after synthesis.',
        ].join('\n'),
        voice_id: speakerA,
        voiceName: speakerA,
        speaker_voices: [
          { speaker: 'Narrator', voiceName: speakerA },
          { speaker: 'Guest', voiceName: speakerB },
        ],
        multi_speaker_mode: 'studio_pair_groups',
        multi_speaker_max_concurrency: 2,
        multi_speaker_retry_once: true,
        multi_speaker_line_map: [
          { lineIndex: 0, speaker: 'Narrator', text: 'Welcome to the multi-speaker RVC verification.' },
          { lineIndex: 1, speaker: 'Guest', text: 'We are testing alternating speaker lines.' },
          { lineIndex: 2, speaker: 'Narrator', text: 'The output should remain coherent and mapped.' },
          { lineIndex: 3, speaker: 'Guest', text: 'Conversion should be applied after synthesis.' },
        ],
      };
      try {
        const result = await synthesizeOnce(multiPayload, report);
        const postHeaders = evaluatePostRvcHeaders(result.headers, report, 'GEM:multi-speaker');
        report.multiSpeaker = {
          engine: 'GEM',
          speakers: [
            { speaker: 'Narrator', voiceName: speakerA },
            { speaker: 'Guest', voiceName: speakerB },
          ],
          bytes: result.audioBytes.byteLength,
          fromJob: result.fromJob,
          liveChunksObserved: Number(result.liveChunksObserved || 0),
          liveChunkSeenBeforeComplete: Boolean(result.liveChunkSeenBeforeComplete),
          postTts: postHeaders,
          ok: true,
        };
        if (result.fromJob && !result.liveChunkSeenBeforeComplete) {
          report.failures.push('GEM multi-speaker: expected live chunks before completion when stream=true.');
        }
        await maybeWriteAudio('gem_multi_speaker_dialogue.wav', result.audioBytes);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        report.multiSpeaker = {
          engine: 'GEM',
          ok: false,
          error: truncateText(message, 280),
        };
        report.failures.push(`GEM multi-speaker: ${truncateText(message, 280)}`);
      }
    } else {
      report.warnings.push('Skipped GEM multi-speaker dialogue test: no candidate GEM voice pair available.');
    }

    if (firstAudioForRvc) {
      const models = Array.isArray(rvcModelsPayload?.models) ? rvcModelsPayload.models.map((item) => String(item)) : [];
      const fallbackModel = models.includes('vf_low_cpu_timbre') ? 'vf_low_cpu_timbre' : models[0];
      if (fallbackModel) {
        const form = new FormData();
        form.set('file', new Blob([firstAudioForRvc], { type: 'audio/wav' }), 'sample.wav');
        form.set('model_name', fallbackModel);
        form.set('preset', 'tts_realtime');
        const response = await fetchWithTimeout(
          `${BACKEND_URL}/rvc/convert`,
          {
            method: 'POST',
            headers: { 'x-dev-uid': TEST_UID },
            body: form,
          },
          REQUEST_TIMEOUT_MS
        );
        const headers = responseHeadersToObject(response.headers);
        if (!response.ok) {
          const text = await response.text();
          report.failures.push(`/rvc/convert failed (${response.status}) ${text.slice(0, 260)}`);
          report.directRvcGateway = {
            ok: false,
            statusCode: response.status,
            modelName: fallbackModel,
            detail: text.slice(0, 260),
          };
        } else {
          const bytes = Buffer.from(await response.arrayBuffer());
          ensureAudioBytes(bytes, '/rvc/convert');
          report.directRvcGateway = {
            ok: true,
            statusCode: response.status,
            modelName: fallbackModel,
            bytes: bytes.byteLength,
            headers: {
              selected: headers['x-vf-engine-selected'] || '',
              executed: headers['x-vf-engine-executed'] || '',
              preset: headers['x-vf-rvc-preset'] || '',
              fallback: headers['x-vf-rvc-fallback'] || '',
              fallbackReason: headers['x-vf-rvc-fallback-reason'] || '',
            },
          };
          await maybeWriteAudio('rvc_gateway_convert.wav', bytes);
        }
      } else {
        report.warnings.push('Skipped /rvc/convert direct check: no models returned from /rvc/models');
      }
    } else {
      report.warnings.push('Skipped /rvc/convert direct check: no successful synthesis output available.');
    }

    const gemSuccessCount = report.singleSpeaker.filter((item) => item.engine === 'GEM' && item.ok).length;
    const kokoroSuccessCount = report.singleSpeaker.filter((item) => item.engine === 'KOKORO' && item.ok).length;
    report.checks.gemSuccessCount = gemSuccessCount;
    report.checks.kokoroSuccessCount = kokoroSuccessCount;
    report.checks.multiSpeakerOk = Boolean(report.multiSpeaker && report.multiSpeaker.ok);

    if (gemSuccessCount === 0) {
      report.failures.push('No successful GEM single-speaker synthesis cases.');
    }
    if (kokoroSuccessCount === 0) {
      report.failures.push('No successful KOKORO single-speaker synthesis cases.');
    }
    if (!report.multiSpeaker || report.multiSpeaker.ok !== true) {
      report.failures.push('GEM multi-speaker synthesis did not complete successfully.');
    }
  } catch (error) {
    report.failures.push(error instanceof Error ? error.message : String(error));
  }

  report.finishedAt = new Date().toISOString();
  report.passed = report.failures.length === 0;

  await fs.mkdir(ARTIFACT_DIR, { recursive: true });
  await fs.writeFile(REPORT_PATH, JSON.stringify(report, null, 2));

  console.log(`Report written: ${path.relative(ROOT, REPORT_PATH).replace(/\\/g, '/')}`);
  console.log(`Passed: ${report.passed}`);
  console.log(`Single-speaker checks: ${report.singleSpeaker.length}`);
  console.log(`Warnings: ${report.warnings.length}`);
  console.log(`Failures: ${report.failures.length}`);
  if (report.failures.length > 0) {
    for (const failure of report.failures) {
      console.error(`- ${failure}`);
    }
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
