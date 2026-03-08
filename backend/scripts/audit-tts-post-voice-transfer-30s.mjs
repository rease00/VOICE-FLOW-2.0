#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import { buildAuditHeaders, normalizeBaseUrl } from './lib/audit-helpers.mjs';
import { ffprobeDurationSeconds, runCommand, validateAudioDecode } from './lib/audio-audit-utils.mjs';

const BACKEND_ROOT = process.cwd();
const WORKSPACE_ROOT = path.resolve(BACKEND_ROOT, '..');

const MEDIA_BACKEND_URL = normalizeBaseUrl(process.env.VF_MEDIA_BACKEND_URL, 'http://127.0.0.1:7800');
const ENGINE = String(process.env.VF_POST_LLVC_AUDIT_ENGINE || 'GEM').trim().toUpperCase() || 'GEM';
const REQUESTED_VOICE_ID = String(process.env.VF_POST_LLVC_AUDIT_VOICE_ID || '').trim();
const LANGUAGE = String(process.env.VF_POST_LLVC_AUDIT_LANGUAGE || 'en').trim() || 'en';
const TARGET_SECONDS = toPositiveNumber(process.env.VF_POST_LLVC_AUDIT_TARGET_SECONDS, 30);
const CHARS_PER_SECOND = toPositiveNumber(process.env.VF_POST_LLVC_AUDIT_CHARS_PER_SEC, 15);
const REQUEST_TIMEOUT_MS = toPositiveInt(process.env.VF_POST_LLVC_AUDIT_TIMEOUT_MS, 120_000, 5_000, 300_000);
const WAIT_MS = toPositiveInt(process.env.VF_POST_LLVC_AUDIT_WAIT_MS, 25_000, 0, 60_000);
const JOB_POLL_TIMEOUT_MS = toPositiveInt(process.env.VF_POST_LLVC_AUDIT_JOB_TIMEOUT_MS, 120_000, 10_000, 600_000);
const JOB_POLL_INTERVAL_MS = toPositiveInt(process.env.VF_POST_LLVC_AUDIT_JOB_POLL_MS, 1_000, 200, 5_000);

const OUTPUT_BASE_DIR = resolveOutputBaseDir(process.env.VF_POST_LLVC_AUDIT_OUTPUT_DIR);
const RUN_ID = toRunId(new Date());
const RUN_DIR = path.join(OUTPUT_BASE_DIR, RUN_ID);

const ORIGINAL_FILE = path.join(RUN_DIR, 'original.wav');
const POST_TTS_LLVC_FILE = path.join(RUN_DIR, 'post_tts_llvc.wav');
const AB_STEREO_FILE = path.join(RUN_DIR, 'ab_stereo_lr.wav');
const REPORT_FILE = path.join(RUN_DIR, 'report.json');

const BASE_TEXT = `This is a neutral speech quality verification sample for post TTS conversion.
We are generating a stable narration to compare original synthesis and LLVC converted synthesis.
Please evaluate clarity, timing consistency, and audible timbre change in a controlled run.
This text intentionally uses plain words and punctuation to reduce linguistic variability.`;

function toPositiveNumber(raw, fallback) {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

function toPositiveInt(raw, fallback, min, max) {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  const rounded = Math.round(parsed);
  if (rounded < min) return min;
  if (rounded > max) return max;
  return rounded;
}

function resolveOutputBaseDir(rawValue) {
  const fallback = path.join(WORKSPACE_ROOT, 'output', 'audit', 'post-tts-llvc-30s');
  const raw = String(rawValue || '').trim();
  if (!raw) return fallback;
  if (path.isAbsolute(raw)) return path.resolve(raw);
  return path.resolve(WORKSPACE_ROOT, raw);
}

function toRunId(date) {
  return date.toISOString().replace(/[:.]/g, '-');
}

function normalizeWhitespace(text) {
  return String(text || '').replace(/\s+/g, ' ').trim();
}

function buildAuditText() {
  const base = normalizeWhitespace(BASE_TEXT);
  const targetChars = Math.max(base.length, Math.round(TARGET_SECONDS * CHARS_PER_SECOND));
  if (base.length >= targetChars) return base;
  const parts = [];
  while (normalizeWhitespace(parts.join(' ')).length < targetChars) {
    parts.push(base);
  }
  return normalizeWhitespace(parts.join(' '));
}

function lowerCaseHeaders(input) {
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

function truncateText(value, maxLen = 600) {
  const text = String(value ?? '');
  if (text.length <= maxLen) return text;
  return `${text.slice(0, Math.max(0, maxLen - 3))}...`;
}

function contentTypeIsAudio(contentType) {
  return String(contentType || '').toLowerCase().includes('audio/');
}

function extractJobId(payload, headers) {
  if (payload && typeof payload === 'object') {
    const candidate = String(payload.jobId || payload.requestId || payload.id || '').trim();
    if (candidate) return candidate;
  }
  const headerCandidate = String(headers['x-vf-job-id'] || headers['x-vf-request-id'] || '').trim();
  if (headerCandidate) return headerCandidate;
  return '';
}

function hashBytes(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function formatRelative(filePath) {
  return path.relative(WORKSPACE_ROOT, filePath).replace(/\\/g, '/');
}

function parseJsonText(raw) {
  const text = String(raw || '');
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

async function fetchJson(url, init = {}, timeoutMs = REQUEST_TIMEOUT_MS) {
  const response = await fetchWithTimeout(url, init, timeoutMs);
  const raw = await response.text();
  const parsed = parseJsonText(raw);
  return {
    ok: response.ok,
    status: response.status,
    payload: parsed,
    headers: responseHeadersToObject(response.headers),
  };
}

async function pollJobUntilComplete(jobId, authHeaders) {
  const deadline = Date.now() + JOB_POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const url =
      `${MEDIA_BACKEND_URL}/tts/jobs/${encodeURIComponent(jobId)}` +
      '?includeResult=1&includeChunks=1&chunkCursor=0&chunkLimit=2&includeChunkAudio=0';
    const probe = await fetchJson(url, { method: 'GET', headers: authHeaders }, REQUEST_TIMEOUT_MS);
    if (!probe.ok) {
      throw new Error(`job_poll_failed status=${probe.status} detail=${truncateText(JSON.stringify(probe.payload), 280)}`);
    }
    const status = String(probe.payload?.status || '').trim().toLowerCase();
    if (status === 'completed') {
      const result = probe.payload?.result && typeof probe.payload.result === 'object' ? probe.payload.result : null;
      const audioBase64 = String(result?.audioBase64 || '').trim();
      if (!audioBase64) {
        throw new Error(`job_completed_without_audio_base64 jobId=${jobId}`);
      }
      const audioBytes = Buffer.from(audioBase64, 'base64');
      if (!(audioBytes instanceof Uint8Array) || audioBytes.byteLength < 100) {
        throw new Error(`job_audio_too_small jobId=${jobId} bytes=${audioBytes?.byteLength || 0}`);
      }
      return {
        statusCode: 200,
        fromJob: true,
        jobId,
        headers: lowerCaseHeaders(result?.headers || {}),
        audioBytes,
      };
    }
    if (status === 'failed' || status === 'cancelled') {
      throw new Error(
        `job_terminal_failure status=${status} detail=${truncateText(JSON.stringify(probe.payload?.error || probe.payload), 320)}`
      );
    }
    await sleep(JOB_POLL_INTERVAL_MS);
  }
  throw new Error(`job_timeout jobId=${jobId} timeoutMs=${JOB_POLL_TIMEOUT_MS}`);
}

async function synthesizeOnce(payload, authHeaders) {
  const url = `${MEDIA_BACKEND_URL}/tts/synthesize?wait_ms=${encodeURIComponent(String(WAIT_MS))}`;
  const response = await fetchWithTimeout(
    url,
    {
      method: 'POST',
      headers: {
        ...authHeaders,
        'Content-Type': 'application/json',
        Accept: 'application/json, audio/wav',
      },
      body: JSON.stringify(payload),
    },
    REQUEST_TIMEOUT_MS
  );

  const headers = responseHeadersToObject(response.headers);
  const contentType = String(headers['content-type'] || '');

  if (response.status === 200 && contentTypeIsAudio(contentType)) {
    const audioBytes = Buffer.from(await response.arrayBuffer());
    if (audioBytes.byteLength < 100) {
      throw new Error(`sync_audio_too_small bytes=${audioBytes.byteLength}`);
    }
    return {
      statusCode: 200,
      fromJob: false,
      jobId: '',
      headers,
      audioBytes,
    };
  }

  const rawText = await response.text();
  const parsed = parseJsonText(rawText);
  if (response.status === 202) {
    const jobId = extractJobId(parsed, headers);
    if (!jobId) {
      throw new Error(`accepted_without_job_id detail=${truncateText(rawText, 300)}`);
    }
    return pollJobUntilComplete(jobId, authHeaders);
  }

  throw new Error(`synthesize_failed status=${response.status} detail=${truncateText(rawText, 700)}`);
}

async function ensureAudioArtifact(filePath) {
  const stat = await fs.stat(filePath);
  if (!stat.isFile()) {
    throw new Error(`not_a_file ${filePath}`);
  }
  if (stat.size < 100) {
    throw new Error(`audio_file_too_small file=${filePath} bytes=${stat.size}`);
  }
  const decode = await validateAudioDecode(filePath);
  if (!decode.ok) {
    throw new Error(`audio_decode_failed file=${filePath} detail=${truncateText(decode.error, 400)}`);
  }
  const durationSeconds = await ffprobeDurationSeconds(filePath);
  return {
    bytes: stat.size,
    durationSeconds: round3(durationSeconds),
    decodeOk: true,
  };
}

async function buildStereoAbFile(originalFile, convertedFile, outputFile) {
  const command = await runCommand(
    'ffmpeg',
    [
      '-y',
      '-hide_banner',
      '-loglevel',
      'error',
      '-i',
      originalFile,
      '-i',
      convertedFile,
      '-filter_complex',
      '[0:a]aformat=sample_fmts=fltp:channel_layouts=mono[a0];[1:a]aformat=sample_fmts=fltp:channel_layouts=mono[a1];[a0][a1]amerge=inputs=2[a]',
      '-map',
      '[a]',
      '-ac',
      '2',
      outputFile,
    ],
    { timeoutMs: 120_000 }
  );
  if (!command.ok) {
    const detail = truncateText(command.stderr || command.stdout || 'ffmpeg merge failed', 600);
    throw new Error(`ffmpeg_merge_failed detail=${detail}`);
  }
}

function round3(value) {
  const safe = Number(value);
  if (!Number.isFinite(safe)) return null;
  return Math.round(safe * 1000) / 1000;
}

async function main() {
  const startedAt = new Date().toISOString();
  await fs.mkdir(RUN_DIR, { recursive: true });

  const report = {
    schemaVersion: '1.0.0',
    startedAt,
    finishedAt: null,
    passed: false,
    backendUrl: MEDIA_BACKEND_URL,
    runDir: formatRelative(RUN_DIR),
    files: {
      original: formatRelative(ORIGINAL_FILE),
      postTtsLlvc: formatRelative(POST_TTS_LLVC_FILE),
      abStereo: formatRelative(AB_STEREO_FILE),
      report: formatRelative(REPORT_FILE),
    },
    config: {
      engine: ENGINE,
      requestedVoiceId: REQUESTED_VOICE_ID || null,
      language: LANGUAGE,
      targetSeconds: TARGET_SECONDS,
      charsPerSecond: CHARS_PER_SECOND,
      requestTimeoutMs: REQUEST_TIMEOUT_MS,
      waitMs: WAIT_MS,
      jobPollTimeoutMs: JOB_POLL_TIMEOUT_MS,
      jobPollIntervalMs: JOB_POLL_INTERVAL_MS,
      outputBaseDir: formatRelative(OUTPUT_BASE_DIR),
    },
    auth: {
      mode: 'unknown',
      tokenPresent: false,
      allowDevUid: false,
      devUid: null,
    },
    preflight: {
      checks: [],
      health: null,
      engineStatus: null,
      voicesCount: 0,
      resolvedVoice: null,
      ok: false,
    },
    requests: {
      original: null,
      postTtsLlvc: null,
    },
    artifacts: {
      original: null,
      postTtsLlvc: null,
      abStereo: null,
    },
    checks: {
      postTtsConversionHeader: null,
      postTtsProfileHeader: null,
      postTtsModelHeader: null,
    },
    warnings: [],
    failures: [],
  };

  try {
    let auditAuthHeaders = {};
    try {
      const authResult = buildAuditHeaders(
        { Accept: 'application/json' },
        { scriptName: 'audit:tts:post-voice-transfer:30s', defaultDevUid: 'local_admin' }
      );
      auditAuthHeaders = authResult.headers;
      report.auth = {
        mode: authResult.auth.mode,
        tokenPresent: Boolean(authResult.auth.tokenPresent),
        allowDevUid: Boolean(authResult.auth.allowDevUid),
        devUid: String(authResult.auth.devUid || '').trim() || null,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      report.failures.push(message);
      throw error instanceof Error ? error : new Error(message);
    }

    const health = await fetchJson(`${MEDIA_BACKEND_URL}/health`, { method: 'GET', headers: auditAuthHeaders }, 12_000);
    report.preflight.health = {
      status: health.status,
      ok: health.ok,
      llvcAvailable: Boolean(health.payload?.llvc?.available),
      llvcError: String(health.payload?.llvc?.error || '').trim() || null,
    };
    report.preflight.checks.push({
      name: 'health',
      ok: health.ok,
      status: health.status,
      detail: health.ok ? '' : truncateText(JSON.stringify(health.payload), 280),
    });
    if (!health.ok) {
      report.failures.push(`preflight_health_failed status=${health.status}`);
    } else if (!health.payload?.llvc?.available) {
      report.failures.push(`preflight_llvc_unavailable detail=${String(health.payload?.llvc?.error || '').trim() || 'unknown'}`);
    }

    const engineStatus = await fetchJson(
      `${MEDIA_BACKEND_URL}/tts/engines/status`,
      { method: 'GET', headers: auditAuthHeaders },
      12_000
    );
    const selectedEngine = engineStatus.payload?.engines?.[ENGINE];
    report.preflight.engineStatus = {
      status: engineStatus.status,
      ok: engineStatus.ok,
      selectedEngine,
    };
    report.preflight.checks.push({
      name: 'enginesStatus',
      ok: engineStatus.ok,
      status: engineStatus.status,
      detail: engineStatus.ok ? '' : truncateText(JSON.stringify(engineStatus.payload), 280),
    });
    if (!engineStatus.ok) {
      report.failures.push(`preflight_engine_status_failed status=${engineStatus.status}`);
    } else if (!selectedEngine || !selectedEngine.ready) {
      report.failures.push(`preflight_engine_not_ready engine=${ENGINE}`);
    }

    const voicesPayload = await fetchJson(
      `${MEDIA_BACKEND_URL}/tts/engines/voices?engine=${encodeURIComponent(ENGINE)}`,
      { method: 'GET', headers: auditAuthHeaders },
      12_000
    );
    report.preflight.checks.push({
      name: 'voices',
      ok: voicesPayload.ok,
      status: voicesPayload.status,
      detail: voicesPayload.ok ? '' : truncateText(JSON.stringify(voicesPayload.payload), 280),
    });
    if (!voicesPayload.ok) {
      report.failures.push(`preflight_voices_failed status=${voicesPayload.status}`);
    }

    const voices = Array.isArray(voicesPayload.payload?.voices) ? voicesPayload.payload.voices : [];
    report.preflight.voicesCount = voices.length;
    if (voices.length === 0) {
      report.failures.push(`no_voices_available engine=${ENGINE}`);
    }

    let resolvedVoice = null;
    const normalizedRequested = REQUESTED_VOICE_ID.toLowerCase();
    if (normalizedRequested) {
      resolvedVoice = voices.find((voice) => {
        const voiceId = String(voice?.voice_id || '').trim().toLowerCase();
        const runtimeVoice = String(voice?.voice || '').trim().toLowerCase();
        const displayName = String(voice?.name || '').trim().toLowerCase();
        return normalizedRequested === voiceId || normalizedRequested === runtimeVoice || normalizedRequested === displayName;
      });
      if (!resolvedVoice) {
        report.failures.push(`requested_voice_not_found requested=${REQUESTED_VOICE_ID} engine=${ENGINE}`);
      }
    } else {
      resolvedVoice =
        voices.find((voice) => String(voice?.voice_id || '').trim().toLowerCase() === 'v1') ||
        voices.find((voice) => String(voice?.profile_id || '').trim()) ||
        voices[0] ||
        null;
    }

    if (!resolvedVoice) {
      throw new Error('voice_resolution_failed');
    }

    report.preflight.resolvedVoice = {
      voice_id: String(resolvedVoice.voice_id || '').trim(),
      runtimeVoice: String(resolvedVoice.voice || '').trim(),
      name: String(resolvedVoice.name || '').trim(),
      profile_id: String(resolvedVoice.profile_id || '').trim() || null,
      source: String(resolvedVoice.source || '').trim() || null,
    };

    const resolvedVoiceId = String(resolvedVoice.voice_id || '').trim();
    const resolvedVoiceName = String(resolvedVoice.voice || resolvedVoice.name || '').trim();
    if (!resolvedVoiceId) {
      report.failures.push('resolved_voice_missing_voice_id');
      throw new Error('resolved_voice_missing_voice_id');
    }

    report.preflight.ok = report.failures.length === 0;
    if (!report.preflight.ok) {
      throw new Error('preflight_failed');
    }

    const text = buildAuditText();
    const basePayload = {
      engine: ENGINE,
      text,
      language: LANGUAGE,
      voice_id: resolvedVoiceId,
      voiceId: resolvedVoiceId,
    };
    if (ENGINE === 'GEM' && resolvedVoiceName) {
      basePayload.voiceName = resolvedVoiceName;
    }

    const originalPayload = {
      ...basePayload,
      post_tts_disable: true,
    };
    const originalResult = await synthesizeOnce(originalPayload, auditAuthHeaders);
    await fs.writeFile(ORIGINAL_FILE, originalResult.audioBytes);
    const originalArtifact = await ensureAudioArtifact(ORIGINAL_FILE);
    report.requests.original = {
      statusCode: originalResult.statusCode,
      fromJob: originalResult.fromJob,
      jobId: originalResult.jobId || null,
      headers: originalResult.headers,
      responseBytes: originalResult.audioBytes.byteLength,
      sha256: hashBytes(originalResult.audioBytes),
    };
    report.artifacts.original = {
      ...originalArtifact,
      file: formatRelative(ORIGINAL_FILE),
    };

    const postPayload = {
      ...basePayload,
      post_tts_disable: false,
    };
    const postResult = await synthesizeOnce(postPayload, auditAuthHeaders);
    await fs.writeFile(POST_TTS_LLVC_FILE, postResult.audioBytes);
    const postArtifact = await ensureAudioArtifact(POST_TTS_LLVC_FILE);
    report.requests.postTtsLlvc = {
      statusCode: postResult.statusCode,
      fromJob: postResult.fromJob,
      jobId: postResult.jobId || null,
      headers: postResult.headers,
      responseBytes: postResult.audioBytes.byteLength,
      sha256: hashBytes(postResult.audioBytes),
    };
    report.artifacts.postTtsLlvc = {
      ...postArtifact,
      file: formatRelative(POST_TTS_LLVC_FILE),
    };

    const conversionHeader = String(postResult.headers['x-vf-post-tts-conversion'] || '').trim();
    const profileHeader = String(postResult.headers['x-vf-post-tts-profile'] || '').trim();
    const modelHeader = String(postResult.headers['x-vf-post-tts-model'] || '').trim();
    report.checks.postTtsConversionHeader = conversionHeader || null;
    report.checks.postTtsProfileHeader = profileHeader || null;
    report.checks.postTtsModelHeader = modelHeader || null;

    if (conversionHeader !== 'llvc') {
      report.failures.push(`expected_post_tts_conversion_llvc got=${conversionHeader || 'missing'}`);
    }
    if (!profileHeader) {
      report.failures.push('missing_x_vf_post_tts_profile');
    }
    if (!modelHeader) {
      report.failures.push('missing_x_vf_post_tts_model');
    }
    if (conversionHeader.startsWith('disabled') || conversionHeader.startsWith('bypassed')) {
      report.failures.push(`post_tts_conversion_not_applied conversion=${conversionHeader}`);
    }

    await buildStereoAbFile(ORIGINAL_FILE, POST_TTS_LLVC_FILE, AB_STEREO_FILE);
    const abArtifact = await ensureAudioArtifact(AB_STEREO_FILE);
    const abBytes = await fs.readFile(AB_STEREO_FILE);
    report.artifacts.abStereo = {
      ...abArtifact,
      file: formatRelative(AB_STEREO_FILE),
      sha256: hashBytes(abBytes),
    };

    const warnMin = TARGET_SECONDS * 0.8;
    const warnMax = TARGET_SECONDS * 1.25;
    const originalDuration = Number(report.artifacts.original?.durationSeconds || 0);
    const postDuration = Number(report.artifacts.postTtsLlvc?.durationSeconds || 0);
    if (originalDuration && (originalDuration < warnMin || originalDuration > warnMax)) {
      report.warnings.push(
        `original_duration_outside_warning_band duration=${round3(originalDuration)}s expected=${round3(warnMin)}-${round3(warnMax)}s`
      );
    }
    if (postDuration && (postDuration < warnMin || postDuration > warnMax)) {
      report.warnings.push(
        `post_tts_duration_outside_warning_band duration=${round3(postDuration)}s expected=${round3(warnMin)}-${round3(warnMax)}s`
      );
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    if (!report.failures.includes(reason)) {
      report.failures.push(reason);
    }
  } finally {
    report.finishedAt = new Date().toISOString();
    report.passed = report.failures.length === 0;
    await fs.writeFile(REPORT_FILE, JSON.stringify(report, null, 2), 'utf8');

    console.log(`Output directory: ${formatRelative(RUN_DIR)}`);
    console.log(`Report: ${formatRelative(REPORT_FILE)}`);
    console.log(`Passed: ${report.passed}`);
    console.log(`Warnings: ${report.warnings.length}`);
    console.log(`Failures: ${report.failures.length}`);
    if (report.failures.length > 0) {
      for (const failure of report.failures) {
        console.error(`- ${failure}`);
      }
      process.exitCode = 1;
    }
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
