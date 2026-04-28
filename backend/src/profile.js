import {
  defaultEntitlementsPayload,
  defaultProfilePayload,
  errorResponse,
  jsonResponse,
  normalizeUserId,
  readAccountEntitlements,
  readAccountProfile,
  readJsonBody,
  resolveActorId,
  upsertPayloadRecord,
  writeAccountProfile,
  TABLES,
} from './account.js';

function getDb(c, deps) {
  return c.env?.DB || deps.db;
}

function ensureUserId(c, deps) {
  const userId = resolveActorId(c, deps);
  return normalizeUserId(userId);
}

async function handleProfileRead(c, deps = {}) {
  const db = getDb(c, deps);
  const userId = ensureUserId(c, deps);
  if (!db) return errorResponse(c, 500, 'missing_db', 'D1 binding is required.');
  if (!userId) return errorResponse(c, 401, 'missing_user', 'User id is required.');
  return jsonResponse(c, await readAccountProfile(db, userId));
}

async function handleProfileUpsert(c, deps = {}) {
  const db = getDb(c, deps);
  const userId = ensureUserId(c, deps);
  if (!db) return errorResponse(c, 500, 'missing_db', 'D1 binding is required.');
  if (!userId) return errorResponse(c, 401, 'missing_user', 'User id is required.');
  const body = await readJsonBody(c.req);
  return jsonResponse(c, await writeAccountProfile(db, userId, body));
}

async function handleProfileBootstrap(c, deps = {}) {
  const db = getDb(c, deps);
  const userId = ensureUserId(c, deps);
  if (!db) return errorResponse(c, 500, 'missing_db', 'D1 binding is required.');
  if (!userId) return errorResponse(c, 401, 'missing_user', 'User id is required.');

  const current = await readAccountProfile(db, userId);
  const profile = defaultProfilePayload(userId, current.profile || {});
  await upsertPayloadRecord(db, TABLES.profiles, 'user_id', userId, profile);
  return jsonResponse(c, {
    profile,
    requiredUserId: false,
    suggestedUserId: null,
  });
}

async function handleEntitlementsRead(c, deps = {}) {
  const db = getDb(c, deps);
  const userId = ensureUserId(c, deps);
  if (!db) return errorResponse(c, 500, 'missing_db', 'D1 binding is required.');
  if (!userId) return errorResponse(c, 401, 'missing_user', 'User id is required.');
  return jsonResponse(c, await readAccountEntitlements(db, userId));
}

function registerProfileRoutes(app, deps = {}) {
  app.get('/account/profile', async (c) => handleProfileRead(c, deps));
  app.post('/account/profile', async (c) => handleProfileUpsert(c, deps));
  app.post('/account/profile/bootstrap', async (c) => handleProfileBootstrap(c, deps));
  app.get('/account/entitlements', async (c) => handleEntitlementsRead(c, deps));
}

export {
  handleEntitlementsRead,
  handleProfileBootstrap,
  handleProfileRead,
  handleProfileUpsert,
  registerProfileRoutes,
};

