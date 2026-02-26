#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';

const ROOT = process.cwd();
const REPORT_PATH = path.join(ROOT, 'artifacts', 'runtime_contract_conformance_report.json');
const MEDIA_BACKEND_URL = String(process.env.VF_MEDIA_BACKEND_URL || 'http://127.0.0.1:7800').replace(/\/+$/, '');

const requiredTopLevel = [
  'engine',
  'runtime',
  'ready',
  'languages',
  'speed',
  'supportsEmotion',
  'supportsStyle',
  'supportsSpeakerWav',
];

const isFiniteNumber = (value) => Number.isFinite(Number(value));

const ensureObject = (value) => value && typeof value === 'object' && !Array.isArray(value);

const fetchJson = async (url, timeoutMs = 12000) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
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
  } finally {
    clearTimeout(timer);
  }
};

const validateCapabilitiesPayload = (engine, payload) => {
  const violations = [];
  if (!ensureObject(payload)) {
    violations.push('payload_not_object');
    return violations;
  }

  for (const key of requiredTopLevel) {
    if (!(key in payload)) {
      violations.push(`missing_${key}`);
    }
  }

  if (!Array.isArray(payload.languages) || payload.languages.length === 0) {
    violations.push('languages_invalid');
  }

  if (!ensureObject(payload.speed)) {
    violations.push('speed_invalid');
  } else {
    const min = Number(payload.speed.min);
    const max = Number(payload.speed.max);
    const def = Number(payload.speed.default);
    if (!isFiniteNumber(min) || !isFiniteNumber(max) || !isFiniteNumber(def)) {
      violations.push('speed_numbers_invalid');
    }
    if (isFiniteNumber(min) && isFiniteNumber(max) && min > max) {
      violations.push('speed_range_invalid');
    }
    if (isFiniteNumber(def) && isFiniteNumber(min) && isFiniteNumber(max) && (def < min || def > max)) {
      violations.push('speed_default_out_of_range');
    }
  }

  const normalizedEngine = String(payload.engine || '').trim().toUpperCase();
  if (normalizedEngine && normalizedEngine !== engine) {
    if (!(engine === 'GEM' && normalizedEngine === 'GEMINI')) {
      violations.push(`engine_mismatch_${normalizedEngine}`);
    }
  }

  return violations;
};

const main = async () => {
  const startedAt = new Date().toISOString();
  const report = {
    startedAt,
    mediaBackendUrl: MEDIA_BACKEND_URL,
    passed: false,
    checks: [],
    failures: [],
  };

  try {
    const payload = await fetchJson(`${MEDIA_BACKEND_URL}/tts/engines/capabilities`, 15000);
    if (!ensureObject(payload) || !ensureObject(payload.engines)) {
      throw new Error('Invalid /tts/engines/capabilities payload.');
    }
    const engines = payload.engines;
    for (const engine of ['GEM', 'KOKORO', 'XTTS']) {
      const cap = engines[engine];
      const violations = validateCapabilitiesPayload(engine, cap);
      report.checks.push({
        engine,
        ok: violations.length === 0,
        violations,
        sample: cap || null,
      });
      if (violations.length > 0) {
        report.failures.push(`${engine}: ${violations.join(', ')}`);
      }
    }

    report.passed = report.failures.length === 0;
  } catch (error) {
    report.failures.push(error instanceof Error ? error.message : String(error));
    report.passed = false;
  }

  report.finishedAt = new Date().toISOString();
  await fs.mkdir(path.dirname(REPORT_PATH), { recursive: true });
  await fs.writeFile(REPORT_PATH, JSON.stringify(report, null, 2));
  console.log(`Contract report written to ${path.relative(ROOT, REPORT_PATH).replace(/\\/g, '/')}`);
  console.log(`Passed: ${report.passed}`);
  if (!report.passed) {
    process.exitCode = 1;
  }
};

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});

