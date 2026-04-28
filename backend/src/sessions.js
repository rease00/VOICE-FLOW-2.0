import {
  bytesToBase64Url,
  createId,
  fetchAll,
  fetchOne,
  randomBytes,
  resolveDatabase,
  runStatement,
  sha256Bytes,
  stringifyJson,
  toIsoString,
} from './db.js';
import {
  authenticateUserWithPassword,
  getUserById,
  listUserRoles,
  markUserLogin,
  recordAuditHistory,
} from './auth.js';

const DEFAULT_SESSION_TTL_DAYS = 30;
export const SESSION_COOKIE_NAME = 'vf_session';

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

export async function generateSessionToken(byteLength = 32) {
  return bytesToBase64Url(await randomBytes(byteLength));
}

export async function hashSessionToken(token) {
  return bytesToBase64Url(await sha256Bytes(token));
}

export function buildSessionCookieValue(token) {
  return toText(token);
}

export function parseSessionCookie(headerValue) {
  if (typeof headerValue !== 'string' || !headerValue.trim()) {
    return null;
  }

  const parts = headerValue.split(';');
  const firstPart = parts[0] || '';
  const separatorIndex = firstPart.indexOf('=');
  if (separatorIndex === -1) {
    return null;
  }

  const name = firstPart.slice(0, separatorIndex).trim();
  const value = firstPart.slice(separatorIndex + 1).trim();
  return name && value ? { name, value } : null;
}

export function buildSessionSetCookie(token, options = {}) {
  const cookieName = options.name || SESSION_COOKIE_NAME;
  const maxAge = Number.isFinite(options.maxAge) ? Math.floor(options.maxAge) : DEFAULT_SESSION_TTL_DAYS * 24 * 60 * 60;
  const attributes = [
    `${cookieName}=${encodeURIComponent(buildSessionCookieValue(token))}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
  ];

  if (options.secure !== false) {
    attributes.push('Secure');
  }

  if (Number.isFinite(maxAge)) {
    attributes.push(`Max-Age=${maxAge}`);
  }

  if (options.domain) {
    attributes.push(`Domain=${options.domain}`);
  }

  return attributes.join('; ');
}

export async function createSession(dbLike, input) {
  const db = resolveDatabase(dbLike);
  const userId = toText(input?.userId);
  if (!userId) {
    throw new Error('A userId is required.');
  }

  const now = toIsoString(input?.now);
  const ttlDays = Number.isFinite(input?.ttlDays) && input.ttlDays > 0 ? input.ttlDays : DEFAULT_SESSION_TTL_DAYS;
  const expiresAt = toIsoString(input?.expiresAt || new Date(Date.parse(now) + ttlDays * 24 * 60 * 60 * 1000));
  const token = input?.token || await generateSessionToken(input?.tokenLength);
  const tokenHash = await hashSessionToken(token);
  const metadataJson = safeJson(input?.metadata);

  await runStatement(
    db,
    `INSERT INTO sessions (
       id, user_id, token_hash, created_at, expires_at, revoked_at, last_seen_at,
       ip_address, user_agent, metadata_json
     ) VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?, ?)`,
    [
      createId('session'),
      userId,
      tokenHash,
      now,
      expiresAt,
      now,
      input?.ipAddress ?? null,
      input?.userAgent ?? null,
      metadataJson,
    ]
  );

  return {
    token,
    tokenHash,
    session: await findSessionByTokenHash(db, tokenHash),
  };
}

export async function findSessionByTokenHash(dbLike, tokenHash) {
  const db = resolveDatabase(dbLike);
  return fetchOne(
    db,
    `SELECT *
     FROM sessions
     WHERE token_hash = ?
       AND revoked_at IS NULL
       AND expires_at > ?`,
    [toText(tokenHash), toIsoString()]
  );
}

export async function findSessionByToken(dbLike, token) {
  const db = resolveDatabase(dbLike);
  const tokenHash = await hashSessionToken(token);
  return findSessionByTokenHash(db, tokenHash);
}

export async function getSessionContext(dbLike, token) {
  const db = resolveDatabase(dbLike);
  const session = await findSessionByToken(db, token);
  if (!session) {
    return null;
  }

  const user = await getUserById(db, session.user_id);
  if (!user) {
    return null;
  }

  return {
    session,
    user,
    roles: await listUserRoles(db, user.id),
  };
}

export async function touchSession(dbLike, { sessionId, now, ipAddress = null, userAgent = null }) {
  const db = resolveDatabase(dbLike);
  const timestamp = toIsoString(now);
  await runStatement(
    db,
    `UPDATE sessions
     SET last_seen_at = ?, ip_address = COALESCE(?, ip_address), user_agent = COALESCE(?, user_agent)
     WHERE id = ? AND revoked_at IS NULL`,
    [timestamp, ipAddress, userAgent, toText(sessionId)]
  );
}

export async function revokeSession(dbLike, { sessionId, revokedByUserId = null, now, reason = null }) {
  const db = resolveDatabase(dbLike);
  const timestamp = toIsoString(now);
  const session = await fetchOne(db, 'SELECT * FROM sessions WHERE id = ?', [toText(sessionId)]);

  if (!session) {
    return null;
  }

  if (!session.revoked_at) {
    await runStatement(
      db,
      'UPDATE sessions SET revoked_at = ? WHERE id = ?',
      [timestamp, session.id]
    );
  }

  if (revokedByUserId || reason) {
    await recordAuditHistory(db, {
      actorUserId: revokedByUserId ? toText(revokedByUserId) : null,
      targetUserId: session.user_id,
      eventType: 'auth.session.revoked',
      subjectType: 'session',
      subjectId: session.id,
      metadata: { reason },
      createdAt: timestamp,
    });
  }

  return session;
}

export async function revokeAllSessionsForUser(dbLike, { userId, now, revokedByUserId = null, reason = null }) {
  const db = resolveDatabase(dbLike);
  const timestamp = toIsoString(now);
  const normalizedUserId = toText(userId);

  const result = await fetchAll(
    db,
    'SELECT id FROM sessions WHERE user_id = ? AND revoked_at IS NULL',
    [normalizedUserId]
  );

  const sessionIds = (result?.results ?? []).map((row) => row.id);
  for (const sessionId of sessionIds) {
    await revokeSession(db, {
      sessionId,
      revokedByUserId,
      now: timestamp,
      reason,
    });
  }

  return sessionIds;
}

export async function pruneExpiredSessions(dbLike, { now } = {}) {
  const db = resolveDatabase(dbLike);
  const timestamp = toIsoString(now);
  const result = await runStatement(
    db,
    'DELETE FROM sessions WHERE expires_at <= ? OR revoked_at IS NOT NULL',
    [timestamp]
  );
  return result;
}

export async function authenticateSessionRequest(dbLike, { token, touch = true, now, ipAddress = null, userAgent = null } = {}) {
  const db = resolveDatabase(dbLike);
  const context = await getSessionContext(db, token);
  if (!context) {
    return {
      ok: false,
      user: null,
      session: null,
      roles: [],
    };
  }

  if (touch) {
    await touchSession(db, {
      sessionId: context.session.id,
      now,
      ipAddress,
      userAgent,
    });
  }

  return {
    ok: true,
    user: context.user,
    session: context.session,
    roles: context.roles,
  };
}

export async function signInWithPassword(dbLike, { email, password, now, ipAddress = null, userAgent = null, sessionTtlDays } = {}) {
  const db = resolveDatabase(dbLike);
  const login = await authenticateUserWithPassword(db, { email, password });
  if (!login.ok) {
    return {
      ok: false,
      user: null,
      session: null,
      token: null,
      roles: [],
    };
  }

  await markUserLogin(db, {
    userId: login.user.id,
    now,
    ipAddress,
    userAgent,
  });

  const session = await createSession(db, {
    userId: login.user.id,
    now,
    ttlDays: sessionTtlDays,
    ipAddress,
    userAgent,
    metadata: {
      loginMethod: 'password',
    },
  });

  return {
    ok: true,
    user: login.user,
    session: session.session,
    token: session.token,
    roles: login.roles,
    needsRehash: login.needsRehash,
  };
}
