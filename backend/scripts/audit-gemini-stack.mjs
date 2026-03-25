#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  buildAuditHeaders,
  classifyAuditFailure,
  fetchJsonWithTimeout,
  normalizeBaseUrl,
  parseBool,
} from './lib/audit-helpers.mjs';

const ROOT = process.cwd();
const ARTIFACT_PATH = path.join(ROOT, 'artifacts', 'gemini_stack_audit.json');
const BACKEND_BASE_URL = normalizeBaseUrl(process.env.VF_MEDIA_BACKEND_URL, 'http://127.0.0.1:7800');
const GEMINI_RUNTIME_URL = normalizeBaseUrl(process.env.VF_GEMINI_RUNTIME_URL, 'http://127.0.0.1:7810');
const REQUIRE_RUNTIME_ADMIN_TOKEN = parseBool(process.env.AUDIT_REQUIRE_RUNTIME_ADMIN_TOKEN, true);

const runtimeAdminToken = String(
  process.env.AUDIT_RUNTIME_ADMIN_TOKEN || process.env.GEMINI_RUNTIME_ADMIN_TOKEN || '',
).trim();

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

const main = async () => {
  const report = {
    timestamp: new Date().toISOString(),
    backendBaseUrl: BACKEND_BASE_URL,
    geminiRuntimeUrl: GEMINI_RUNTIME_URL,
    passed: false,
    auth: {},
    runtimeAdmin: {
      tokenConfigured: Boolean(runtimeAdminToken),
      requireToken: REQUIRE_RUNTIME_ADMIN_TOKEN,
    },
    checks: [],
    summary: {
      failed: 0,
      warnings: [],
      backendPool: {},
      runtimePool: {},
    },
  };

  const { headers: backendAuthHeaders, auth, authError } = buildAuditHeaders(
    { Accept: 'application/json' },
    { scriptName: 'audit:gemini-stack', defaultDevUid: 'local_admin', throwOnMissingAuth: false },
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

  const checks = [
    fetchCheck('backend_health', `${BACKEND_BASE_URL}/health`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
    }),
    fetchCheck('backend_engine_status', `${BACKEND_BASE_URL}/tts/engines/status`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
    }),
    fetchCheck('backend_engine_capabilities', `${BACKEND_BASE_URL}/tts/engines/capabilities`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
    }),
    fetchCheck('backend_gemini_pools', `${BACKEND_BASE_URL}/admin/gemini/pools`, {
      method: 'GET',
      headers: backendAuthHeaders,
    }),
    fetchCheck('runtime_health', `${GEMINI_RUNTIME_URL}/health`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
    }),
  ];

  checks.push(
    fetchCheck('runtime_admin_api_pools', `${GEMINI_RUNTIME_URL}/v1/admin/api-pools`, {
      method: 'GET',
      headers: runtimeAdminToken ? { Accept: 'application/json', 'x-admin-token': runtimeAdminToken } : { Accept: 'application/json' },
    }),
  );

  const resolvedChecks = await Promise.all(checks);
  report.checks = resolvedChecks;

  for (const item of resolvedChecks) {
    if (!item.ok) {
      report.summary.failed += 1;
    }
  }

  const backendPools = resolvedChecks.find((item) => item.name === 'backend_gemini_pools')?.payload;
  const runtimePools = resolvedChecks.find((item) => item.name === 'runtime_admin_api_pools')?.payload;

  if (backendPools && typeof backendPools === 'object') {
    report.summary.backendPool = {
      ok: Boolean(backendPools.ok),
      validationOk: Boolean(backendPools?.validation?.isValid ?? true),
      runtimeOk: Boolean(backendPools?.runtime?.ok ?? true),
      warnings: Array.isArray(backendPools?.warnings) ? backendPools.warnings : [],
    };
  }

  if (runtimePools && typeof runtimePools === 'object') {
    const snapshot = runtimePools?.poolSnapshot && typeof runtimePools.poolSnapshot === 'object'
      ? runtimePools.poolSnapshot
      : runtimePools;
    report.summary.runtimePool = {
      ok: Boolean(runtimePools.ok),
      keyPoolSize: Number(snapshot?.keyPoolSize || 0),
      atLimitKeys: Number(snapshot?.atLimitKeys || 0),
      unhealthyKeys: Number(snapshot?.unhealthyKeys || 0),
      activeLeases: Number(snapshot?.activeLeases || 0),
    };
  }

  report.passed = report.summary.failed === 0;
  await fs.mkdir(path.dirname(ARTIFACT_PATH), { recursive: true });
  await fs.writeFile(ARTIFACT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

  console.log(`[audit:gemini-stack] artifact: ${path.relative(ROOT, ARTIFACT_PATH).replace(/\\/g, '/')}`);
  console.log(`[audit:gemini-stack] passed=${report.passed}`);

  if (!report.passed) {
    process.exitCode = 1;
  }
};

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
