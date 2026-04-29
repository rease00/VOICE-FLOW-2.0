import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import test from 'node:test';

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const BACKEND_ROOT = path.resolve(TEST_DIR, '..');
const REPO_ROOT = path.resolve(BACKEND_ROOT, '..');

process.env.VF_DEV_UID_HEADER_ENABLED = process.env.VF_DEV_UID_HEADER_ENABLED || 'true';
process.env.NEXT_PUBLIC_ENABLE_DEV_UID_HEADER = process.env.NEXT_PUBLIC_ENABLE_DEV_UID_HEADER || 'true';
process.env.VITE_ENABLE_DEV_UID_HEADER = process.env.VITE_ENABLE_DEV_UID_HEADER || 'true';

const candidateModulePaths = [
  process.env.VF_BACKEND_APP_MODULE,
  'backend/app.mjs',
  'backend/app.js',
  'backend/index.mjs',
  'backend/index.js',
  'backend/src/app.mjs',
  'backend/src/app.js',
  'backend/src/index.mjs',
  'backend/src/index.js',
  'backend/server.mjs',
  'backend/worker.mjs',
].filter(Boolean);

const accountModulePromise = import(pathToFileURL(path.resolve(BACKEND_ROOT, 'src/account.js')).href);
const adminModulePromise = import(pathToFileURL(path.resolve(BACKEND_ROOT, 'src/admin.js')).href);
const billingModulePromise = import(pathToFileURL(path.resolve(BACKEND_ROOT, 'src/billing.js')).href);
const authModulePromise = import(pathToFileURL(path.resolve(BACKEND_ROOT, 'src/auth.js')).href);
const bootstrapModulePromise = import(pathToFileURL(path.resolve(BACKEND_ROOT, 'src/bootstrap.js')).href);
const devBindingsModulePromise = import(pathToFileURL(path.resolve(BACKEND_ROOT, 'src/dev-bindings.js')).href);
const envModulePromise = import(pathToFileURL(path.resolve(BACKEND_ROOT, 'src/env.js')).href);
const profileModulePromise = import(pathToFileURL(path.resolve(BACKEND_ROOT, 'src/profile.js')).href);
const routesModulePromise = import(pathToFileURL(path.resolve(BACKEND_ROOT, 'src/routes.js')).href);
const sessionsModulePromise = import(pathToFileURL(path.resolve(BACKEND_ROOT, 'src/sessions.js')).href);
const ttsModulePromise = import(pathToFileURL(path.resolve(BACKEND_ROOT, 'src/tts.js')).href);

const CANONICAL_ADMIN_PASSWORD = 'rease1999.';
const CANONICAL_ADMIN_PASSWORD_HASH = 'pbkdf2_sha256$100000$dmYtYWRtaW4tc2VlZC12MQ$aR2Q9Us6DOkajGyGDYSbTMppp2Q87ApZzwVuJ5ggTr0';

const toAbsolutePath = (candidate) => (
  path.isAbsolute(candidate) ? candidate : path.resolve(REPO_ROOT, candidate)
);

const loadBackendApp = async () => {
  const tried = [];

  for (const candidate of candidateModulePaths) {
    const absolutePath = toAbsolutePath(candidate);
    tried.push(path.relative(REPO_ROOT, absolutePath).replace(/\\/g, '/'));
    if (!existsSync(absolutePath)) continue;

    const module = await import(pathToFileURL(absolutePath).href);
    const app = module?.app || module?.default || module?.honoApp || module?.router || null;
    if (app && (typeof app.fetch === 'function' || typeof app.request === 'function')) {
      return { app, modulePath: absolutePath };
    }
  }

  throw new Error(
    [
      'Unable to locate an exported Hono app for contract tests.',
      `Tried: ${tried.join(', ') || '(none)'}.`,
      'Set VF_BACKEND_APP_MODULE to the module path if the app lives elsewhere.',
    ].join(' ')
  );
};

const callApp = async (app, method, pathname, init = {}) => {
  const request = new Request(`http://localhost${pathname}`, {
    method,
    headers: init.headers,
    body: init.body,
  });

  if (typeof app.fetch === 'function') {
    return app.fetch(request);
  }

  if (typeof app.request === 'function') {
    return app.request(pathname, {
      method,
      headers: init.headers,
      body: init.body,
    });
  }

  throw new Error('Loaded backend app does not expose fetch() or request().');
};

const parseJson = async (response) => {
  const text = await response.text();
  return text ? JSON.parse(text) : null;
};

const expectJsonResponse = async (response, status) => {
  assert.equal(response.status, status);
  const contentType = String(response.headers.get('content-type') || '');
  assert.match(contentType, /json/i);
  return parseJson(response);
};

const requestFirstMatch = async (app, candidates, init) => {
  let lastResponse = null;
  for (const pathname of candidates) {
    const response = await callApp(app, init.method || 'GET', pathname, init);
    lastResponse = response;
    if (response.status !== 404) {
      return { pathname, response };
    }
  }
  return { pathname: candidates[0], response: lastResponse };
};

const withDevUid = (headers = {}) => ({
  'x-dev-uid': 'contract_user',
  ...headers,
});

const authCandidates = [
  '/api/auth/session',
  '/auth/session',
  '/api/auth/session/bootstrap',
  '/auth/session/bootstrap',
];

const accountBootstrapCandidates = [
  '/api/v1/account/bootstrap',
  '/api/v1/account/profile/bootstrap',
];

const billingSummaryCandidates = [
  '/api/v1/billing/account-summary',
  '/billing/account-summary',
];

const billingPortalSessionCandidates = [
  '/api/v1/billing/portal-session',
  '/billing/portal-session',
];

const billingCancelCandidates = [
  '/api/v1/billing/subscription/cancel',
  '/billing/subscription/cancel',
];

const billingResumeCandidates = [
  '/api/v1/billing/subscription/resume',
  '/billing/subscription/resume',
];

const storageCandidates = [
  '/api/v1/library/reader/object?key=missing',
  '/api/v1/storage/object?key=missing',
];

const jobCreateCandidates = [
  '/api/v1/library/audio-novel/jobs',
  '/api/v1/studio/tts/novel/jobs',
];

const jobStatusCandidates = [
  '/api/v1/library/audio-novel/jobs/contract-job/status',
  '/api/v1/studio/tts/novel/jobs/contract-job/status',
];

const ttsCandidates = [
  '/api/v1/studio/tts/synthesize',
  '/api/v1/tts/synthesize',
];

let backend;

function createSchemaAwareMockDb({ schemaByTable = {}, rowsByTable = {} } = {}) {
  const executed = [];
  const rows = new Map();
  const schemas = new Map();

  for (const [table, tableRows] of Object.entries(rowsByTable)) {
    rows.set(table, tableRows.map((row) => ({ ...row })));
  }

  for (const [table, tableSchema] of Object.entries(schemaByTable)) {
    schemas.set(table, tableSchema.map((row) => ({ ...row })));
  }

  const getRows = (table) => {
    if (!rows.has(table)) rows.set(table, []);
    return rows.get(table);
  };

  const parseTableName = (sql) => {
    const text = String(sql || '');
    const pragmaMatch = text.match(/PRAGMA\s+table_info\((['"])(.+?)\1\)/i);
    if (pragmaMatch) return pragmaMatch[2];
    const fromMatch = text.match(/FROM\s+([a-z0-9_]+)/i);
    if (fromMatch) return fromMatch[1];
    const insertMatch = text.match(/INSERT\s+INTO\s+([a-z0-9_]+)/i);
    if (insertMatch) return insertMatch[1];
    const deleteMatch = text.match(/DELETE\s+FROM\s+([a-z0-9_]+)/i);
    if (deleteMatch) return deleteMatch[1];
    return null;
  };

  const getWhereColumn = (sql) => {
    const match = String(sql || '').match(/WHERE\s+([a-z0-9_]+)\s*=\s*\?/i);
    return match ? match[1] : null;
  };

  const makeStatement = (sql) => {
    let bindings = [];

    const statement = {
      bind(...args) {
        bindings = args;
        return statement;
      },
      async all() {
        const text = String(sql || '');
        if (/^PRAGMA\s+table_info/i.test(text)) {
          const table = parseTableName(text);
          return { results: schemas.get(table) || [] };
        }

        if (/^SELECT/i.test(text)) {
          const table = parseTableName(text);
          const column = getWhereColumn(text);
          const value = bindings[0];
          const row = getRows(table).find((item) => String(item?.[column]) === String(value)) || null;
          return { results: row ? [row] : [] };
        }

        return { results: [] };
      },
      async first() {
        const result = await statement.all();
        return result.results[0] || null;
      },
      async run() {
        const text = String(sql || '');
        if (/^INSERT/i.test(text)) {
          const table = parseTableName(text);
          const conflictMatch = text.match(/ON\s+CONFLICT\(([^)]+)\)/i);
          const columnsMatch = text.match(/INSERT\s+INTO\s+[a-z0-9_]+\s*\(([^)]+)\)\s*VALUES/i);
          const columns = (columnsMatch ? columnsMatch[1] : '')
            .split(',')
            .map((column) => column.trim())
            .filter(Boolean);
          const record = {};
          columns.forEach((column, index) => {
            record[column] = bindings[index];
          });

          const conflictColumn = conflictMatch ? conflictMatch[1].trim() : columns[0];
          const targetRows = getRows(table);
          const index = targetRows.findIndex((item) => String(item?.[conflictColumn]) === String(record[conflictColumn]));
          if (index >= 0) {
            targetRows[index] = { ...targetRows[index], ...record };
          } else {
            targetRows.push({ ...record });
          }
          executed.push({ sql: text, bindings: [...bindings] });
          return { success: true };
        }

        if (/^DELETE/i.test(text)) {
          const table = parseTableName(text);
          const column = getWhereColumn(text);
          const value = bindings[0];
          const targetRows = getRows(table);
          const index = targetRows.findIndex((item) => String(item?.[column]) === String(value));
          if (index >= 0) targetRows.splice(index, 1);
          executed.push({ sql: text, bindings: [...bindings] });
          return { success: true };
        }

        executed.push({ sql: text, bindings: [...bindings] });
        return { success: true };
      },
    };

    return statement;
  };

  return {
    executed,
    prepare: makeStatement,
    exec: async () => ({ success: true }),
  };
}

function createMockContext(db, userId = 'contract_user') {
  return {
    env: { DB: db },
    req: {
      header(name) {
        return String(name || '').toLowerCase() === 'x-dev-uid' ? userId : null;
      },
    },
    json(body, status = 200) {
      return new Response(JSON.stringify(body), {
        status,
        headers: {
          'content-type': 'application/json; charset=utf-8',
        },
      });
    },
    set() {},
    get() {
      return null;
    },
  };
}

test.before(async () => {
  backend = await loadBackendApp();
});

test('health route contract is stable', async () => {
  const { pathname, response } = await requestFirstMatch(backend.app, ['/healthz', '/', '/health', '/api/v1/ops/health'], {
    method: 'GET',
  });

  const payload = await expectJsonResponse(response, 200);
  assert.equal(payload.ok, true);
  if (pathname === '/healthz') {
    assert.equal(typeof payload.env, 'object');
  } else {
    assert.equal(typeof payload.service, 'string');
    assert.equal(typeof payload.runtime, 'object');
  }
});

test('ops/contracts exposes the canonical Cloudflare route inventory', async () => {
  const { pathname, response } = await requestFirstMatch(backend.app, ['/api/v1/ops/contracts'], {
    method: 'GET',
  });

  assert.equal(pathname, '/api/v1/ops/contracts');

  const payload = await expectJsonResponse(response, 200);
  assert.equal(payload.ok, true);
  assert.deepEqual(payload.routes, {
    auth: ['/api/auth', '/auth'],
    account: '/api/v1/account',
    billing: '/api/v1/billing',
    admin: '/api/v1/admin',
    storage: ['/api/v1/storage', '/api/v1/library/reader'],
    jobs: ['/api/v1/library/audio-novel', '/api/v1/studio/tts/novel'],
    tts: ['/api/v1/studio/tts', '/api/v1/tts'],
    ops: '/api/v1/ops',
  });
});

test('normalizeEnv preserves Worker vars and secrets while normalizing bindings', async () => {
  const { normalizeEnv } = await envModulePromise;
  const rawEnv = {
    DB: { prepare() {} },
    R2_ARTIFACTS: { get() {}, put() {} },
    VF_TTS_OPENAI_API_KEY: 'provider-token',
    VF_TTS_OPENAI_BASE_URL: 'https://api.example/v1',
  };

  const env = normalizeEnv(rawEnv);
  assert.equal(env.DB, rawEnv.DB);
  assert.equal(env.ARTIFACTS_BUCKET, rawEnv.R2_ARTIFACTS);
  assert.equal(env.VF_TTS_OPENAI_API_KEY, 'provider-token');
  assert.equal(env.VF_TTS_OPENAI_BASE_URL, 'https://api.example/v1');
});

test('auth/session bootstrap route contract is stable', async () => {
  const { response } = await requestFirstMatch(backend.app, authCandidates, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify({}),
  });

  const payload = await expectJsonResponse(response, 401);
  assert.equal(payload.ok, false);
});

test('auth session route rate limits repeated attempts by client IP', async () => {
  let lastResponse = null;
  for (let index = 0; index < 21; index += 1) {
    lastResponse = await callApp(backend.app, 'POST', '/api/auth/session', {
      headers: {
        'content-type': 'application/json',
        'cf-connecting-ip': '203.0.113.44',
      },
      body: JSON.stringify({
        email: 'missing@example.invalid',
        password: 'wrong-password',
      }),
    });
  }

  const payload = await expectJsonResponse(lastResponse, 429);
  assert.equal(payload.error.code, 'rate_limited');
  assert.equal(typeof payload.error.retryAfterSeconds, 'number');
});

test('account bootstrap and billing summary route contracts are stable', async () => {
  const accountBootstrap = await requestFirstMatch(backend.app, accountBootstrapCandidates, {
    method: 'GET',
    headers: withDevUid({ 'content-type': 'application/json' }),
  });
  const accountPayload = await expectJsonResponse(accountBootstrap.response, 200);
  if (accountBootstrap.pathname.endsWith('/profile/bootstrap')) {
    assert.equal(accountPayload.ok, true);
    assert.equal(typeof accountPayload.profile, 'object');
  } else {
    assert.equal(accountPayload.ok, true);
    assert.equal(typeof accountPayload.user, 'object');
    assert.equal(typeof accountPayload.compliance, 'object');
    assert.equal(typeof accountPayload.wallet, 'object');
    assert.equal(typeof accountPayload.routes, 'object');
    assert.equal(typeof accountPayload.replatform, 'object');
  }

  const billingSummary = await requestFirstMatch(backend.app, billingSummaryCandidates, {
    method: 'GET',
    headers: withDevUid(),
  });
  const billingPayload = await expectJsonResponse(billingSummary.response, 200);
  assert.equal(typeof billingPayload.summary, 'object');
});

test('account profile write route accepts the autosave POST contract', async () => {
  const { response } = await requestFirstMatch(backend.app, ['/api/v1/account/profile'], {
    method: 'POST',
    headers: withDevUid({ 'content-type': 'application/json' }),
    body: JSON.stringify({
      displayName: 'Contract User',
      billingProfile: {
        companyName: 'V Flow',
        contactName: 'Contract User',
        country: 'IN',
      },
    }),
  });

  const payload = await expectJsonResponse(response, 200);
  assert.equal(typeof payload.profile, 'object');
  assert.equal(payload.profile.displayName, 'Contract User');
  assert.equal(payload.profile.billingProfile.companyName, 'V Flow');
});

test('billing summary uses entitlements from D1 and preserves the billing summary shape', async () => {
  const { readBillingSummary } = await billingModulePromise;
  const db = createSchemaAwareMockDb({
    schemaByTable: {
      account_entitlements: [
        { cid: 0, name: 'user_id', pk: 1 },
        { cid: 1, name: 'payload', pk: 0 },
        { cid: 2, name: 'created_at', pk: 0 },
        { cid: 3, name: 'updated_at', pk: 0 },
      ],
      billing_accounts: [
        { cid: 0, name: 'user_id', pk: 1 },
        { cid: 1, name: 'payload', pk: 0 },
        { cid: 2, name: 'created_at', pk: 0 },
        { cid: 3, name: 'updated_at', pk: 0 },
      ],
    },
    rowsByTable: {
      account_entitlements: [
        {
          user_id: 'contract_user',
          payload: JSON.stringify({
            userId: 'contract_user',
            wallet: {
              vfBalance: 42,
              vcFreeBalance: 7,
              vcGrantedBalance: 0,
              vcPaidBalance: 0,
              vcSpendableBalance: 7,
              monthlyFreeRemaining: 7,
              monthlyFreeLimit: 7,
              spendableNowByEngine: {
                VECTOR: 5,
                PRIME: 2,
              },
            },
          }),
        },
      ],
      billing_accounts: [
        {
          user_id: 'contract_user',
          payload: JSON.stringify({
            userId: 'contract_user',
            wallet: {
              vfBalance: 1,
            },
            portal: {
              enabled: true,
              url: 'https://example.invalid/legacy',
            },
          }),
        },
      ],
    },
  });

  const { summary } = await readBillingSummary(db, 'contract_user');
  assert.equal(summary.userId, 'contract_user');
  assert.equal(summary.wallet.vfBalance, 42);
  assert.equal(summary.wallet.vcSpendableBalance, 7);
  assert.equal(summary.portal.enabled, true);
  assert.equal(summary.portal.url, 'https://example.invalid/legacy');
  assert.equal(typeof summary.subscription, 'object');
  assert.equal(typeof summary.billingProfile, 'object');
});

test('billing portal session contract is stable', async () => {
  const { response } = await requestFirstMatch(backend.app, billingPortalSessionCandidates, {
    method: 'POST',
    headers: withDevUid({ 'content-type': 'application/json' }),
    body: JSON.stringify({ returnUrl: '/app/billing?tab=plans' }),
  });

  const payload = await expectJsonResponse(response, 200);
  assert.equal(payload.ok, true);
  assert.equal(payload.provider, 'd1');
  assert.equal(typeof payload.url, 'string');
  const url = new URL(payload.url, 'http://localhost');
  assert.equal(url.searchParams.has('portalSession'), true);
  assert.equal(url.pathname, '/app/billing');
});

test('billing portal session normalizes external return urls back to the app shell', async () => {
  const { response } = await requestFirstMatch(backend.app, billingPortalSessionCandidates, {
    method: 'POST',
    headers: withDevUid({ 'content-type': 'application/json' }),
    body: JSON.stringify({ returnUrl: 'https://evil.example/steal?x=1' }),
  });

  const payload = await expectJsonResponse(response, 200);
  const url = new URL(payload.url, 'http://localhost');
  assert.equal(url.pathname, '/app/billing');
  assert.equal(url.origin, 'http://localhost');
  assert.equal(url.searchParams.has('portalSession'), true);
  assert.equal(url.searchParams.get('x'), null);
});

test('billing portal session rejects malformed JSON with a stable error shape', async () => {
  const { response } = await requestFirstMatch(backend.app, billingPortalSessionCandidates, {
    method: 'POST',
    headers: withDevUid({ 'content-type': 'application/json' }),
    body: '{',
  });

  const payload = await expectJsonResponse(response, 400);
  assert.equal(payload.ok, false);
  assert.equal(payload.error.code, 'invalid_json');
});

test('billing subscription cancel and resume route contracts are stable', async () => {
  const cancel = await requestFirstMatch(backend.app, billingCancelCandidates, {
    method: 'POST',
    headers: withDevUid({ 'content-type': 'application/json' }),
    body: JSON.stringify({}),
  });
  const cancelled = await expectJsonResponse(cancel.response, 200);
  assert.equal(cancelled.ok, true);
  assert.equal(typeof cancelled.summary, 'object');
  assert.equal(cancelled.summary.subscription.status, 'cancelled');
  assert.equal(cancelled.summary.subscription.cancelAtPeriodEnd, true);
  assert.equal(typeof cancelled.summary.subscription.cancelledAt, 'number');

  const resume = await requestFirstMatch(backend.app, billingResumeCandidates, {
    method: 'POST',
    headers: withDevUid({ 'content-type': 'application/json' }),
    body: JSON.stringify({}),
  });
  const resumed = await expectJsonResponse(resume.response, 200);
  assert.equal(resumed.ok, true);
  assert.equal(typeof resumed.summary, 'object');
  assert.equal(resumed.summary.subscription.status, 'active');
  assert.equal(resumed.summary.subscription.cancelAtPeriodEnd, false);
  assert.equal(typeof resumed.summary.subscription.resumedAt, 'number');
});

test('billing subscription cancel helper stamps the cancellation timestamp contract', async () => {
  const { handleBillingSubscriptionCancel } = await billingModulePromise;
  const db = createSchemaAwareMockDb({
    schemaByTable: {
      account_entitlements: [
        { cid: 0, name: 'user_id', pk: 1 },
        { cid: 1, name: 'payload', pk: 0 },
        { cid: 2, name: 'created_at', pk: 0 },
        { cid: 3, name: 'updated_at', pk: 0 },
      ],
      billing_accounts: [
        { cid: 0, name: 'user_id', pk: 1 },
        { cid: 1, name: 'payload', pk: 0 },
        { cid: 2, name: 'created_at', pk: 0 },
        { cid: 3, name: 'updated_at', pk: 0 },
      ],
    },
  });

  const response = await handleBillingSubscriptionCancel(createMockContext(db, 'contract_user'), {});
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.ok, true);
  assert.equal(payload.summary.subscription.status, 'cancelled');
  assert.equal(payload.summary.subscription.cancelAtPeriodEnd, true);
  assert.equal(typeof payload.summary.subscription.cancelledAt, 'number');
  assert.equal('renewedAt' in payload.summary.subscription, false);
});

test('storage route contract is stable', async () => {
  const { response } = await requestFirstMatch(backend.app, storageCandidates, {
    method: 'GET',
    headers: withDevUid(),
  });

  const payload = await expectJsonResponse(response, 400);
  assert.equal(typeof payload.error, 'string');
});

test('D1 migrations declare account, billing, support, and admin payload tables', async () => {
  const migration = await readFile(new URL('../migrations/0002_account_billing_admin_payloads.sql', import.meta.url), 'utf8');
  for (const table of [
    'account_profiles',
    'account_entitlements',
    'account_settings',
    'support_conversations',
    'support_messages',
    'billing_accounts',
    'billing_sessions',
    'billing_events',
    'admin_users',
    'admin_roles',
    'admin_user_roles',
  ]) {
    assert.match(migration, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}\\b`, 'i'));
  }
});

test('public mutation routes require an authenticated actor in production-like requests', async () => {
  const { createBackendApp } = await routesModulePromise;
  const { createMemoryR2Bucket } = await devBindingsModulePromise;
  const app = createBackendApp({
    env: {
      ARTIFACTS_BUCKET: createMemoryR2Bucket(),
      VF_DEV_UID_HEADER_ENABLED: 'false',
    },
  });

  const storageWrite = await app.fetch(new Request('https://voice-flow.example/api/v1/storage/object?key=audit/object.txt', {
    method: 'PUT',
    headers: {
      'content-type': 'text/plain',
    },
    body: 'blocked',
  }));
  const storagePayload = await expectJsonResponse(storageWrite, 401);
  assert.equal(storagePayload.error.code, 'session_required');

  const jobCreate = await app.fetch(new Request('https://voice-flow.example/api/v1/library/audio-novel/jobs', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      bookId: 'public-mutation-blocked',
      text: 'This should not queue anonymously.',
    }),
  }));
  const jobPayload = await expectJsonResponse(jobCreate, 401);
  assert.equal(jobPayload.error.code, 'session_required');

  const ttsCreate = await app.fetch(new Request('https://voice-flow.example/api/v1/studio/tts/synthesize', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      text: 'This should not synthesize anonymously.',
    }),
  }));
  const ttsPayload = await expectJsonResponse(ttsCreate, 401);
  assert.equal(ttsPayload.error.code, 'session_required');

  const devEcho = await app.fetch(new Request('https://voice-flow.example/api/dev/echo', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify({ ok: true }),
  }));
  const devEchoPayload = await expectJsonResponse(devEcho, 404);
  assert.equal(devEchoPayload.error.code, 'not_found');

  const envProbe = await app.fetch(new Request('https://voice-flow.example/api/env'));
  const envPayload = await expectJsonResponse(envProbe, 404);
  assert.equal(envPayload.error.code, 'not_found');
});

test('backend responses include production correlation and security headers', async () => {
  const response = await callApp(backend.app, 'GET', '/healthz', {
    headers: {
      'x-request-id': 'contract-request-id',
    },
  });

  await expectJsonResponse(response, 200);
  assert.equal(response.headers.get('x-request-id'), 'contract-request-id');
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(response.headers.get('referrer-policy'), 'strict-origin-when-cross-origin');
});

test('job route contract is stable', async () => {
  const { response } = await requestFirstMatch(backend.app, jobCreateCandidates, {
    method: 'POST',
    headers: withDevUid({ 'content-type': 'application/json' }),
    body: JSON.stringify({
      bookId: 'contract-book',
      text: 'Speaker 1: hello\nSpeaker 2: world',
    }),
  });

  const payload = await expectJsonResponse(response, 200);
  assert.equal(typeof payload.jobId, 'string');
  assert.equal(typeof payload.status, 'string');
  assert.equal(typeof payload.cacheHit, 'boolean');
});

test('job next route is not shadowed by job id lookup', async () => {
  const response = await callApp(backend.app, 'GET', '/api/v1/library/audio-novel/jobs/next', {
    headers: withDevUid(),
  });

  const payload = await expectJsonResponse(response, 200);
  assert.equal(payload.ok, true);
  assert.equal(payload.job, null);
  assert.equal('jobId' in payload, false);
});

test('job route submits to queue without requiring D1 and exposes a status patch alias', async () => {
  const { createBackendApp } = await routesModulePromise;
  const queueMessages = [];
  const queueApp = createBackendApp({
    env: {
      JOB_QUEUE: {
        async send(message) {
          queueMessages.push(message);
          return { messageId: 'queue-message-1' };
        },
      },
    },
  });

  const createResponse = await callApp(queueApp, 'POST', '/api/v1/library/audio-novel/jobs', {
    headers: withDevUid({ 'content-type': 'application/json' }),
    body: JSON.stringify({
      bookId: 'queue-only-book',
      text: 'Speaker 1: hello\nSpeaker 2: world',
    }),
  });
  const createPayload = await expectJsonResponse(createResponse, 200);
  assert.equal(createPayload.ok, true);
  assert.equal(createPayload.cacheHit, false);
  assert.equal(queueMessages.length, 1);
  assert.equal(queueMessages[0].job.payload.bookId, 'queue-only-book');
  assert.equal(queueMessages[0].job.status, 'queued');

  const statusResponse = await requestFirstMatch(backend.app, jobStatusCandidates, {
    method: 'PATCH',
    headers: withDevUid({ 'content-type': 'application/json' }),
    body: JSON.stringify({
      status: 'running',
      progress: 50,
      message: 'Halfway there',
    }),
  });
  const statusPayload = await expectJsonResponse(statusResponse.response, 200);
  assert.equal(statusPayload.ok, true);
  assert.equal(statusPayload.jobId, 'contract-job');
  assert.equal(statusPayload.status, 'running');
  assert.equal(statusPayload.job.progress, 50);
  assert.equal(statusPayload.job.message, 'Halfway there');
});

test('local Durable Object mock supports queue coordination contracts', async () => {
  const { createMemoryDurableObjectNamespace } = await devBindingsModulePromise;
  const { JobCoordinator } = await import(pathToFileURL(path.resolve(BACKEND_ROOT, 'src/do/JobCoordinator.js')).href);
  const namespace = createMemoryDurableObjectNamespace(JobCoordinator);
  const stub = namespace.get(namespace.idFromName('default'));

  const enqueueResponse = await stub.fetch(new Request('http://job-coordinator/jobs', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      jobId: 'local-do-job',
      text: 'Local Durable Object parity test.',
    }),
  }));
  const enqueuePayload = await expectJsonResponse(enqueueResponse, 202);
  assert.equal(enqueuePayload.ok, true);
  assert.equal(enqueuePayload.job.jobId, 'local-do-job');

  const readResponse = await stub.fetch(new Request('http://job-coordinator/jobs/local-do-job'));
  const readPayload = await expectJsonResponse(readResponse, 200);
  assert.equal(readPayload.ok, true);
  assert.equal(readPayload.job.status, 'queued');
});

test('tts route contract is stable', async () => {
  const { response } = await requestFirstMatch(backend.app, ttsCandidates, {
    method: 'POST',
    headers: withDevUid({ 'content-type': 'application/json' }),
    body: JSON.stringify({}),
  });

  const payload = await expectJsonResponse(response, 400);
  assert.equal(typeof payload.error, 'string');
});

test('tts broker client merges caller headers without dropping defaults', async () => {
  const { createTtsBrokerClient } = await ttsModulePromise;
  const requests = [];
  const client = createTtsBrokerClient(
    {
      VF_TTS_BROKER_URL: 'https://broker.example.invalid/api/',
      VF_TTS_BROKER_API_KEY: 'secret-token',
    },
    {
      fetchImpl: async (url, init) => {
        requests.push({ url, init });
        return new Response(JSON.stringify({
          requestId: 'broker-request-1',
          status: 'queued',
        }), {
          status: 200,
          headers: {
            'content-type': 'application/json; charset=utf-8',
          },
        });
      },
    }
  );

  const response = await client.submit(
    {
      text: 'Hello world',
      voiceId: 'nova',
    },
    {
      headers: {
        'x-trace-id': 'trace-123',
      },
    }
  );

  assert.equal(response.requestId, 'broker-request-1');
  assert.equal(requests.length, 1);
  assert.equal(new URL(requests[0].url).pathname, '/api/requests');
  assert.equal(requests[0].init.method, 'POST');
  assert.equal(requests[0].init.headers.accept, 'application/json');
  assert.equal(requests[0].init.headers['content-type'], 'application/json');
  assert.equal(requests[0].init.headers.authorization, 'Bearer secret-token');
  assert.equal(requests[0].init.headers['x-trace-id'], 'trace-123');
  assert.equal(JSON.parse(requests[0].init.body).text, 'Hello world');
});

test('OpenAI-compatible TTS adapter calls external speech API without changing the route contract', async () => {
  const { synthesizeOpenAiSpeech } = await ttsModulePromise;
  const requests = [];
  const response = await synthesizeOpenAiSpeech(
    {
      VF_TTS_OPENAI_BASE_URL: 'https://api.deepinfra.example/v1/openai',
      VF_TTS_OPENAI_API_KEY: 'provider-token',
      VF_TTS_OPENAI_MODEL: 'ResembleAI/chatterbox-multilingual',
      VF_TTS_OPENAI_VOICE: 'None',
    },
    {
      requestId: 'ttsreq-contract-openai',
      text: 'Hello from contract tests.',
      format: 'mp3',
    },
    {
      fetchImpl: async (url, init) => {
        requests.push({ url, init });
        return new Response(new Uint8Array([1, 2, 3]), {
          status: 200,
          headers: {
            'content-type': 'audio/mpeg',
            'x-request-id': 'provider-request-1',
          },
        });
      },
    }
  );

  assert.equal(response.requestId, 'ttsreq-contract-openai');
  assert.equal(response.status, 'succeeded');
  assert.equal(response.providerRequestId, 'provider-request-1');
  assert.equal(response.contentType, 'audio/mpeg');
  assert.equal(response.audioBytes.byteLength, 3);
  assert.equal(requests.length, 1);
  assert.equal(new URL(requests[0].url).pathname, '/v1/openai/audio/speech');
  assert.equal(requests[0].init.method, 'POST');
  assert.equal(requests[0].init.headers.authorization, 'Bearer provider-token');
  assert.equal(JSON.parse(requests[0].init.body).model, 'ResembleAI/chatterbox-multilingual');
});

test('TTS route stores OpenAI-compatible provider audio in R2 when provider env is configured', async () => {
  const { createBackendApp } = await routesModulePromise;
  const { createMemoryR2Bucket } = await devBindingsModulePromise;
  const originalFetch = globalThis.fetch;
  const bucket = createMemoryR2Bucket();

  globalThis.fetch = async () => new Response(new Uint8Array([9, 8, 7, 6]), {
    status: 200,
    headers: {
      'content-type': 'audio/mpeg',
    },
  });

  try {
    const app = createBackendApp({
      env: {
        ARTIFACTS_BUCKET: bucket,
        VF_TTS_OPENAI_BASE_URL: 'https://api.deepinfra.example/v1/openai',
        VF_TTS_OPENAI_API_KEY: 'provider-token',
        VF_TTS_OPENAI_MODEL: 'ResembleAI/chatterbox-multilingual',
        VF_TTS_OPENAI_VOICE: 'None',
      },
    });

    const response = await app.fetch(new Request('https://voice-flow.example/api/v1/studio/tts/synthesize', {
      method: 'POST',
      headers: withDevUid({ 'content-type': 'application/json' }),
      body: JSON.stringify({
        requestId: 'ttsreq-route-openai',
        text: 'Store this audio.',
      }),
    }));
    const payload = await expectJsonResponse(response, 200);
    assert.equal(payload.ok, true);
    assert.equal(payload.status, 'succeeded');
    assert.equal(payload.artifactKey, 'tts/ttsreq-route-openai/ttsreq-route-openai.mp3');
    assert.match(payload.audioUrl, /\/api\/v1\/storage\/object\?key=tts%2Fttsreq-route-openai%2Fttsreq-route-openai\.mp3$/);

    const stored = await bucket.get(payload.artifactKey);
    assert.equal(stored.size, 4);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('job and TTS routes reject malformed JSON with stable error codes', async () => {
  const jobResponse = await requestFirstMatch(backend.app, jobCreateCandidates, {
    method: 'POST',
    headers: withDevUid({ 'content-type': 'application/json' }),
    body: '{',
  });
  const jobPayload = await expectJsonResponse(jobResponse.response, 400);
  assert.equal(jobPayload.error.code, 'invalid_json');

  const ttsResponse = await requestFirstMatch(backend.app, ttsCandidates, {
    method: 'POST',
    headers: withDevUid({ 'content-type': 'application/json' }),
    body: '{',
  });
  const ttsPayload = await expectJsonResponse(ttsResponse.response, 400);
  assert.equal(ttsPayload.error.code, 'invalid_json');
});

test('admin routes require a signed-in admin session', async () => {
  const { response } = await requestFirstMatch(backend.app, ['/api/v1/admin/users', '/admin/users'], {
    method: 'GET',
  });

  const payload = await expectJsonResponse(response, 401);
  assert.equal(payload.ok, false);
  assert.equal(payload.error.code, 'session_required');
});

test('bootstrap password hashing tolerates null policy input', async () => {
  const { createPasswordHash } = await authModulePromise;
  const hash = await createPasswordHash(CANONICAL_ADMIN_PASSWORD, null);
  assert.match(hash, /^pbkdf2_sha256\$/);
});

test('canonical admin bootstrap seed resolves the shared password and four admins', async () => {
  const { loadBootstrapSeedConfig } = await bootstrapModulePromise;
  const seed = loadBootstrapSeedConfig({
    BOOTSTRAP_SEED_SOURCE: 'wrangler-canonical-admins',
    BOOTSTRAP_ADMIN_SHARED_PASSWORD: CANONICAL_ADMIN_PASSWORD,
    BOOTSTRAP_ADMIN_USERS_JSON: JSON.stringify({
      admins: [
        { email: 'admin1@vflowai.com', roles: ['admin'] },
        { email: 'admin2@vflowai.com', roles: ['admin'] },
        { email: 'admin3@vflowai.com', roles: ['admin'] },
        { email: 'admin4@vflowai.com', roles: ['admin'] },
      ],
    }),
  });

  assert.equal(seed.source, 'wrangler-canonical-admins');
  assert.equal(seed.admins.length, 4);
  assert.deepEqual(
    seed.admins.map((admin) => admin.email),
    [
      'admin1@vflowai.com',
      'admin2@vflowai.com',
      'admin3@vflowai.com',
      'admin4@vflowai.com',
    ]
  );
  assert.ok(seed.admins.every((admin) => admin.password === CANONICAL_ADMIN_PASSWORD));
  assert.ok(seed.admins.every((admin) => Array.isArray(admin.roles) && admin.roles.includes('admin')));
});

test('auth bootstrap import requires a signed-in admin session when seed data is supplied', async () => {
  const { createMemoryD1Database } = await devBindingsModulePromise;
  const { bootstrapAuthStorage } = await bootstrapModulePromise;
  const { createBackendApp } = await routesModulePromise;
  const db = createMemoryD1Database();

  await db.exec(await readFile(new URL('../migrations/0001_init.sql', import.meta.url), 'utf8'));
  await bootstrapAuthStorage(db, {
    env: {
      BOOTSTRAP_SEED_SOURCE: 'wrangler-canonical-admins',
      BOOTSTRAP_ADMIN_SHARED_PASSWORD_HASH: CANONICAL_ADMIN_PASSWORD_HASH,
      BOOTSTRAP_ADMIN_USERS_JSON: JSON.stringify({
        admins: [
          { email: 'admin1@vflowai.com', roles: ['admin'] },
        ],
      }),
    },
    source: 'test-bootstrap-lock',
    now: Date.now(),
  });

  const app = createBackendApp({ db });
  const seedBody = JSON.stringify({
    seed: {
      admins: [
        { email: 'new-admin@vflowai.com', roles: ['admin'] },
      ],
    },
  });
  const blocked = await callApp(app, 'POST', '/api/auth/session/bootstrap', {
    headers: { 'content-type': 'application/json' },
    body: seedBody,
  });
  const blockedPayload = await expectJsonResponse(blocked, 401);
  assert.equal(blockedPayload.error.code, 'session_required');

  const login = await callApp(app, 'POST', '/api/auth/session', {
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      email: 'admin1@vflowai.com',
      password: CANONICAL_ADMIN_PASSWORD,
    }),
  });
  const loginPayload = await expectJsonResponse(login, 200);
  assert.equal(loginPayload.ok, true);
  assert.equal('password_hash' in loginPayload.user, false);
  assert.equal('token_hash' in loginPayload.session, false);

  const allowed = await callApp(app, 'POST', '/api/auth/session/bootstrap', {
    headers: {
      'content-type': 'application/json',
      cookie: login.headers.get('set-cookie'),
    },
    body: seedBody,
  });
  const allowedPayload = await expectJsonResponse(allowed, 200);
  assert.equal(allowedPayload.ok, true);
  assert.equal(allowedPayload.applied, true);
});

test('production account routes ignore spoofed user headers and accept the signed-in session actor', async () => {
  const { createMemoryD1Database } = await devBindingsModulePromise;
  const { bootstrapAuthStorage } = await bootstrapModulePromise;
  const { createBackendApp } = await routesModulePromise;
  const db = createMemoryD1Database();

  await db.exec(await readFile(new URL('../migrations/0001_init.sql', import.meta.url), 'utf8'));
  await bootstrapAuthStorage(db, {
    env: {
      BOOTSTRAP_SEED_SOURCE: 'wrangler-canonical-admins',
      BOOTSTRAP_ADMIN_SHARED_PASSWORD_HASH: CANONICAL_ADMIN_PASSWORD_HASH,
      BOOTSTRAP_ADMIN_USERS_JSON: JSON.stringify({
        admins: [
          { email: 'admin1@vflowai.com', roles: ['admin'] },
        ],
      }),
    },
    source: 'test-account-session-actor',
    now: Date.now(),
  });

  const app = createBackendApp({
    db,
    env: {
      VF_DEV_UID_HEADER_ENABLED: 'false',
    },
  });

  const spoofed = await app.fetch(new Request('https://voice-flow.example/api/v1/account/profile/bootstrap', {
    headers: {
      'x-user-id': 'spoofed-user',
    },
  }));
  const spoofedPayload = await expectJsonResponse(spoofed, 401);
  assert.equal(spoofedPayload.error.code, 'missing_user');

  const login = await app.fetch(new Request('https://voice-flow.example/api/auth/session', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      email: 'admin1@vflowai.com',
      password: CANONICAL_ADMIN_PASSWORD,
    }),
  }));
  const loginPayload = await expectJsonResponse(login, 200);
  assert.equal(loginPayload.ok, true);
  assert.equal('password_hash' in loginPayload.user, false);
  assert.equal('token_hash' in loginPayload.session, false);

  const sessionProfile = await app.fetch(new Request('https://voice-flow.example/api/v1/account/profile/bootstrap', {
    headers: {
      cookie: login.headers.get('set-cookie'),
      'x-user-id': 'spoofed-user',
    },
  }));
  const sessionPayload = await expectJsonResponse(sessionProfile, 200);
  assert.equal(sessionPayload.profile.userId, loginPayload.user.id);
  assert.notEqual(sessionPayload.profile.userId, 'spoofed-user');
});

test('dev D1 bootstrap supports a full seeded admin sign-in session', async () => {
  const { createMemoryD1Database } = await devBindingsModulePromise;
  const { bootstrapAuthStorage } = await bootstrapModulePromise;
  const { signInWithPassword } = await sessionsModulePromise;
  const wrangler = {
    vars: {
      BOOTSTRAP_SEED_SOURCE: 'wrangler-canonical-admins',
      BOOTSTRAP_ADMIN_SHARED_PASSWORD_HASH: CANONICAL_ADMIN_PASSWORD_HASH,
      BOOTSTRAP_ADMIN_USERS_JSON: JSON.stringify({
        admins: [
          { email: 'admin1@vflowai.com', roles: ['admin'] },
        ],
      }),
    },
  };

  const db = createMemoryD1Database();
  await db.exec(await readFile(new URL('../migrations/0001_init.sql', import.meta.url), 'utf8'));
  const summary = await bootstrapAuthStorage(db, {
    env: wrangler.vars,
    source: 'dev-server',
    now: Date.now(),
  });
  const login = await signInWithPassword(db, {
    email: 'admin1@vflowai.com',
    password: CANONICAL_ADMIN_PASSWORD,
    now: Date.now(),
  });

  assert.equal(summary.applied, true);
  assert.equal(login.ok, true);
  assert.equal('password_hash' in login.user, false);
  assert.equal('token_hash' in login.session, false);
  assert.equal(login.user.email_normalized, 'admin1@vflowai.com');
  assert.equal(login.session && typeof login.session.id === 'string', true);
  assert.equal(login.session.revoked_at, null);
});

test('admin user list reads seeded D1 auth users and roles', async () => {
  const { createMemoryD1Database } = await devBindingsModulePromise;
  const { bootstrapAuthStorage } = await bootstrapModulePromise;
  const { listAdminUsers, readAdminUser } = await adminModulePromise;
  const db = createMemoryD1Database();

  await db.exec(await readFile(new URL('../migrations/0001_init.sql', import.meta.url), 'utf8'));
  await bootstrapAuthStorage(db, {
    env: {
      BOOTSTRAP_SEED_SOURCE: 'wrangler-canonical-admins',
      BOOTSTRAP_ADMIN_SHARED_PASSWORD_HASH: CANONICAL_ADMIN_PASSWORD_HASH,
      BOOTSTRAP_ADMIN_USERS_JSON: JSON.stringify({
        admins: [
          { email: 'admin1@vflowai.com', roles: ['admin'] },
          { email: 'admin2@vflowai.com', roles: ['admin'] },
          { email: 'admin3@vflowai.com', roles: ['admin'] },
          { email: 'admin4@vflowai.com', roles: ['admin'] },
        ],
      }),
    },
    source: 'dev-server',
    now: Date.now(),
  });

  const listed = await listAdminUsers(db);
  const emails = listed.items.map((item) => item.email_normalized || item.email);

  assert.equal(listed.count, 4);
  assert.deepEqual(emails.sort(), [
    'admin1@vflowai.com',
    'admin2@vflowai.com',
    'admin3@vflowai.com',
    'admin4@vflowai.com',
  ]);
  assert.ok(listed.items.every((item) => item.roles.includes('admin')));

  const read = await readAdminUser(db, listed.items[0].userId);
  assert.equal(read.user.email_normalized, listed.items[0].email_normalized);
  assert.ok(read.user.roles.includes('admin'));
});

test('payload helpers resolve uid-backed entitlements rows', async () => {
  const { readPayloadRecord } = await accountModulePromise;
  const db = createSchemaAwareMockDb({
    schemaByTable: {
      account_entitlements: [
        { cid: 0, name: 'uid', pk: 1 },
        { cid: 1, name: 'plan_key', pk: 0 },
        { cid: 2, name: 'wallet_json', pk: 0 },
      ],
    },
    rowsByTable: {
      account_entitlements: [
        {
          uid: 'contract_user',
          plan_key: 'pro',
          wallet_json: JSON.stringify({ vfBalance: 12 }),
          payload: JSON.stringify({ wallet: { vfBalance: 12 } }),
          created_at: 1,
          updated_at: 2,
        },
      ],
    },
  });

  const row = await readPayloadRecord(db, 'account_entitlements', 'user_id', 'contract_user');
  assert.equal(row.uid, 'contract_user');
  assert.equal(row.plan_key, 'pro');
  assert.equal(row.payload.wallet.vfBalance, 12);
});

test('payload helpers write through uid primary keys while preserving user_id aliases', async () => {
  const { upsertPayloadRecord } = await accountModulePromise;
  const db = createSchemaAwareMockDb({
    schemaByTable: {
      account_profiles: [
        { cid: 0, name: 'uid', pk: 1 },
        { cid: 1, name: 'user_id', pk: 0 },
        { cid: 2, name: 'payload', pk: 0 },
        { cid: 3, name: 'created_at', pk: 0 },
        { cid: 4, name: 'updated_at', pk: 0 },
      ],
    },
    rowsByTable: {
      account_profiles: [
        {
          uid: 'contract_user',
          user_id: null,
          payload: JSON.stringify({ displayName: 'Old' }),
          created_at: 1,
          updated_at: 2,
        },
      ],
    },
  });

  const result = await upsertPayloadRecord(db, 'account_profiles', 'user_id', 'contract_user', {
    userId: 'contract_user',
    displayName: 'Updated',
  });

  assert.equal(result.uid, 'contract_user');
  assert.equal(result.user_id, 'contract_user');
  assert.equal(result.payload.displayName, 'Updated');
  assert.match(db.executed[0].sql, /ON\s+CONFLICT\(uid\)/i);
  assert.match(db.executed[0].sql, /\buser_id\b/i);
});

test('profile bootstrap persists and re-reads seeded admin profile data', async () => {
  const { handleProfileBootstrap } = await profileModulePromise;
  const { readAccountProfile, writeAccountProfile } = await accountModulePromise;
  const db = createSchemaAwareMockDb({
    schemaByTable: {
      account_profiles: [
        { cid: 0, name: 'uid', pk: 1 },
        { cid: 1, name: 'user_id', pk: 0 },
        { cid: 2, name: 'payload', pk: 0 },
        { cid: 3, name: 'created_at', pk: 0 },
        { cid: 4, name: 'updated_at', pk: 0 },
      ],
    },
  });

  const context = createMockContext(db, 'admin1');
  const bootstrapResponse = await handleProfileBootstrap(context, {});
  const bootstrapPayload = await bootstrapResponse.json();

  assert.equal(bootstrapResponse.status, 200);
  assert.equal(bootstrapPayload.requiredUserId, false);
  assert.equal(bootstrapPayload.profile.userId, 'admin1');

  await writeAccountProfile(db, 'admin1', {
    displayName: 'Admin One',
    billingProfile: {
      companyName: 'V Flow',
      email: 'billing@vflowai.com',
    },
    settings: {
      notifications: {
        emailSupport: false,
      },
    },
  });

  const stored = await readAccountProfile(db, 'admin1');
  assert.equal(stored.profile.userId, 'admin1');
  assert.equal(stored.profile.displayName, 'Admin One');
  assert.equal(stored.profile.billingProfile.companyName, 'V Flow');
  assert.equal(stored.profile.settings.notifications.emailSupport, false);
});

test('settings persistence round-trips nested notification flags for seeded admin accounts', async () => {
  const { readAccountSettings, writeAccountSettings } = await accountModulePromise;
  const db = createSchemaAwareMockDb({
    schemaByTable: {
      account_settings: [
        { cid: 0, name: 'uid', pk: 1 },
        { cid: 1, name: 'payload', pk: 0 },
        { cid: 2, name: 'created_at', pk: 0 },
        { cid: 3, name: 'updated_at', pk: 0 },
      ],
    },
  });

  await writeAccountSettings(db, 'admin2', {
    locale: 'en-US',
    notifications: {
      pushActivity: false,
      emailSecurity: false,
    },
  });

  const stored = await readAccountSettings(db, 'admin2');
  assert.equal(stored.settings.userId, 'admin2');
  assert.equal(stored.settings.locale, 'en-US');
  assert.equal(stored.settings.notifications.pushActivity, false);
  assert.equal(stored.settings.notifications.emailSecurity, false);
  assert.equal(stored.settings.notifications.emailSupport, true);
});

test('support messages persist and re-read conversation ids consistently', async () => {
  const { createSupportMessage, listSupportMessages, listSupportConversations } = await accountModulePromise;
  const db = createSchemaAwareMockDb({
    schemaByTable: {
      support_conversations: [
        { cid: 0, name: 'conversation_id', pk: 1 },
        { cid: 1, name: 'user_id', pk: 0 },
        { cid: 2, name: 'payload', pk: 0 },
        { cid: 3, name: 'created_at', pk: 0 },
        { cid: 4, name: 'updated_at', pk: 0 },
      ],
      support_messages: [
        { cid: 0, name: 'message_id', pk: 1 },
        { cid: 1, name: 'conversation_id', pk: 0 },
        { cid: 2, name: 'user_id', pk: 0 },
        { cid: 3, name: 'payload', pk: 0 },
        { cid: 4, name: 'created_at', pk: 0 },
        { cid: 5, name: 'updated_at', pk: 0 },
      ],
    },
  });

  const created = await createSupportMessage(db, 'admin3', {
    subject: 'Billing help',
    body: 'Need help with billing',
  });

  assert.equal(created.message.userId, 'admin3');
  assert.equal(created.conversation.userId, 'admin3');
  assert.equal(created.conversation.id, created.message.conversationId);

  const messages = await listSupportMessages(db, 'admin3');
  const conversations = await listSupportConversations(db, 'admin3');

  assert.equal(messages.items.length, 1);
  assert.equal(conversations.items.length, 1);
  assert.equal(conversations.items[0].id, created.message.conversationId);
  assert.equal(conversations.items[0].messages[0].conversationId, created.message.conversationId);
});
