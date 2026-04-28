import {
  defaultAdminRolePayload,
  defaultAdminUserPayload,
  errorResponse,
  jsonResponse,
  normalizeUserId,
  readJsonBody,
  readPayloadRecord,
  resolveActorId,
  upsertPayloadRecord,
  deleteRecord,
  queryAll,
  TABLES,
  ensureSchema,
  makeId,
  run,
} from './account.js';
import {
  getUserById as getAuthUserById,
  listUserRoles as listAuthUserRoles,
  listUsersWithRoles as listAuthUsersWithRoles,
} from './auth.js';

function getDb(c, deps) {
  return c.env?.DB || deps.db;
}

function getActor(c, deps) {
  return normalizeUserId(resolveActorId(c, deps));
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function toRoleSlugs(roles) {
  const slugs = asArray(roles)
    .map((role) => (typeof role === 'string' ? role : role?.slug || role?.name))
    .map((role) => String(role || '').trim())
    .filter(Boolean);
  return slugs.length ? [...new Set(slugs)] : ['user'];
}

function fromAuthUserPayload(user, patch = {}) {
  const roles = toRoleSlugs(patch.roles || user?.roles);
  return defaultAdminUserPayload(user.id, {
    email: user.email_normalized || user.email || '',
    email_normalized: user.email_normalized || user.email || '',
    displayName: user.display_name || '',
    enabled: user.status !== 'disabled' && user.status !== 'suspended',
    role: roles.includes('admin') ? 'admin' : roles[0],
    roles,
    authUserId: user.id,
    status: user.status || 'active',
    createdAt: user.created_at || Date.now(),
    updatedAt: user.updated_at || Date.now(),
    ...patch,
    roles,
  });
}

async function listAdminUsers(db, limit = 100) {
  await ensureSchema(db);
  const rows = await queryAll(db, `SELECT * FROM ${TABLES.adminUsers} ORDER BY updated_at DESC LIMIT ?`, [limit]);
  const overlays = new Map(rows.map((row) => [row.user_id, row.payload || {}]));
  const authUsers = await listAuthUsersWithRoles(db);
  const items = [];
  const seen = new Set();

  for (const authUser of authUsers) {
    const overlay = overlays.get(authUser.id) || {};
    const item = fromAuthUserPayload(authUser, overlay);
    items.push(item);
    seen.add(item.userId);
  }

  for (const row of rows) {
    if (seen.has(row.user_id)) continue;
    items.push(defaultAdminUserPayload(row.user_id, row.payload || {}));
  }

  return { items: items.slice(0, limit), count: items.length };
}

async function readAdminUser(db, userId) {
  const row = await readPayloadRecord(db, TABLES.adminUsers, 'user_id', userId);
  const authUser = await getAuthUserById(db, userId);
  if (authUser) {
    return {
      user: fromAuthUserPayload(authUser, {
        ...(row?.payload || {}),
        roles: await listAuthUserRoles(db, authUser.id),
      }),
    };
  }

  return {
    user: defaultAdminUserPayload(userId, row?.payload || {}),
  };
}

async function writeAdminUser(db, userId, patch = {}) {
  const current = await readAdminUser(db, userId);
  const user = defaultAdminUserPayload(userId, {
    ...current.user,
    ...patch,
    roles: asArray(patch.roles || current.user.roles),
    entitlements: {
      ...(current.user.entitlements || {}),
      ...(patch.entitlements || {}),
    },
    billingProfile: {
      ...(current.user.billingProfile || {}),
      ...(patch.billingProfile || {}),
    },
    settings: {
      ...(current.user.settings || {}),
      ...(patch.settings || {}),
    },
  });

  await upsertPayloadRecord(db, TABLES.adminUsers, 'user_id', userId, user);
  return { user };
}

async function listRoles(db, limit = 100) {
  await ensureSchema(db);
  const rows = await queryAll(db, `SELECT * FROM ${TABLES.adminRoles} ORDER BY updated_at DESC LIMIT ?`, [limit]);
  const items = rows.map((row) => defaultAdminRolePayload(row.role_id, row.payload || {}));
  return { items, count: items.length };
}

async function readRole(db, roleId) {
  const row = await readPayloadRecord(db, TABLES.adminRoles, 'role_id', roleId);
  return {
    role: defaultAdminRolePayload(roleId, row?.payload || {}),
  };
}

async function writeRole(db, roleId, patch = {}) {
  const current = await readRole(db, roleId);
  const role = defaultAdminRolePayload(roleId, {
    ...current.role,
    ...patch,
    permissions: asArray(patch.permissions || current.role.permissions),
  });

  await upsertPayloadRecord(db, TABLES.adminRoles, 'role_id', roleId, role);
  return { role };
}

async function listUserRoles(db, userId) {
  await ensureSchema(db);
  const rows = await queryAll(
    db,
    `SELECT * FROM ${TABLES.adminUserRoles} WHERE user_id = ? ORDER BY updated_at DESC`,
    [userId]
  );
  return {
    items: rows.map((row) => ({
      userId: row.user_id,
      roleId: row.role_id,
      ...(row.payload || {}),
    })),
  };
}

async function replaceUserRoles(db, userId, roleIds = []) {
  await ensureSchema(db);
  const cleaned = [...new Set(asArray(roleIds).map((roleId) => String(roleId || '').trim()).filter(Boolean))];
  await run(db, `DELETE FROM ${TABLES.adminUserRoles} WHERE user_id = ?`, [userId]);

  for (const roleId of cleaned) {
    const payload = {
      userId,
      roleId,
      grantedAt: Date.now(),
    };
    await run(
      db,
      `INSERT INTO ${TABLES.adminUserRoles} (user_id, role_id, payload, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(user_id, role_id) DO UPDATE SET
         payload = excluded.payload,
         updated_at = excluded.updated_at`,
      [userId, roleId, JSON.stringify(payload), Date.now(), Date.now()]
    );
  }

  return {
    userId,
    roleIds: cleaned,
  };
}

async function handleUsersList(c, deps = {}) {
  const db = getDb(c, deps);
  if (!db) return errorResponse(c, 500, 'missing_db', 'D1 binding is required.');
  const url = new URL(c.req.url);
  const limit = Math.max(1, Math.min(200, Number(url.searchParams.get('limit') || 100)));
  return jsonResponse(c, await listAdminUsers(db, limit));
}

async function handleUserRead(c, deps = {}) {
  const db = getDb(c, deps);
  if (!db) return errorResponse(c, 500, 'missing_db', 'D1 binding is required.');
  const userId = String(c.req.param('userId') || '').trim();
  if (!userId) return errorResponse(c, 400, 'missing_user_id', 'userId is required.');
  return jsonResponse(c, await readAdminUser(db, userId));
}

async function handleUserWrite(c, deps = {}) {
  const db = getDb(c, deps);
  if (!db) return errorResponse(c, 500, 'missing_db', 'D1 binding is required.');
  const userId = String(c.req.param('userId') || '').trim();
  if (!userId) return errorResponse(c, 400, 'missing_user_id', 'userId is required.');
  const body = await readJsonBody(c.req);
  return jsonResponse(c, await writeAdminUser(db, userId, body));
}

async function handleRolesList(c, deps = {}) {
  const db = getDb(c, deps);
  if (!db) return errorResponse(c, 500, 'missing_db', 'D1 binding is required.');
  const url = new URL(c.req.url);
  const limit = Math.max(1, Math.min(200, Number(url.searchParams.get('limit') || 100)));
  return jsonResponse(c, await listRoles(db, limit));
}

async function handleRoleRead(c, deps = {}) {
  const db = getDb(c, deps);
  if (!db) return errorResponse(c, 500, 'missing_db', 'D1 binding is required.');
  const roleId = String(c.req.param('roleId') || '').trim();
  if (!roleId) return errorResponse(c, 400, 'missing_role_id', 'roleId is required.');
  return jsonResponse(c, await readRole(db, roleId));
}

async function handleRoleWrite(c, deps = {}) {
  const db = getDb(c, deps);
  if (!db) return errorResponse(c, 500, 'missing_db', 'D1 binding is required.');
  const roleId = String(c.req.param('roleId') || '').trim() || makeId('role');
  const body = await readJsonBody(c.req);
  return jsonResponse(c, await writeRole(db, roleId, body));
}

async function handleUserRolesRead(c, deps = {}) {
  const db = getDb(c, deps);
  if (!db) return errorResponse(c, 500, 'missing_db', 'D1 binding is required.');
  const userId = String(c.req.param('userId') || '').trim();
  if (!userId) return errorResponse(c, 400, 'missing_user_id', 'userId is required.');
  return jsonResponse(c, await listUserRoles(db, userId));
}

async function handleUserRolesWrite(c, deps = {}) {
  const db = getDb(c, deps);
  if (!db) return errorResponse(c, 500, 'missing_db', 'D1 binding is required.');
  const userId = String(c.req.param('userId') || '').trim();
  if (!userId) return errorResponse(c, 400, 'missing_user_id', 'userId is required.');
  const body = await readJsonBody(c.req);
  return jsonResponse(c, await replaceUserRoles(db, userId, body.roleIds || body.roles || []));
}

function registerAdminRoutes(app, deps = {}) {
  app.get('/admin/users', async (c) => handleUsersList(c, deps));
  app.get('/admin/users/:userId', async (c) => handleUserRead(c, deps));
  app.post('/admin/users/:userId', async (c) => handleUserWrite(c, deps));
  app.patch('/admin/users/:userId', async (c) => handleUserWrite(c, deps));
  app.get('/admin/roles', async (c) => handleRolesList(c, deps));
  app.get('/admin/roles/:roleId', async (c) => handleRoleRead(c, deps));
  app.post('/admin/roles/:roleId', async (c) => handleRoleWrite(c, deps));
  app.patch('/admin/roles/:roleId', async (c) => handleRoleWrite(c, deps));
  app.get('/admin/users/:userId/roles', async (c) => handleUserRolesRead(c, deps));
  app.post('/admin/users/:userId/roles', async (c) => handleUserRolesWrite(c, deps));
  app.patch('/admin/users/:userId/roles', async (c) => handleUserRolesWrite(c, deps));
}

export {
  handleRolesList,
  handleRoleRead,
  handleRoleWrite,
  handleUserRead,
  handleUserRolesRead,
  handleUserRolesWrite,
  handleUserWrite,
  handleUsersList,
  listAdminUsers,
  listRoles,
  listUserRoles,
  readAdminUser,
  readRole,
  registerAdminRoutes,
  replaceUserRoles,
  writeAdminUser,
  writeRole,
};
