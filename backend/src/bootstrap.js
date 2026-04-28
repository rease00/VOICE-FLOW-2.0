import {
  assignRoleToUser,
  ensureRole,
  recordAuditHistory,
  upsertUser,
} from './auth.js';
import {
  createId,
  fetchOne,
  parseJson,
  resolveDatabase,
  runStatement,
  stringifyJson,
  toIsoString,
} from './db.js';

function toText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function toArray(value) {
  if (Array.isArray(value)) {
    return value;
  }

  if (value === null || value === undefined) {
    return [];
  }

  return [value];
}

function normalizeSeedUser(entry) {
  if (typeof entry === 'string') {
    return {
      email: entry,
      roles: ['admin'],
    };
  }

  if (!entry || typeof entry !== 'object') {
    return null;
  }

  const email = entry.email || entry.adminEmail || entry.address;
  if (!email) {
    return null;
  }

  return {
    id: entry.id || null,
    email,
    displayName: entry.displayName || entry.name || null,
    password: entry.password || entry.passwordPlaintext || null,
    passwordHash: entry.passwordHash || entry.password_hash || null,
    roles: toArray(entry.roles).filter(Boolean),
    status: entry.status || 'active',
    metadata: entry.metadata || null,
    passwordPolicy: entry.passwordPolicy || null,
  };
}

function normalizeSeedRole(entry) {
  if (typeof entry === 'string') {
    return {
      slug: entry,
      name: entry,
    };
  }

  if (!entry || typeof entry !== 'object') {
    return null;
  }

  const slug = entry.slug || entry.role || entry.name;
  if (!slug) {
    return null;
  }

  return {
    slug,
    name: entry.name || slug,
    description: entry.description || null,
    isSystem: entry.isSystem ?? entry.is_system ?? false,
  };
}

function normalizeSeedState(entry) {
  if (!entry) {
    return null;
  }

  if (typeof entry === 'string') {
    return {
      key: entry,
      value: 'true',
    };
  }

  if (typeof entry !== 'object') {
    return null;
  }

  const key = entry.key || entry.name || entry.stateKey;
  if (!key) {
    return null;
  }

  return {
    key,
    value: entry.value !== undefined ? entry.value : entry.stateValue !== undefined ? entry.stateValue : 'true',
    source: entry.source || null,
  };
}

function parseSeedPayload(raw) {
  if (!raw) {
    return null;
  }

  if (typeof raw === 'object' && !Array.isArray(raw)) {
    return raw;
  }

  if (typeof raw === 'string') {
    return parseJson(raw, null);
  }

  return null;
}

export function loadBootstrapSeedConfig(env = globalThis?.process?.env ?? {}) {
  const envObject = env && typeof env === 'object' ? env : {};
  const seedJson =
    envObject.BOOTSTRAP_SEED_JSON ||
    envObject.BOOTSTRAP_AUTH_SEED_JSON ||
    envObject.BOOTSTRAP_ADMIN_USERS_JSON ||
    envObject.BOOTSTRAP_ADMIN_EMAILS_JSON;

  const parsedSeed = parseSeedPayload(seedJson) || {};

  const adminEmails = toText(envObject.BOOTSTRAP_ADMIN_EMAILS || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);

  const adminUsersFromJson = toArray(parsedSeed.admins || parsedSeed.users || parsedSeed.adminUsers)
    .map(normalizeSeedUser)
    .filter(Boolean);

  const adminUsersFromEnv = adminEmails.map((email) => normalizeSeedUser(email)).filter(Boolean);

  const roles = toArray(parsedSeed.roles || parsedSeed.adminRoles || parsedSeed.bootstrapRoles)
    .map(normalizeSeedRole)
    .filter(Boolean);

  const state = toArray(parsedSeed.state || parsedSeed.bootstrapState)
    .map(normalizeSeedState)
    .filter(Boolean);

  return {
    source: envObject.BOOTSTRAP_SEED_SOURCE || envObject.BOOTSTRAP_SOURCE || 'env',
    admins: [...adminUsersFromJson, ...adminUsersFromEnv],
    roles,
    state,
    raw: parsedSeed,
  };
}

async function upsertBootstrapState(db, { key, value, source, now }) {
  await runStatement(
    db,
    `INSERT INTO bootstrap_state (state_key, state_value, source, updated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(state_key) DO UPDATE SET
       state_value = excluded.state_value,
       source = excluded.source,
       updated_at = excluded.updated_at`,
    [key, typeof value === 'string' ? value : stringifyJson(value), source ?? null, toIsoString(now)]
  );
}

export async function getBootstrapState(dbLike, key) {
  const db = resolveDatabase(dbLike);
  return fetchOne(db, 'SELECT * FROM bootstrap_state WHERE state_key = ?', [toText(key)]);
}

export async function setBootstrapState(dbLike, key, value, options = {}) {
  const db = resolveDatabase(dbLike);
  await upsertBootstrapState(db, {
    key: toText(key),
    value,
    source: options.source || 'bootstrap',
    now: options.now,
  });
  return getBootstrapState(db, key);
}

export async function bootstrapAuthStorage(dbLike, options = {}) {
  const db = resolveDatabase(dbLike);
  const env = options.env || globalThis?.process?.env || {};
  const seedConfig = options.seeds || loadBootstrapSeedConfig(env);
  const now = toIsoString(options.now);
  const source = options.source || seedConfig.source || 'env';
  const runId = createId('bootstrap');
  const summary = {
    applied: false,
    runId,
    source,
    roles: [],
    admins: [],
    state: [],
    skipped: [],
  };

  const hasWork =
    seedConfig.roles.length > 0 ||
    seedConfig.admins.length > 0 ||
    seedConfig.state.length > 0;

  await runStatement(
    db,
    `INSERT INTO bootstrap_runs (id, source, input_json, result_json, status, created_at)
     VALUES (?, ?, ?, NULL, 'started', ?)`,
    [runId, source, stringifyJson(seedConfig.raw ?? {}), now]
  );

  if (!hasWork) {
    await runStatement(
      db,
      'UPDATE bootstrap_runs SET status = ?, result_json = ?, completed_at = ? WHERE id = ?',
      ['noop', stringifyJson(summary), now, runId]
    );
    return summary;
  }

  const roleSlugs = new Set();
  for (const role of seedConfig.roles) {
    const roleRow = await ensureRole(db, {
      ...role,
      now,
    });
    summary.roles.push(roleRow);
    roleSlugs.add(roleRow.slug);
  }

  for (const adminEntry of seedConfig.admins) {
    const normalized = adminEntry;
    const user = await upsertUser(db, {
      ...normalized,
      now,
    });

    const roles = normalized.roles && normalized.roles.length ? normalized.roles : ['admin'];
    for (const roleSlug of roles) {
      const role = await ensureRole(db, {
        slug: roleSlug,
        name: roleSlug,
        now,
      });
      roleSlugs.add(role.slug);
      await assignRoleToUser(db, {
        userId: user.id,
        roleSlug: role.slug,
        now,
        assignedByUserId: options.assignedByUserId || null,
      });
    }

    summary.admins.push(user);

    await recordAuditHistory(db, {
      actorUserId: options.assignedByUserId || null,
      targetUserId: user.id,
      eventType: 'bootstrap.admin.seeded',
      subjectType: 'user',
      subjectId: user.id,
      after: user,
      metadata: {
        roles,
        source,
      },
      createdAt: now,
    });
  }

  for (const stateEntry of seedConfig.state) {
    await upsertBootstrapState(db, {
      key: stateEntry.key,
      value: stateEntry.value,
      source: stateEntry.source || source,
      now,
    });
    summary.state.push({
      key: stateEntry.key,
      value: stateEntry.value,
    });
  }

  await upsertBootstrapState(db, {
    key: 'auth.bootstrap.lastRunId',
    value: runId,
    source,
    now,
  });
  await upsertBootstrapState(db, {
    key: 'auth.bootstrap.lastSource',
    value: source,
    source,
    now,
  });
  await upsertBootstrapState(db, {
    key: 'auth.bootstrap.lastAppliedAt',
    value: now,
    source,
    now,
  });
  await upsertBootstrapState(db, {
    key: 'auth.bootstrap.roleCount',
    value: String(roleSlugs.size),
    source,
    now,
  });
  await upsertBootstrapState(db, {
    key: 'auth.bootstrap.adminCount',
    value: String(summary.admins.length),
    source,
    now,
  });

  summary.applied = true;

  await runStatement(
    db,
    'UPDATE bootstrap_runs SET status = ?, result_json = ?, completed_at = ? WHERE id = ?',
    ['applied', stringifyJson(summary), now, runId]
  );

  return summary;
}

export async function importBootstrapConfig(dbLike, config, options = {}) {
  const db = resolveDatabase(dbLike);
  const normalizedConfig = parseSeedPayload(config) || config || {};
  return bootstrapAuthStorage(db, {
    ...options,
    seeds: {
      source: options.source || normalizedConfig.source || 'json',
      admins: toArray(normalizedConfig.admins || normalizedConfig.users || normalizedConfig.adminUsers)
        .map(normalizeSeedUser)
        .filter(Boolean),
      roles: toArray(normalizedConfig.roles || normalizedConfig.adminRoles || normalizedConfig.bootstrapRoles)
        .map(normalizeSeedRole)
        .filter(Boolean),
      state: toArray(normalizedConfig.state || normalizedConfig.bootstrapState)
        .map(normalizeSeedState)
        .filter(Boolean),
      raw: normalizedConfig,
    },
  });
}

export async function seedSingleAdmin(dbLike, adminInput, options = {}) {
  const db = resolveDatabase(dbLike);
  const admin = normalizeSeedUser(adminInput);
  if (!admin) {
    throw new Error('A valid admin seed is required.');
  }

  const now = toIsoString(options.now);
  const user = await upsertUser(db, {
    ...admin,
    now,
  });

  const roles = admin.roles && admin.roles.length ? admin.roles : ['admin'];
  for (const roleSlug of roles) {
    await assignRoleToUser(db, {
      userId: user.id,
      roleSlug,
      now,
      assignedByUserId: options.assignedByUserId || null,
    });
  }

  await setBootstrapState(db, 'auth.bootstrap.lastSeededAdminEmail', user.email_normalized, {
    source: options.source || 'json',
    now,
  });

  return user;
}
