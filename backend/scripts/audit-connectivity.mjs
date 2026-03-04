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
const ARTIFACT_PATH = path.join(ROOT, 'artifacts', 'frontend_backend_connectivity_audit.json');
const BASE_URL = normalizeBaseUrl(process.env.VF_MEDIA_BACKEND_URL, 'http://127.0.0.1:7800');
const DEFAULT_ORIGINS = ['http://localhost:3000', 'http://127.0.0.1:3000'];

const parseOrigins = () => {
  const raw = String(process.env.VF_AUDIT_ORIGINS || '').trim();
  if (!raw) return DEFAULT_ORIGINS;
  const values = raw
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  return values.length > 0 ? values : DEFAULT_ORIGINS;
};

const fetchPreflight = async ({ origin, endpoint, method }) => {
  const response = await fetchJsonWithTimeout(
    `${BASE_URL}${endpoint}`,
    {
      method: 'OPTIONS',
      headers: {
        Origin: origin,
        'Access-Control-Request-Method': method,
        'Access-Control-Request-Headers': 'authorization,content-type,x-dev-uid',
      },
    },
    12_000,
  );

  const allowOrigin = String(response?.headers?.get?.('access-control-allow-origin') || '').trim();
  const allowMethods = String(response?.headers?.get?.('access-control-allow-methods') || '').toUpperCase();
  const ok = response.ok && allowOrigin === origin && allowMethods.includes(method);

  return {
    origin,
    endpoint,
    method,
    ok,
    status: response.status,
    classification: classifyAuditFailure(response),
    allowOrigin,
    allowMethods,
    detail: response.ok ? '' : JSON.stringify(response.payload || ''),
  };
};

const main = async () => {
  const origins = parseOrigins();
  const report = {
    timestamp: new Date().toISOString(),
    backendBaseUrl: BASE_URL,
    artifact: path.relative(ROOT, ARTIFACT_PATH).replace(/\\/g, '/'),
    passed: false,
    auth: {},
    origins,
    checks: {
      preflight: [],
      boundaries: [],
    },
    summary: {
      failed: 0,
      warnings: [],
    },
  };

  const { headers: authHeaders, auth } = buildAuditHeaders(
    { Accept: 'application/json' },
    { scriptName: 'audit:connectivity', defaultDevUid: 'local_admin' },
  );
  report.auth = {
    mode: auth.mode,
    hasAuth: auth.hasAuth,
    requireAuth: auth.requireAuth,
  };

  const preflightTargets = [
    { endpoint: '/tts/jobs', method: 'POST' },
    { endpoint: '/tts/synthesize', method: 'POST' },
  ];
  for (const origin of origins) {
    for (const target of preflightTargets) {
      const item = await fetchPreflight({ origin, endpoint: target.endpoint, method: target.method });
      report.checks.preflight.push(item);
      if (!item.ok) report.summary.failed += 1;
    }
  }

  const boundaryOrigin = origins[0] || DEFAULT_ORIGINS[0];
  const boundaryChecks = [
    {
      name: 'public_health',
      path: '/health',
      init: { method: 'GET', headers: { Accept: 'application/json', Origin: boundaryOrigin } },
      expected: [200],
      optional: false,
    },
    {
      name: 'protected_profile_without_auth',
      path: '/account/profile',
      init: { method: 'GET', headers: { Accept: 'application/json', Origin: boundaryOrigin } },
      expected: [401, 403, 200],
      optional: false,
    },
    {
      name: 'protected_profile_with_auth',
      path: '/account/profile',
      init: { method: 'GET', headers: { ...authHeaders, Origin: boundaryOrigin } },
      expected: [200],
      optional: !auth.hasAuth,
    },
  ];

  for (const check of boundaryChecks) {
    if (check.optional) {
      report.checks.boundaries.push({
        name: check.name,
        skipped: true,
        reason: 'auth_unavailable',
      });
      continue;
    }

    const result = await fetchJsonWithTimeout(`${BASE_URL}${check.path}`, check.init, 12_000);
    const ok = check.expected.includes(result.status);
    const item = {
      name: check.name,
      path: check.path,
      ok,
      status: result.status,
      expected: check.expected,
      classification: classifyAuditFailure(result),
      detail: result.ok ? '' : JSON.stringify(result.payload || ''),
    };

    if (!ok) {
      report.summary.failed += 1;
    }
    if (check.name === 'protected_profile_without_auth' && result.status === 200) {
      report.summary.warnings.push('Protected endpoint accepted unauthenticated request. Verify VF_AUTH_ENFORCE in target environment.');
    }
    report.checks.boundaries.push(item);
  }

  report.passed = report.summary.failed === 0;
  await fs.mkdir(path.dirname(ARTIFACT_PATH), { recursive: true });
  await fs.writeFile(ARTIFACT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

  console.log(`[audit:connectivity] artifact: ${path.relative(ROOT, ARTIFACT_PATH).replace(/\\/g, '/')}`);
  console.log(`[audit:connectivity] passed=${report.passed}`);
  if (!report.passed) {
    process.exitCode = 1;
  }
};

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});