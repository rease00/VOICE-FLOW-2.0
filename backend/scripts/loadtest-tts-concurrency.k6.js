import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter, Rate } from 'k6/metrics';

const BASE_URL = String(__ENV.VF_MEDIA_BACKEND_URL || 'http://127.0.0.1:7800').replace(/\/+$/, '');
const MODE = String(__ENV.VF_LOAD_MODE || 'mixed').toLowerCase();
const UID = String(__ENV.VF_LOAD_UID || 'k6_load_user');
const GEM_RATIO = Number.parseFloat(String(__ENV.VF_LOAD_ENGINE_SPLIT_GEM || '0.6'));
const VUS = Math.max(1, Number.parseInt(String(__ENV.VF_LOAD_VUS || '50'), 10) || 50);
const DURATION = String(__ENV.VF_LOAD_DURATION || '30s');
const JOB_POLL_MS = Math.max(100, Number.parseInt(String(__ENV.VF_LOAD_POLL_MS || '350'), 10) || 350);
const JOB_TIMEOUT_MS = Math.max(1_000, Number.parseInt(String(__ENV.VF_LOAD_JOB_TIMEOUT_MS || '120000'), 10) || 120000);
const SYNC_WAIT_MS = Math.max(0, Number.parseInt(String(__ENV.VF_LOAD_SYNC_WAIT_MS || '3000'), 10) || 3000);
const SUMMARY_PATH = String(__ENV.VF_K6_SUMMARY_PATH || 'artifacts/load/k6-summary.json');

export const completionRate = new Rate('completion_rate');
export const serverErrors = new Counter('server_errors');
export const terminalFailures = new Counter('terminal_failures');

const headers = {
  'Content-Type': 'application/json',
  Accept: 'application/json',
  'x-dev-uid': UID,
};

export const options = {
  scenarios: {
    load_50: {
      executor: 'constant-vus',
      vus: VUS,
      duration: DURATION,
      gracefulStop: '10s',
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.01'],
    http_req_duration: ['p(95)<5000'],
    server_errors: ['count==0'],
    completion_rate: ['rate>0.98'],
    terminal_failures: ['count==0'],
  },
};

const parseJsonBody = (response) => {
  if (!response) return null;
  const type = String(response.headers['Content-Type'] || response.headers['content-type'] || '').toLowerCase();
  if (!type.includes('application/json')) return null;
  try {
    return response.json();
  } catch (_error) {
    return null;
  }
};

const makePayload = (engine, requestId) => {
  if (engine === 'KOKORO') {
    return {
      engine: 'KOKORO',
      text: 'k6 queue hardening load payload for Kokoro path.',
      voice_id: 'hf_alpha',
      request_id: requestId,
    };
  }
  return {
    engine: 'GEM',
    text: 'k6 queue hardening load payload for Gemini path.',
    voice_id: 'Fenrir',
    request_id: requestId,
  };
};

const pickEngine = () => {
  const ratio = Number.isFinite(GEM_RATIO) ? GEM_RATIO : 0.6;
  return Math.random() < ratio ? 'GEM' : 'KOKORO';
};

const pickMode = () => {
  if (MODE === 'jobs' || MODE === 'sync') return MODE;
  return Math.random() < 0.5 ? 'jobs' : 'sync';
};

const pollJob = (jobId) => {
  const started = Date.now();
  while (Date.now() - started < JOB_TIMEOUT_MS) {
    const response = http.get(`${BASE_URL}/tts/jobs/${encodeURIComponent(jobId)}`, { headers });
    const body = parseJsonBody(response);
    if (response.status >= 500) {
      serverErrors.add(1);
      return { ok: false, terminal: 'failed', status: response.status, body };
    }
    const status = String((body && body.status) || '').toLowerCase();
    if (status === 'completed') return { ok: true, terminal: 'completed', status: 200, body };
    if (status === 'failed' || status === 'cancelled') return { ok: false, terminal: status, status: Number((body && body.statusCode) || 500), body };
    sleep(JOB_POLL_MS / 1000);
  }
  return { ok: false, terminal: 'timeout', status: 0, body: null };
};

const markTerminalFailure = (terminal) => {
  if (terminal === 'failed' || terminal === 'cancelled' || terminal === 'timeout') {
    terminalFailures.add(1);
    return;
  }
  if (terminal !== 'completed') terminalFailures.add(1);
};

const runJobsPath = (engine, requestId) => {
  const response = http.post(`${BASE_URL}/tts/jobs`, JSON.stringify(makePayload(engine, requestId)), { headers });
  const body = parseJsonBody(response);
  if (response.status >= 500) {
    serverErrors.add(1);
    completionRate.add(false);
    terminalFailures.add(1);
    return;
  }
  if (response.status < 200 || response.status >= 300) {
    completionRate.add(false);
    terminalFailures.add(1);
    return;
  }
  const immediateStatus = String((body && body.status) || '').toLowerCase();
  if (immediateStatus === 'completed') {
    completionRate.add(true);
    return;
  }
  const jobId = String((body && (body.jobId || body.requestId)) || requestId);
  const terminal = pollJob(jobId);
  completionRate.add(Boolean(terminal.ok));
  markTerminalFailure(terminal.terminal);
};

const runSyncPath = (engine, requestId) => {
  const response = http.post(
    `${BASE_URL}/tts/synthesize?wait_ms=${encodeURIComponent(String(SYNC_WAIT_MS))}`,
    JSON.stringify(makePayload(engine, requestId)),
    { headers },
  );
  const body = parseJsonBody(response);

  if (response.status >= 500) {
    serverErrors.add(1);
    completionRate.add(false);
    terminalFailures.add(1);
    return;
  }
  if (response.status === 200) {
    completionRate.add(true);
    return;
  }
  if (response.status === 202) {
    const jobId = String((body && (body.jobId || body.requestId)) || requestId);
    const terminal = pollJob(jobId);
    completionRate.add(Boolean(terminal.ok));
    markTerminalFailure(terminal.terminal);
    return;
  }
  completionRate.add(false);
  terminalFailures.add(1);
};

export default function () {
  const engine = pickEngine();
  const selectedMode = pickMode();
  const requestId = `k6_${selectedMode}_${engine.toLowerCase()}_${__VU}_${__ITER}`;
  check({ mode: selectedMode }, {
    'mode is jobs or sync': (input) => input.mode === 'jobs' || input.mode === 'sync',
  });
  if (selectedMode === 'jobs') {
    runJobsPath(engine, requestId);
    return;
  }
  runSyncPath(engine, requestId);
}

export function handleSummary(data) {
  const thresholdFailures = [];
  Object.entries(data.metrics || {}).forEach(([metricName, metricValue]) => {
    const thresholds = metricValue && metricValue.thresholds ? metricValue.thresholds : {};
    Object.entries(thresholds).forEach(([thresholdName, thresholdResult]) => {
      if (!thresholdResult || thresholdResult.ok === false) {
        thresholdFailures.push(`${metricName}:${thresholdName}`);
      }
    });
  });

  const payload = {
    schemaVersion: '1.0.0',
    generatedAt: new Date().toISOString(),
    target: {
      baseUrl: BASE_URL,
      mode: MODE,
      uid: UID,
      vus: VUS,
      duration: DURATION,
    },
    metrics: data.metrics,
    verdict: {
      passed: thresholdFailures.length === 0,
      reasons: thresholdFailures,
    },
  };

  return {
    [SUMMARY_PATH]: JSON.stringify(payload, null, 2),
    stdout: `[k6-load] summary written to ${SUMMARY_PATH}\n[k6-load] passed=${thresholdFailures.length === 0}\n`,
  };
}

