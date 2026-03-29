#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';

const ROOT = process.cwd();
const REPORT_PATH = path.join(ROOT, 'artifacts', 'runtime_contract_conformance_report.json');
const MEDIA_BACKEND_URL = String(process.env.VF_MEDIA_BACKEND_URL || 'http://127.0.0.1:7800').replace(/\/+$/, '');
const REQUEST_TIMEOUT_MS = Math.max(50, Number(process.env.VF_RUNTIME_CONTRACT_TIMEOUT_MS || 12000));
const REQUEST_RETRIES = Math.max(0, Number(process.env.VF_RUNTIME_CONTRACT_RETRIES || 2));
const RETRY_BACKOFF_MS = Math.max(10, Number(process.env.VF_RUNTIME_CONTRACT_BACKOFF_MS || 500));

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

const ensureObject = (value) => value && typeof value === 'object' && !Array.isArray(value);
const isFiniteNumber = (value) => Number.isFinite(Number(value));

const classifyTransportFailure = (error, statusCode = 0) => {
  if (statusCode === 408 || statusCode === 504) return 'timeout';
  if (error?.name === 'AbortError') return 'timeout';
  return 'backend_unreachable';
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const fetchWithTimeout = async (url, timeoutMs) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
    const text = await response.text();
    let payload = null;
    try {
      payload = text ? JSON.parse(text) : null;
    } catch {
      payload = text;
    }
    if (!response.ok) {
      const error = new Error(
        `${url} -> ${response.status} ${typeof payload === 'string' ? payload : JSON.stringify(payload)}`
      );
      error.statusCode = response.status;
      throw error;
    }
    return payload;
  } finally {
    clearTimeout(timer);
  }
};

const probeReachabilityWithRetry = async (url, options = {}) => {
  const timeoutMs = Math.max(50, Number(options.timeoutMs || REQUEST_TIMEOUT_MS));
  const retries = Math.max(0, Number(options.retries ?? REQUEST_RETRIES));
  let lastError = null;
  let lastClass = 'backend_unreachable';
  let attempt = 0;
  while (attempt <= retries) {
    attempt += 1;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        signal: controller.signal,
      });
      try {
        await response.arrayBuffer();
      } catch {
        // Ignore body read failures for reachability probe.
      }
      return { ok: true, attempts: attempt, statusCode: response.status };
    } catch (error) {
      const failureClass = classifyTransportFailure(error, Number(error?.statusCode || 0));
      lastClass = failureClass;
      lastError = error;
      if ((failureClass === 'timeout' || failureClass === 'backend_unreachable') && attempt <= retries) {
        await sleep(RETRY_BACKOFF_MS * attempt);
        continue;
      }
      break;
    } finally {
      clearTimeout(timer);
    }
  }
  const message = lastError instanceof Error ? lastError.message : String(lastError || 'Unknown transport error');
  return {
    ok: false,
    attempts: attempt,
    error: {
      class: lastClass,
      message,
    },
  };
};

const fetchJsonWithRetry = async (url, options = {}) => {
  const timeoutMs = Math.max(50, Number(options.timeoutMs || REQUEST_TIMEOUT_MS));
  const retries = Math.max(0, Number(options.retries ?? REQUEST_RETRIES));
  let lastError = null;
  let lastClass = 'backend_unreachable';
  let attempt = 0;
  while (attempt <= retries) {
    attempt += 1;
    try {
      const payload = await fetchWithTimeout(url, timeoutMs);
      return { payload, attempts: attempt };
    } catch (error) {
      const statusCode = Number(error?.statusCode || 0);
      const failureClass = classifyTransportFailure(error, statusCode);
      lastClass = failureClass;
      lastError = error;
      if ((failureClass === 'timeout' || failureClass === 'backend_unreachable') && attempt <= retries) {
        await sleep(RETRY_BACKOFF_MS * attempt);
        continue;
      }
      break;
    }
  }
  const message = lastError instanceof Error ? lastError.message : String(lastError || 'Unknown transport error');
  return {
    payload: null,
    attempts: attempt,
    error: {
      class: lastClass,
      message,
    },
  };
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
    if (!(engine === 'PRIME' && normalizedEngine === 'GEMINI')) {
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
    policyVersion: 'runtime-contracts-v2',
    passed: false,
    checks: [],
    failures: [],
    retryPolicy: {
      timeoutMs: REQUEST_TIMEOUT_MS,
      retries: REQUEST_RETRIES,
      backoffMs: RETRY_BACKOFF_MS,
    },
  };

  try {
    const preflight = await probeReachabilityWithRetry(`${MEDIA_BACKEND_URL}/`, {
      timeoutMs: Math.min(REQUEST_TIMEOUT_MS, 6000),
      retries: REQUEST_RETRIES,
    });
    if (!preflight.ok) {
      report.failures.push({
        class: preflight.error.class,
        stage: 'preflight',
        message: preflight.error.message,
        attempts: preflight.attempts,
      });
      report.passed = false;
      return;
    }

    const capabilities = await fetchJsonWithRetry(`${MEDIA_BACKEND_URL}/tts/engines/capabilities`, {
      timeoutMs: REQUEST_TIMEOUT_MS,
      retries: REQUEST_RETRIES,
    });
    if (capabilities.error) {
      report.failures.push({
        class: capabilities.error.class,
        stage: 'capabilities_fetch',
        message: capabilities.error.message,
        attempts: capabilities.attempts,
      });
      report.passed = false;
      return;
    }

    const payload = capabilities.payload;
    if (!ensureObject(payload) || !ensureObject(payload.engines)) {
      report.failures.push({
        class: 'schema_violation',
        stage: 'capabilities_root',
        message: 'Invalid /tts/engines/capabilities payload.',
        attempts: capabilities.attempts,
      });
      report.passed = false;
      return;
    }

    const engines = payload.engines;
    for (const engine of ['PRIME', 'VECTOR', 'DUNO']) {
      const cap = engines[engine];
      const violations = validateCapabilitiesPayload(engine, cap);
      report.checks.push({
        engine,
        ok: violations.length === 0,
        violations,
        sample: cap || null,
      });
      if (violations.length > 0) {
        report.failures.push({
          class: 'schema_violation',
          stage: 'engine_capabilities',
          engine,
          message: `${engine}: ${violations.join(', ')}`,
          attempts: capabilities.attempts,
        });
      }
    }
    report.passed = report.failures.length === 0;
  } catch (error) {
    report.failures.push({
      class: 'backend_unreachable',
      stage: 'unexpected',
      message: error instanceof Error ? error.message : String(error),
      attempts: 1,
    });
    report.passed = false;
  } finally {
    report.finishedAt = new Date().toISOString();
    await fs.mkdir(path.dirname(REPORT_PATH), { recursive: true });
    await fs.writeFile(REPORT_PATH, JSON.stringify(report, null, 2));
    console.log(`Contract report written to ${path.relative(ROOT, REPORT_PATH).replace(/\\/g, '/')}`);
    console.log(`Passed: ${report.passed}`);
    if (!report.passed) {
      process.exitCode = 1;
    }
  }
};

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
