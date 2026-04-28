const DEFAULT_SUPPORT_EMAIL = 'support@v-flow-ai.com';
const DEFAULT_SUPPORT_TOPIC = 'account';

const TABLES = {
  profiles: 'account_profiles',
  entitlements: 'account_entitlements',
  settings: 'account_settings',
  conversations: 'support_conversations',
  messages: 'support_messages',
  billingAccounts: 'billing_accounts',
  billingSessions: 'billing_sessions',
  billingEvents: 'billing_events',
  adminUsers: 'admin_users',
  adminRoles: 'admin_roles',
  adminUserRoles: 'admin_user_roles',
};

const ensuredDbs = new WeakSet();
const tableSchemaCache = new WeakMap();

function now() {
  return Date.now();
}

function jsonResponse(c, body, status = 200) {
  if (c && typeof c.json === 'function') {
    return c.json(body, status);
  }

  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}

function errorResponse(c, status, code, message, extra = {}) {
  return jsonResponse(c, {
    ok: false,
    error: {
      code,
      message,
      ...extra,
    },
  }, status);
}

async function readJsonBody(request) {
  if (!request) return {};

  const method = String(request.method || 'GET').toUpperCase();
  if (method === 'GET' || method === 'HEAD') return {};

  const text = await request.text();
  if (!text.trim()) return {};

  try {
    return JSON.parse(text);
  } catch (_error) {
    throw new Error('Request body must be valid JSON.');
  }
}

function sanitizeId(value, fallback = 'item') {
  const text = String(value || '').trim().toLowerCase();
  const cleaned = text
    .replace(/[^a-z0-9._:-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
  return cleaned || fallback;
}

function makeId(prefix = 'item') {
  const nonce = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return `${sanitizeId(prefix, 'item')}_${nonce}`;
}

function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function deepMerge(base, patch) {
  if (!isPlainObject(base)) return patch;
  if (!isPlainObject(patch)) return patch;

  const merged = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    if (isPlainObject(value) && isPlainObject(merged[key])) {
      merged[key] = deepMerge(merged[key], value);
    } else {
      merged[key] = value;
    }
  }
  return merged;
}

function uniqueOrdered(values) {
  return [...new Set(values.filter((value) => typeof value === 'string' && value.trim()))];
}

function normalizeUserId(input) {
  const value = String(input || '').trim();
  return value || null;
}

function resolveActorId(c, deps = {}) {
  if (typeof deps.getUserId === 'function') {
    const resolved = deps.getUserId(c);
    if (resolved) return normalizeUserId(resolved);
  }

  const headerSources = [
    'x-dev-uid',
    'x-user-id',
    'x-vf-user-id',
    'x-account-user-id',
  ];

  const req = c?.req;
  if (req && typeof req.header === 'function') {
    for (const header of headerSources) {
      const value = normalizeUserId(req.header(header));
      if (value) return value;
    }
  }

  if (c && typeof c.get === 'function') {
    const stored = normalizeUserId(c.get('userId') || c.get('actorId') || c.get('uid'));
    if (stored) return stored;
  }

  return null;
}

async function getTableSchema(db, table) {
  if (!db || !table) {
    return { columns: [], primaryKeys: [] };
  }

  let dbCache = tableSchemaCache.get(db);
  if (!dbCache) {
    dbCache = new Map();
    tableSchemaCache.set(db, dbCache);
  }

  if (dbCache.has(table)) {
    return dbCache.get(table);
  }

  const escapedTable = String(table).replace(/"/g, '""');
  let rows = [];

  try {
    rows = await queryAll(db, `PRAGMA table_info("${escapedTable}")`);
  } catch (_error) {
    rows = [];
  }

  const columns = [];
  const primaryKeys = [];
  for (const row of rows) {
    const name = String(row?.name || '').trim();
    if (!name) continue;
    columns.push(name);
    if (Number(row?.pk || 0) > 0) {
      primaryKeys.push(name);
    }
  }

  const schema = { columns, primaryKeys };
  dbCache.set(table, schema);
  return schema;
}

async function resolveTableKeyPlan(db, table, preferredKeyColumn) {
  const schema = await getTableSchema(db, table);
  const readColumns = uniqueOrdered([
    ...schema.primaryKeys,
    preferredKeyColumn,
    'user_id',
    'uid',
    'id',
  ]).filter((column) => schema.columns.includes(column));

  const writeColumn = schema.primaryKeys.find((column) => schema.columns.includes(column))
    || readColumns[0]
    || preferredKeyColumn;

  const aliasColumns = [];
  if (writeColumn === 'uid' && schema.columns.includes('user_id')) {
    aliasColumns.push('user_id');
  } else if (writeColumn === 'user_id' && schema.columns.includes('uid')) {
    aliasColumns.push('uid');
  }

  return {
    schema,
    readColumns,
    writeColumn,
    aliasColumns,
  };
}

async function ensureSchema(db) {
  if (!db || ensuredDbs.has(db)) return;

  const statements = [
    `CREATE TABLE IF NOT EXISTS ${TABLES.profiles} (
      user_id TEXT PRIMARY KEY,
      payload TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS ${TABLES.entitlements} (
      user_id TEXT PRIMARY KEY,
      payload TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS ${TABLES.settings} (
      user_id TEXT PRIMARY KEY,
      payload TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS ${TABLES.conversations} (
      conversation_id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      payload TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS ${TABLES.messages} (
      message_id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      payload TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS ${TABLES.billingAccounts} (
      user_id TEXT PRIMARY KEY,
      payload TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS ${TABLES.billingSessions} (
      session_id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      payload TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS ${TABLES.billingEvents} (
      event_id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      payload TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS ${TABLES.adminUsers} (
      user_id TEXT PRIMARY KEY,
      payload TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS ${TABLES.adminRoles} (
      role_id TEXT PRIMARY KEY,
      payload TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS ${TABLES.adminUserRoles} (
      user_id TEXT NOT NULL,
      role_id TEXT NOT NULL,
      payload TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (user_id, role_id)
    )`,
  ];

  const normalizedStatements = statements.map((statement) => String(statement).replace(/\s+/g, ' ').trim());

  if (typeof db.exec === 'function') {
    for (const statement of normalizedStatements) {
      await db.exec(statement);
    }
  } else {
    for (const statement of normalizedStatements) {
      await db.prepare(statement).run();
    }
  }

  ensuredDbs.add(db);
}

async function queryOne(db, sql, bindings = []) {
  const stmt = db.prepare(sql);
  const bound = bindings.length ? stmt.bind(...bindings) : stmt;
  if (typeof bound.first === 'function') {
    return await bound.first();
  }

  const result = typeof bound.all === 'function' ? await bound.all() : await bound.run();
  if (Array.isArray(result?.results)) return result.results[0] || null;
  return result || null;
}

async function queryAll(db, sql, bindings = []) {
  const stmt = db.prepare(sql);
  const bound = bindings.length ? stmt.bind(...bindings) : stmt;
  const result = typeof bound.all === 'function' ? await bound.all() : await bound.run();
  if (Array.isArray(result?.results)) return result.results;
  if (Array.isArray(result)) return result;
  return [];
}

async function run(db, sql, bindings = []) {
  const stmt = db.prepare(sql);
  const bound = bindings.length ? stmt.bind(...bindings) : stmt;
  return typeof bound.run === 'function' ? await bound.run() : bound;
}

function parsePayloadRow(row) {
  if (!row) return null;
  if (row.payload == null) return row;
  if (typeof row.payload !== 'string') return row;

  try {
    const parsed = JSON.parse(row.payload);
    return isPlainObject(parsed) || Array.isArray(parsed) ? parsed : row;
  } catch (_error) {
    return row;
  }
}

async function readPayloadRecord(db, table, keyColumn, keyValue) {
  await ensureSchema(db);
  const { readColumns } = await resolveTableKeyPlan(db, table, keyColumn);

  for (const column of readColumns) {
    const row = await queryOne(
      db,
      `SELECT * FROM ${table} WHERE ${column} = ? LIMIT 1`,
      [keyValue]
    );
    if (!row) continue;
    return {
      ...row,
      payload: parsePayloadRow(row),
    };
  }

  return null;
}

async function upsertPayloadRecord(db, table, keyColumn, keyValue, payload, extraColumns = {}) {
  await ensureSchema(db);
  const timestamp = now();
  const data = JSON.stringify(payload ?? {});
  const createdAt = Number.isFinite(extraColumns.created_at) ? Number(extraColumns.created_at) : timestamp;
  const updatedAt = timestamp;
  const { writeColumn, aliasColumns } = await resolveTableKeyPlan(db, table, keyColumn);

  const extraEntries = new Map(Object.entries(extraColumns));
  for (const aliasColumn of aliasColumns) {
    if (!extraEntries.has(aliasColumn)) {
      extraEntries.set(aliasColumn, keyValue);
    }
  }

  const columns = [writeColumn, 'payload', 'created_at', 'updated_at'];
  const values = [keyValue, data, createdAt, updatedAt];
  const updates = ['payload = excluded.payload', 'updated_at = excluded.updated_at'];

  for (const [key, value] of extraEntries.entries()) {
    if (key === 'created_at' || key === 'updated_at') continue;
    columns.push(key);
    values.push(value);
    updates.push(`${key} = excluded.${key}`);
  }

  const placeholders = columns.map(() => '?').join(', ');
  const sql = `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${placeholders}) ON CONFLICT(${writeColumn}) DO UPDATE SET ${updates.join(', ')}`;
  await run(db, sql, values);
  return readPayloadRecord(db, table, keyColumn, keyValue);
}

async function deleteRecord(db, table, keyColumn, keyValue) {
  await ensureSchema(db);
  const { writeColumn } = await resolveTableKeyPlan(db, table, keyColumn);
  await run(db, `DELETE FROM ${table} WHERE ${writeColumn} = ?`, [keyValue]);
}

function defaultProfilePayload(userId, patch = {}) {
  return deepMerge(
    {
      userId,
      displayName: '',
      fullName: '',
      username: '',
      email: '',
      avatarUrl: '',
      bio: '',
      timezone: 'Asia/Calcutta',
      locale: 'en-IN',
      billingProfile: {
        companyName: '',
        contactName: '',
        email: '',
        phone: '',
        line1: '',
        line2: '',
        city: '',
        state: '',
        postalCode: '',
        country: 'IN',
        taxId: '',
        notes: '',
      },
      settings: {
        theme: 'aurora',
        motionLevel: 'balanced',
        notifications: {
          emailBilling: true,
          emailSupport: true,
          emailSecurity: true,
          emailProduct: true,
        },
      },
      roles: [],
      support: {
        email: DEFAULT_SUPPORT_EMAIL,
        topic: DEFAULT_SUPPORT_TOPIC,
      },
    },
    patch
  );
}

function defaultEntitlementsPayload(userId, patch = {}) {
  return deepMerge(
    {
      userId,
      wallet: {
        vfBalance: 0,
        vcFreeBalance: 0,
        vcGrantedBalance: 0,
        vcPaidBalance: 0,
        vcSpendableBalance: 0,
        monthlyFreeRemaining: 0,
        monthlyFreeLimit: 0,
        spendableNowByEngine: {
          VECTOR: 0,
          PRIME: 0,
        },
      },
      subscription: {
        status: 'inactive',
        planId: null,
        planName: null,
        provider: 'd1',
        renewsAt: null,
        cancelAtPeriodEnd: false,
      },
      billingProfile: {
        companyName: '',
        contactName: '',
        email: '',
        phone: '',
        line1: '',
        line2: '',
        city: '',
        state: '',
        postalCode: '',
        country: 'IN',
        taxId: '',
      },
      support: {
        email: DEFAULT_SUPPORT_EMAIL,
        topic: DEFAULT_SUPPORT_TOPIC,
      },
    },
    patch
  );
}

function defaultSettingsPayload(userId, patch = {}) {
  return deepMerge(
    {
      userId,
      theme: 'aurora',
      motionLevel: 'balanced',
      locale: 'en-IN',
      timezone: 'Asia/Calcutta',
      notifications: {
        emailBilling: true,
        emailSupport: true,
        emailSecurity: true,
        emailProduct: true,
        pushActivity: true,
      },
    },
    patch
  );
}

function defaultBillingSummaryPayload(userId, patch = {}) {
  return deepMerge(
    {
      userId,
      account: {
        userId,
        email: '',
        displayName: '',
        country: 'IN',
      },
      billingProfile: defaultProfilePayload(userId).billingProfile,
      subscription: {
        status: 'inactive',
        planId: null,
        planName: null,
        provider: 'd1',
        renewsAt: null,
        cancelAtPeriodEnd: false,
        lastBilledAt: null,
      },
      wallet: defaultEntitlementsPayload(userId).wallet,
      invoices: [],
      portal: {
        enabled: false,
        url: null,
      },
      support: {
        email: DEFAULT_SUPPORT_EMAIL,
        topic: DEFAULT_SUPPORT_TOPIC,
      },
    },
    patch
  );
}

function defaultConversationPayload(userId, patch = {}) {
  return deepMerge(
    {
      id: patch.id || makeId('conversation'),
      userId,
      subject: 'Support request',
      status: 'open',
      unreadCount: 0,
      lastMessageAt: null,
      messages: [],
    },
    patch
  );
}

function defaultSupportMessagePayload(userId, patch = {}) {
  return deepMerge(
    {
      id: patch.id || makeId('message'),
      conversationId: patch.conversationId || makeId('conversation'),
      userId,
      subject: 'Support request',
      body: '',
      category: 'general',
      status: 'open',
      priority: 'normal',
      email: '',
      createdAt: now(),
      updatedAt: now(),
    },
    patch
  );
}

function defaultAdminUserPayload(userId, patch = {}) {
  return deepMerge(
    {
      userId,
      email: '',
      displayName: '',
      fullName: '',
      username: '',
      avatarUrl: '',
      enabled: true,
      role: 'user',
      roles: ['user'],
      billingProfile: defaultProfilePayload(userId).billingProfile,
      entitlements: defaultEntitlementsPayload(userId).wallet,
      settings: defaultSettingsPayload(userId),
      createdAt: now(),
      updatedAt: now(),
    },
    patch
  );
}

function defaultAdminRolePayload(roleId, patch = {}) {
  return deepMerge(
    {
      roleId,
      name: roleId,
      description: '',
      permissions: [],
      enabled: true,
      createdAt: now(),
      updatedAt: now(),
    },
    patch
  );
}

async function readAccountProfile(db, userId) {
  const row = await readPayloadRecord(db, TABLES.profiles, 'user_id', userId);
  if (!row) {
    const profile = defaultProfilePayload(userId);
    return {
      profile,
      requiredUserId: false,
      suggestedUserId: null,
    };
  }

  const profile = defaultProfilePayload(userId, row.payload || {});
  return {
    profile,
    requiredUserId: false,
    suggestedUserId: null,
  };
}

async function writeAccountProfile(db, userId, patch = {}) {
  const current = await readAccountProfile(db, userId);
  const profile = defaultProfilePayload(userId, deepMerge(current.profile, patch));
  await upsertPayloadRecord(db, TABLES.profiles, 'user_id', userId, profile);
  return {
    profile,
    requiredUserId: false,
    suggestedUserId: null,
  };
}

async function readAccountEntitlements(db, userId) {
  const row = await readPayloadRecord(db, TABLES.entitlements, 'user_id', userId);
  return {
    entitlements: defaultEntitlementsPayload(userId, row?.payload || {}),
  };
}

async function readAccountSettings(db, userId) {
  const row = await readPayloadRecord(db, TABLES.settings, 'user_id', userId);
  return {
    settings: defaultSettingsPayload(userId, row?.payload || {}),
  };
}

async function writeAccountSettings(db, userId, patch = {}) {
  const current = await readAccountSettings(db, userId);
  const settings = defaultSettingsPayload(userId, deepMerge(current.settings, patch));
  await upsertPayloadRecord(db, TABLES.settings, 'user_id', userId, settings);
  return { settings };
}

async function listSupportConversations(db, userId, limit = 50) {
  await ensureSchema(db);
  const rows = await queryAll(
    db,
    `SELECT * FROM ${TABLES.conversations} WHERE user_id = ? ORDER BY updated_at DESC LIMIT ?`,
    [userId, limit]
  );
  const items = rows.map((row) => defaultConversationPayload(userId, parsePayloadRow(row) || {}));
  return { items };
}

async function listSupportMessages(db, userId, limit = 50) {
  await ensureSchema(db);
  const rows = await queryAll(
    db,
    `SELECT * FROM ${TABLES.messages} WHERE user_id = ? ORDER BY created_at DESC LIMIT ?`,
    [userId, limit]
  );
  const items = rows.map((row) => defaultSupportMessagePayload(userId, parsePayloadRow(row) || {}));
  return { items };
}

async function createSupportMessage(db, userId, patch = {}) {
  const message = defaultSupportMessagePayload(userId, patch);
  if (!message.conversationId) {
    message.conversationId = makeId('conversation');
  }
  if (!message.subject) {
    message.subject = 'Support request';
  }

  const conversationRow = await readPayloadRecord(db, TABLES.conversations, 'conversation_id', message.conversationId);
  const conversation = defaultConversationPayload(userId, conversationRow?.payload || {});
  const nextConversation = {
    ...conversation,
    subject: message.subject || conversation.subject,
    status: 'open',
    unreadCount: Number.isFinite(conversation.unreadCount) ? Number(conversation.unreadCount) : 0,
    lastMessageAt: message.createdAt || now(),
    messages: [...(conversation.messages || []), message],
    updatedAt: now(),
  };

  await upsertPayloadRecord(
    db,
    TABLES.conversations,
    'conversation_id',
    message.conversationId,
    nextConversation,
    { user_id: userId }
  );

  await upsertPayloadRecord(db, TABLES.messages, 'message_id', message.id, message, {
    conversation_id: message.conversationId,
    user_id: userId,
  });

  return {
    message,
    conversation: nextConversation,
  };
}

function registerAccountRoutes(app, deps = {}) {
  app.get('/account/settings', async (c) => {
    const db = c.env?.DB || deps.db;
    const userId = resolveActorId(c, deps);
    if (!db) return errorResponse(c, 500, 'missing_db', 'D1 binding is required.');
    if (!userId) return errorResponse(c, 401, 'missing_user', 'User id is required.');
    return jsonResponse(c, await readAccountSettings(db, userId));
  });

  app.patch('/account/settings', async (c) => {
    const db = c.env?.DB || deps.db;
    const userId = resolveActorId(c, deps);
    if (!db) return errorResponse(c, 500, 'missing_db', 'D1 binding is required.');
    if (!userId) return errorResponse(c, 401, 'missing_user', 'User id is required.');
    const body = await readJsonBody(c.req);
    return jsonResponse(c, await writeAccountSettings(db, userId, body));
  });

  app.get('/account/support/messages', async (c) => {
    const db = c.env?.DB || deps.db;
    const userId = resolveActorId(c, deps);
    if (!db) return errorResponse(c, 500, 'missing_db', 'D1 binding is required.');
    if (!userId) return errorResponse(c, 401, 'missing_user', 'User id is required.');
    const url = new URL(c.req.url);
    const limit = Math.max(1, Math.min(200, Number(url.searchParams.get('limit') || 50)));
    return jsonResponse(c, await listSupportMessages(db, userId, limit));
  });

  app.post('/account/support/messages', async (c) => {
    const db = c.env?.DB || deps.db;
    const userId = resolveActorId(c, deps);
    if (!db) return errorResponse(c, 500, 'missing_db', 'D1 binding is required.');
    if (!userId) return errorResponse(c, 401, 'missing_user', 'User id is required.');
    const body = await readJsonBody(c.req);
    return jsonResponse(c, await createSupportMessage(db, userId, body));
  });

  app.get('/account/support/conversations/me', async (c) => {
    const db = c.env?.DB || deps.db;
    const userId = resolveActorId(c, deps);
    if (!db) return errorResponse(c, 500, 'missing_db', 'D1 binding is required.');
    if (!userId) return errorResponse(c, 401, 'missing_user', 'User id is required.');
    const url = new URL(c.req.url);
    const limit = Math.max(1, Math.min(200, Number(url.searchParams.get('limit') || 50)));
    return jsonResponse(c, await listSupportConversations(db, userId, limit));
  });
}

export {
  DEFAULT_SUPPORT_EMAIL,
  DEFAULT_SUPPORT_TOPIC,
  TABLES,
  deepMerge,
  deleteRecord,
  defaultAdminRolePayload,
  defaultAdminUserPayload,
  defaultBillingSummaryPayload,
  defaultConversationPayload,
  defaultEntitlementsPayload,
  defaultProfilePayload,
  defaultSettingsPayload,
  defaultSupportMessagePayload,
  ensureSchema,
  errorResponse,
  jsonResponse,
  listSupportConversations,
  listSupportMessages,
  createSupportMessage,
  makeId,
  normalizeUserId,
  queryAll,
  queryOne,
  readAccountEntitlements,
  readAccountProfile,
  readAccountSettings,
  readJsonBody,
  readPayloadRecord,
  registerAccountRoutes,
  resolveActorId,
  run,
  sanitizeId,
  upsertPayloadRecord,
  writeAccountProfile,
  writeAccountSettings,
};
