import fs from 'node:fs/promises';
import path from 'node:path';

const baseUrl = (process.env.VF_MEDIA_BACKEND_URL || 'http://127.0.0.1:7800').replace(/\/+$/, '');
const videoSample = process.env.VF_AUDIT_VIDEO || '';
const audioSample = process.env.VF_AUDIT_AUDIO || '';
const requireRvc = ['1', 'true', 'yes'].includes((process.env.VF_AUDIT_REQUIRE_RVC || '').trim().toLowerCase());

async function getJson(url, options = {}) {
  const res = await fetch(url, options);
  const text = await res.text();
  let payload;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = text;
  }
  if (!res.ok) {
    throw new Error(`${url} -> ${res.status}: ${typeof payload === 'string' ? payload : JSON.stringify(payload)}`);
  }
  return payload;
}

async function fileToBlob(filePath, fallbackType = 'application/octet-stream') {
  const bytes = await fs.readFile(filePath);
  return new Blob([bytes], { type: fallbackType });
}

async function main() {
  const report = {
    timestamp: new Date().toISOString(),
    baseUrl,
    config: {
      requireRvc,
    },
    checks: [],
    passed: false,
  };

  try {
    const health = await getJson(`${baseUrl}/health`);
    report.checks.push({ name: 'health', ok: true, detail: health });

    try {
      const models = await getJson(`${baseUrl}/rvc/models`);
      report.checks.push({ name: 'rvc_models', ok: true, detail: models });
    } catch (error) {
      if (requireRvc) {
        throw error;
      }
      report.checks.push({
        name: 'rvc_models',
        ok: false,
        skipped: true,
        reason: `RVC optional for this audit: ${error instanceof Error ? error.message : String(error)}`,
      });
    }

    if (videoSample) {
      const form = new FormData();
      const blob = await fileToBlob(videoSample, 'video/mp4');
      form.append('file', blob, path.basename(videoSample));
      form.append('language', 'auto');
      form.append('task', 'transcribe');

      const transcribe = await getJson(`${baseUrl}/video/transcribe`, {
        method: 'POST',
        body: form,
      });
      report.checks.push({
        name: 'video_transcribe',
        ok: Boolean(transcribe?.script?.length),
        detail: {
          language: transcribe?.language,
          segmentCount: Array.isArray(transcribe?.segments) ? transcribe.segments.length : 0,
          scriptPreview: (transcribe?.script || '').slice(0, 160),
        },
      });
    } else {
      report.checks.push({ name: 'video_transcribe', ok: false, skipped: true, reason: 'Set VF_AUDIT_VIDEO to run this check.' });
    }

    if (videoSample && audioSample) {
      const form = new FormData();
      form.append('video', await fileToBlob(videoSample, 'video/mp4'), path.basename(videoSample));
      form.append('dub_audio', await fileToBlob(audioSample, 'audio/wav'), path.basename(audioSample));
      form.append('speech_gain', '1.0');
      form.append('background_gain', '0.3');

      const res = await fetch(`${baseUrl}/video/mux-dub`, { method: 'POST', body: form });
      if (!res.ok) {
        throw new Error(`/video/mux-dub -> ${res.status}`);
      }
      const contentType = res.headers.get('content-type') || '';
      report.checks.push({ name: 'video_mux', ok: contentType.includes('video/mp4'), detail: { contentType } });
    } else {
      report.checks.push({ name: 'video_mux', ok: false, skipped: true, reason: 'Set VF_AUDIT_VIDEO and VF_AUDIT_AUDIO to run this check.' });
    }

    const hardFailures = report.checks.filter((c) => c.ok === false && !c.skipped);
    report.passed = hardFailures.length === 0;
  } catch (error) {
    report.error = error instanceof Error ? error.message : String(error);
    report.passed = false;
  }

  await fs.mkdir('artifacts', { recursive: true });
  await fs.writeFile('artifacts/media_backend_audit.json', JSON.stringify(report, null, 2));

  console.log(`Audit report written to artifacts/media_backend_audit.json`);
  console.log(`Passed: ${report.passed}`);

  if (!report.passed) {
    process.exitCode = 1;
  }
}

main();
