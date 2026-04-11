#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  buildAuditHeaders,
  classifyAuditFailure,
  fetchJsonWithTimeout,
  normalizeBaseUrl,
} from './lib/audit-helpers.mjs';

const ROOT = process.cwd();
const ARTIFACT_PATH = path.join(ROOT, 'artifacts', 'media_backend_audit.json');
const BACKEND_BASE_URL = normalizeBaseUrl(process.env.VF_MEDIA_BACKEND_URL, 'http://127.0.0.1:7800');
const GEMINI_RUNTIME_URL = normalizeBaseUrl(process.env.VF_GEMINI_RUNTIME_URL, 'http://127.0.0.1:7810');
const VECTOR_RUNTIME_URL = normalizeBaseUrl(
  process.env.VF_VECTOR_RUNTIME_URL || process.env.VF_GEM_RUNTIME_URL || process.env.VF_GEMINI_RUNTIME_URL,
  'http://127.0.0.1:7810'
);

const toBlob = async (filePath) => {
  const data = await fs.readFile(filePath);
  return new Blob([data]);
};

const fetchCheck = async (name, url, init, timeoutMs = 15_000) => {
  const result = await fetchJsonWithTimeout(url, init, timeoutMs);
  return {
    name,
    url,
    ok: result.ok,
    status: result.status,
    classification: classifyAuditFailure(result),
    payload: result.payload,
  };
};

const runOptionalUploadCheck = async ({ name, endpoint, authHeaders, fields }) => {
  const form = new FormData();
  for (const field of fields) {
    form.append(field.key, field.blob, field.filename);
  }

  const response = await fetch(`${BACKEND_BASE_URL}${endpoint}`, {
    method: 'POST',
    headers: authHeaders,
    body: form,
  });

  const contentType = String(response.headers.get('content-type') || '').toLowerCase();
  const bytes = await response.arrayBuffer();
  const ok = response.ok && bytes.byteLength > 64;

  return {
    name,
    endpoint,
    ok,
    status: response.status,
    contentType,
    bytes: bytes.byteLength,
  };
};

const main = async () => {
  const report = {
    timestamp: new Date().toISOString(),
    backendBaseUrl: BACKEND_BASE_URL,
    runtimes: {
      GEMINI_RUNTIME: GEMINI_RUNTIME_URL,
      VECTOR_RUNTIME: VECTOR_RUNTIME_URL,
    },
    passed: false,
    checks: [],
    optionalChecks: [],
    summary: {
      failed: 0,
      warnings: [],
      skippedOptional: [],
    },
  };

  const { headers: authHeaders, auth, authError } = buildAuditHeaders(
    { Accept: 'application/json' },
    { scriptName: 'audit:media', defaultDevUid: 'local_admin', throwOnMissingAuth: false },
  );
  report.auth = {
    mode: auth.mode,
    hasAuth: auth.hasAuth,
    requireAuth: auth.requireAuth,
    authEnforced: auth.authEnforced,
    tokenPresent: auth.tokenPresent,
    allowDevUid: auth.allowDevUid,
    devUidApplied: auth.devUidApplied,
    failureReason: auth.failureReason || '',
    guidance: auth.missingAuthMessage,
  };
  if (authError) {
    report.summary.failed += 1;
    report.summary.warnings.push(authError);
  }

  const checks = await Promise.all([
    fetchCheck('backend_health', `${BACKEND_BASE_URL}/health`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
    }),
    fetchCheck('backend_version', `${BACKEND_BASE_URL}/system/version`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
    }),
    fetchCheck('runtime_health_gemini', `${GEMINI_RUNTIME_URL}/health`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
    }),
    fetchCheck('runtime_health_vector', `${VECTOR_RUNTIME_URL}/health`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
    }),
    fetchCheck('tts_queue_metrics', `${BACKEND_BASE_URL}/admin/tts/queue/metrics`, {
      method: 'GET',
      headers: authHeaders,
    }),
  ]);

  report.checks = checks;
  for (const item of checks) {
    if (!item.ok) report.summary.failed += 1;
  }
  const auditVideoPath = String(process.env.VF_AUDIT_VIDEO || '').trim();
  const auditAudioPath = String(process.env.VF_AUDIT_AUDIO || '').trim();
  const uploadAuthHeaders = {};
  for (const [key, value] of Object.entries(authHeaders || {})) {
    const safeKey = String(key || '').trim();
    if (!safeKey || safeKey.toLowerCase() === 'accept') continue;
    uploadAuthHeaders[safeKey] = String(value || '');
  }

  if (auditVideoPath) {
    try {
      await fs.access(auditVideoPath);
      const videoBlob = await toBlob(auditVideoPath);
      const extractResult = await runOptionalUploadCheck({
        name: 'extract_audio_from_video',
        endpoint: '/audio/extract-from-video',
        authHeaders: uploadAuthHeaders,
        fields: [{ key: 'file', blob: videoBlob, filename: path.basename(auditVideoPath) }],
      });
      report.optionalChecks.push(extractResult);
      if (!extractResult.ok) report.summary.failed += 1;

      if (auditAudioPath) {
        await fs.access(auditAudioPath);
        const dubBlob = await toBlob(auditAudioPath);
        const muxResult = await runOptionalUploadCheck({
          name: 'mux_dubbed_video',
          endpoint: '/video/mux-dub',
          authHeaders: uploadAuthHeaders,
          fields: [
            { key: 'video', blob: videoBlob, filename: path.basename(auditVideoPath) },
            { key: 'dub_audio', blob: dubBlob, filename: path.basename(auditAudioPath) },
          ],
        });
        report.optionalChecks.push(muxResult);
        if (!muxResult.ok) report.summary.failed += 1;
      } else {
        report.summary.skippedOptional.push('VF_AUDIT_AUDIO not provided; mux check skipped.');
      }
    } catch (error) {
      report.optionalChecks.push({
        name: 'upload_checks',
        ok: false,
        status: 0,
        detail: error instanceof Error ? error.message : String(error),
      });
      report.summary.failed += 1;
    }
  } else {
    report.summary.skippedOptional.push('VF_AUDIT_VIDEO not provided; upload smoke checks skipped.');
  }

  report.passed = report.summary.failed === 0;
  await fs.mkdir(path.dirname(ARTIFACT_PATH), { recursive: true });
  await fs.writeFile(ARTIFACT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

  console.log(`[audit:media] artifact: ${path.relative(ROOT, ARTIFACT_PATH).replace(/\\/g, '/')}`);
  console.log(`[audit:media] passed=${report.passed}`);

  if (!report.passed) {
    process.exitCode = 1;
  }
};

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
