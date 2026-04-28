import {
  base64UrlToBytes,
  bytesToBase64Url,
  constantTimeEqual,
  fetchAll,
  fetchOne,
  parseJson,
  normalizeEmail,
  normalizeSlug,
  pbkdf2Sha256,
  randomBytes,
  randomId,
  resolveDatabase,
  stringifyJson,
  toIsoString,
  runStatement,
} from './db.js';

const PASSWORD_ALGORITHM = 'pbkdf2_sha256';
const DEFAULT_PASSWORD_ITERATIONS = 100000;
const DEFAULT_PASSWORD_KEY_LENGTH = 32;
const DEFAULT_PASSWORD_SALT_LENGTH = 16;

function toText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function safeJson(value) {
  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value === 'string') {
    return value;
  }

  return stringifyJson(value);
}

function parsePasswordHash(encoded) {
  const raw = toText(encoded);
  if (!raw) {
    return null;
  }

  const parts = raw.split('$');
  if (parts.length !== 4) {
    return null;
  }

  const [algorithm, iterationsText, saltText, hashText] = parts;
  const iterations = Number.parseInt(iterationsText, 10);
  if (algorithm !== PASSWORD_ALGORITHM || !Number.isFinite(iterations) || iterations <= 0) {
    return null;
  }

  const saltBytes = base64UrlToBytes(saltText);
  const hashBytes = base64UrlToBytes(hashText);
  if (!saltBytes.length || !hashBytes.length) {
    return null;
  }

  return {
    algorithm,
    iterations,
    saltBytes,
    hashBytes,
  };
}

export function normalizeAuthPasswordPolicy(input = {}) {
  const policy = input && typeof input === 'object' ? input : {};
  return {
    iterations: Number.isFinite(policy.iterations) && policy.iterations > 0 ? Math.floor(policy.iterations) : DEFAULT_PASSWORD_ITERATIONS,
    keyLength: Number.isFinite(policy.keyLength) && policy.keyLength > 0 ? Math.floor(policy.keyLength) : DEFAULT_PASSWORD_KEY_LENGTH,
    saltLength: Number.isFinite(policy.saltLength) && policy.saltLength > 0 ? Math.floor(policy.saltLength) : DEFAULT_PASSWORD_SALT_LENGTH,
  };
}

export async function hashPassword(password, options = {}) {
  const policyInput = options && typeof options === 'object' ? options : {};
  const policy = normalizeAuthPasswordPolicy(policyInput);
  const saltBytes = policyInput.saltBytes instanceof Uint8Array ? policyInput.saltBytes : await randomBytes(policy.saltLength);
  const hashBytes = await pbkdf2Sha256(password, saltBytes, policy.iterations, policy.keyLength);
  return [
    PASSWORD_ALGORITHM,
    String(policy.iterations),
    bytesToBase64Url(saltBytes),
    bytesToBase64Url(hashBytes),
  ].join('$');
}

export async function verifyPasswordHash(password, encoded) {
  const parsed = parsePasswordHash(encoded);
  if (!parsed) {
    return {
      ok: false,
      needsRehash: false,
      algorithm: null,
      iterations: 0,
    };
  }

  const candidateHash = await pbkdf2Sha256(password, parsed.saltBytes, parsed.iterations, parsed.hashBytes.length);
  const ok = constantTimeEqual(candidateHash, parsed.hashBytes);
  return {
    ok,
    needsRehash: parsed.iterations < DEFAULT_PASSWORD_ITERATIONS,
    algorithm: parsed.algorithm,
    iterations: parsed.iterations,
  };
}

export async function createPasswordHash(password, options = {}) {
  return hashPassword(password, options);
}

export async function ensureRole(dbLike, roleInput) {
  const db = resolveDatabase(dbLike);
  const slug = normalizeSlug(roleInput?.slug || roleInput);
  if (!slug) {
    throw new Error('A role slug is required.');
  }

  const now = toIsoString(roleInput?.now);
  const existing = await fetchOne(db, 'SELECT * FROM roles WHERE slug = ?', [slug]);
  const payload = {
    name: toText(roleInput?.name) || slug,
    description: roleInput?.description ?? null,
    isSystem: roleInput?.isSystem ? 1 : 0,
  };

  if (existing) {
    await runStatement(
      db,
      `UPDATE roles
       SET name = ?, description = ?, is_system = ?, updated_at = ?
       WHERE slug = ?`,
      [payload.name, payload.description, payload.isSystem, now, slug]
    );
  } else {
    await runStatement(
      db,
      `INSERT INTO roles (id, slug, name, description, is_system, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [randomId('role'), slug, payload.name, payload.description, payload.isSystem, now, now]
    );
  }

  return fetchOne(db, 'SELECT * FROM roles WHERE slug = ?', [slug]);
}

export async function getRoleBySlug(dbLike, slug) {
  const db = resolveDatabase(dbLike);
  return fetchOne(db, 'SELECT * FROM roles WHERE slug = ?', [normalizeSlug(slug)]);
}

export async function listRoles(dbLike) {
  const db = resolveDatabase(dbLike);
  const result = await fetchAll(db, 'SELECT * FROM roles ORDER BY slug ASC');
  return result?.results ?? [];
}

export async function getUserByEmail(dbLike, email) {
  const db = resolveDatabase(dbLike);
  return fetchOne(db, 'SELECT * FROM users WHERE email_normalized = ?', [normalizeEmail(email)]);
}

export async function getUserById(dbLike, userId) {
  const db = resolveDatabase(dbLike);
  return fetchOne(db, 'SELECT * FROM users WHERE id = ?', [toText(userId)]);
}

export async function listUserRoles(dbLike, userId) {
  const db = resolveDatabase(dbLike);
  const result = await fetchAll(
    db,
    `SELECT r.*
     FROM user_roles ur
     JOIN roles r ON r.id = ur.role_id
     WHERE ur.user_id = ?
     ORDER BY r.slug ASC`,
    [toText(userId)]
  );
  return result?.results ?? [];
}

export async function upsertUser(dbLike, input) {
  const db = resolveDatabase(dbLike);
  const email = normalizeEmail(input?.email);
  if (!email) {
    throw new Error('A user email is required.');
  }

  const now = toIsoString(input?.now);
  const existing = await getUserByEmail(db, email);
  const metadataJson = safeJson(input?.metadata);
  const displayName = toText(input?.displayName) || input?.display_name || null;
  const status = toText(input?.status) || 'active';
  const passwordHash = input?.passwordHash ?? (input?.password ? await hashPassword(input.password, input.passwordPolicy) : existing?.password_hash ?? null);

  if (!existing) {
    await runStatement(
      db,
      `INSERT INTO users (id, email, email_normalized, display_name, password_hash, status, metadata_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        toText(input?.id) || randomId('user'),
        toText(input?.email) || email,
        email,
        displayName,
        passwordHash,
        status,
        metadataJson,
        now,
        now,
      ]
    );
  } else {
    const nextDisplayName = displayName !== null ? displayName : existing.display_name ?? null;
    const nextPasswordHash = passwordHash ?? existing.password_hash ?? null;
    const nextStatus = status || existing.status || 'active';
    await runStatement(
      db,
      `UPDATE users
       SET email = ?, email_normalized = ?, display_name = ?, password_hash = ?, status = ?, metadata_json = ?, updated_at = ?
       WHERE id = ?`,
      [
        toText(input?.email) || existing.email,
        email,
        nextDisplayName,
        nextPasswordHash,
        nextStatus,
        metadataJson ?? existing.metadata_json ?? null,
        now,
        existing.id,
      ]
    );
  }

  return getUserByEmail(db, email);
}

export async function assignRoleToUser(dbLike, { userId, roleSlug, roleName, assignedByUserId = null, now }) {
  const db = resolveDatabase(dbLike);
  const normalizedUserId = toText(userId);
  const normalizedRoleSlug = normalizeSlug(roleSlug);
  if (!normalizedUserId || !normalizedRoleSlug) {
    throw new Error('A userId and roleSlug are required.');
  }

  const role = await ensureRole(db, {
    slug: normalizedRoleSlug,
    name: roleName || normalizedRoleSlug,
    now,
  });
  const existing = await fetchOne(
    db,
    'SELECT * FROM user_roles WHERE user_id = ? AND role_id = ?',
    [normalizedUserId, role.id]
  );

  if (!existing) {
    await runStatement(
      db,
      `INSERT INTO user_roles (user_id, role_id, assigned_by_user_id, assigned_at)
       VALUES (?, ?, ?, ?)`,
      [normalizedUserId, role.id, assignedByUserId ? toText(assignedByUserId) : null, toIsoString(now)]
    );
  }

  return role;
}

export async function listUsersWithRoles(dbLike) {
  const db = resolveDatabase(dbLike);
  const result = await fetchAll(
    db,
    `SELECT
       u.*,
       COALESCE(
         json_group_array(
           json_object('id', r.id, 'slug', r.slug, 'name', r.name, 'description', r.description)
         ),
         '[]'
       ) AS roles_json
     FROM users u
     LEFT JOIN user_roles ur ON ur.user_id = u.id
     LEFT JOIN roles r ON r.id = ur.role_id
     GROUP BY u.id
     ORDER BY u.created_at ASC`
  );

  return (result?.results ?? []).map((row) => ({
    ...row,
    roles: parseJson(row.roles_json, []) ?? [],
  }));
}

export async function authenticateUserWithPassword(dbLike, { email, password }) {
  const db = resolveDatabase(dbLike);
  const user = await getUserByEmail(db, email);
  if (!user || !user.password_hash || user.status !== 'active') {
    return {
      ok: false,
      user: null,
      roles: [],
      needsRehash: false,
    };
  }

  const verification = await verifyPasswordHash(password, user.password_hash);
  if (!verification.ok) {
    return {
      ok: false,
      user: null,
      roles: [],
      needsRehash: verification.needsRehash,
    };
  }

  return {
    ok: true,
    user,
    roles: await listUserRoles(db, user.id),
    needsRehash: verification.needsRehash,
  };
}

export async function recordAuditHistory(dbLike, entry) {
  const db = resolveDatabase(dbLike);
  const createdAt = toIsoString(entry?.createdAt);
  const payload = {
    actorUserId: entry?.actorUserId ?? null,
    targetUserId: entry?.targetUserId ?? null,
    eventType: toText(entry?.eventType),
    subjectType: toText(entry?.subjectType) || null,
    subjectId: toText(entry?.subjectId) || null,
    beforeJson: safeJson(entry?.before) ?? null,
    afterJson: safeJson(entry?.after) ?? null,
    metadataJson: safeJson(entry?.metadata) ?? null,
    requestId: toText(entry?.requestId) || null,
  };

  if (!payload.eventType) {
    throw new Error('An audit event type is required.');
  }

  await runStatement(
    db,
    `INSERT INTO audit_history (
       id, actor_user_id, target_user_id, event_type, subject_type, subject_id,
       before_json, after_json, metadata_json, request_id, created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      randomId('audit'),
      payload.actorUserId,
      payload.targetUserId,
      payload.eventType,
      payload.subjectType,
      payload.subjectId,
      payload.beforeJson,
      payload.afterJson,
      payload.metadataJson,
      payload.requestId,
      createdAt,
    ]
  );
}

export async function resetPassword(dbLike, { userId, password, passwordPolicy, now }) {
  const db = resolveDatabase(dbLike);
  const existing = await getUserById(db, userId);
  if (!existing) {
    throw new Error('User not found.');
  }

  const nextPasswordHash = await hashPassword(password, passwordPolicy);
  await runStatement(
    db,
    'UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?',
    [nextPasswordHash, toIsoString(now), existing.id]
  );

  return getUserById(db, existing.id);
}

export async function markUserLogin(dbLike, { userId, now, ipAddress = null, userAgent = null }) {
  const db = resolveDatabase(dbLike);
  const timestamp = toIsoString(now);
  await runStatement(
    db,
    'UPDATE users SET last_login_at = ?, updated_at = ? WHERE id = ?',
    [timestamp, timestamp, toText(userId)]
  );

  if (ipAddress || userAgent) {
    await recordAuditHistory(db, {
      actorUserId: toText(userId),
      targetUserId: toText(userId),
      eventType: 'auth.login',
      subjectType: 'session',
      subjectId: null,
      metadata: { ipAddress, userAgent },
      createdAt: timestamp,
    });
  }
}

export async function importBootstrapUsers(dbLike, entries = [], options = {}) {
  const db = resolveDatabase(dbLike);
  const results = [];

  for (const rawEntry of entries) {
    const entry = typeof rawEntry === 'string' ? { email: rawEntry } : rawEntry || {};
    const user = await upsertUser(db, {
      ...entry,
      now: options.now,
      passwordPolicy: options.passwordPolicy,
    });
    results.push(user);

    const roles = Array.isArray(entry.roles) && entry.roles.length ? entry.roles : ['admin'];
    for (const role of roles) {
      await assignRoleToUser(db, {
        userId: user.id,
        roleSlug: role,
        assignedByUserId: options.assignedByUserId ?? null,
        now: options.now,
      });
    }

    await recordAuditHistory(db, {
      actorUserId: options.assignedByUserId ?? null,
      targetUserId: user.id,
      eventType: 'bootstrap.user.seeded',
      subjectType: 'user',
      subjectId: user.id,
      after: user,
      metadata: { source: 'bootstrap', roles },
      createdAt: options.now,
    });
  }

  return results;
}
