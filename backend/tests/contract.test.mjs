import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
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

const storageCandidates = [
  '/api/v1/library/reader/object?key=missing',
  '/api/v1/storage/object?key=missing',
];

const jobCreateCandidates = [
  '/api/v1/library/audio-novel/jobs',
  '/api/v1/studio/tts/novel/jobs',
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

test('storage route contract is stable', async () => {
  const { response } = await requestFirstMatch(backend.app, storageCandidates, {
    method: 'GET',
    headers: withDevUid(),
  });

  const payload = await expectJsonResponse(response, 400);
  assert.equal(typeof payload.error, 'string');
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

test('tts route contract is stable', async () => {
  const { response } = await requestFirstMatch(backend.app, ttsCandidates, {
    method: 'POST',
    headers: withDevUid({ 'content-type': 'application/json' }),
    body: JSON.stringify({}),
  });

  const payload = await expectJsonResponse(response, 400);
  assert.equal(typeof payload.error, 'string');
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
