import { Hono } from 'hono';
import {
  defaultAdminRolePayload,
  defaultAdminUserPayload,
  defaultBillingSummaryPayload,
  defaultConversationPayload,
  defaultEntitlementsPayload,
  defaultProfilePayload,
  defaultSettingsPayload,
  defaultSupportMessagePayload,
  errorResponse,
  jsonResponse,
  makeId,
  normalizeUserId,
  readAccountEntitlements,
  readAccountProfile,
  readAccountSettings,
  readJsonBody,
  resolveActorId,
  upsertPayloadRecord,
  writeAccountProfile,
  writeAccountSettings,
  listSupportConversations,
  listSupportMessages,
  createSupportMessage,
  TABLES,
} from './account.js';
import {
  authenticateSessionRequest,
  buildSessionSetCookie,
  revokeSession,
  signInWithPassword,
} from './sessions.js';
import {
  bootstrapAuthStorage,
  importBootstrapConfig,
} from './bootstrap.js';
import {
  createJobStatus,
  submitJob,
} from './jobs.js';
import {
  STORAGE_ENV_KEYS,
  buildArtifactKey,
  normalizeArtifactKey,
  resolveArtifactBucket,
  getArtifact,
  putArtifact,
  deleteArtifact,
  listArtifacts,
} from './storage.js';
import {
  createTtsBrokerClient,
  normalizeTtsRequest,
  resolveOpenAiTtsConfig,
  resolveTtsBrokerConfig,
  synthesizeOpenAiSpeech,
  TTS_ENV_KEYS,
} from './tts.js';
import {
  listAdminUsers,
  listRoles,
  listUserRoles,
  readAdminUser,
  readRole,
  replaceUserRoles,
  writeAdminUser,
  writeRole,
} from './admin.js';
import {
  normalizeBillingReturnUrl,
  readBillingSummary,
  writeBillingSummary,
} from './billing.js';

const DEFAULT_ROUTE_MAP = Object.freeze({
  auth: ['/api/auth', '/auth'],
  account: '/api/v1/account',
  billing: '/api/v1/billing',
  admin: '/api/v1/admin',
  storage: ['/api/v1/storage', '/api/v1/library/reader'],
  jobs: ['/api/v1/library/audio-novel', '/api/v1/studio/tts/novel'],
  tts: ['/api/v1/studio/tts', '/api/v1/tts'],
  ops: '/api/v1/ops',
});

const LOCAL_CORS_ORIGIN_PATTERN = /^https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?$/i;
const rateLimitBuckets = new Map();

const RATE_LIMITS = Object.freeze({
  auth: { limit: 20, windowMs: 10 * 60 * 1000 },
  billing: { limit: 30, windowMs: 60 * 1000 },
  jobs: { limit: 60, windowMs: 60 * 1000 },
  tts: { limit: 30, windowMs: 60 * 1000 },
});

function buildLocalCorsHeaders(c) {
  const origin = String(c.req.header('origin') || '').trim();
  if (!origin || !LOCAL_CORS_ORIGIN_PATTERN.test(origin)) {
    return null;
  }

  return {
    'access-control-allow-origin': origin,
    'access-control-allow-credentials': 'true',
    'access-control-allow-methods': 'GET,HEAD,POST,PATCH,PUT,DELETE,OPTIONS',
    'access-control-allow-headers': 'content-type,accept,authorization,x-dev-session-token,x-session-token',
    'access-control-max-age': '86400',
    vary: 'Origin',
  };
}

function setSecurityHeaders(c) {
  c.header('x-content-type-options', 'nosniff');
  c.header('referrer-policy', 'strict-origin-when-cross-origin');
  c.header('permissions-policy', 'camera=(), microphone=(), geolocation=()');
  c.header('cache-control', 'no-store');
  if (isHttpsRequest(c)) {
    c.header('strict-transport-security', 'max-age=31536000; includeSubDomains');
  }
}

function makeRequestId() {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function getDb(c, deps = {}) {
  return c?.env?.DB || deps.db || null;
}

function getEnv(c, deps = {}) {
  return c?.env || deps.env || {};
}

function isHttpsRequest(c) {
  try {
    return new URL(c.req.url).protocol === 'https:';
  } catch {
    return false;
  }
}

function getRequestUserId(c, deps = {}) {
  return normalizeUserId(resolveActorId(c, deps));
}

function isTruthy(value) {
  const normalized = String(value ?? '').trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
}

function isLocalUrl(c) {
  try {
    const hostname = new URL(c.req.url).hostname.toLowerCase();
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
  } catch {
    return false;
  }
}

function getClientIp(c) {
  return String(
    c.req.header('cf-connecting-ip')
      || c.req.header('x-forwarded-for')?.split(',')[0]
      || 'unknown'
  ).trim() || 'unknown';
}

function enforceRateLimit(c, bucketName, options = {}) {
  const limit = Number(options.limit || RATE_LIMITS[bucketName]?.limit || 60);
  const windowMs = Number(options.windowMs || RATE_LIMITS[bucketName]?.windowMs || 60000);
  const nowMs = Date.now();
  const key = `${bucketName}:${getClientIp(c)}`;
  const current = rateLimitBuckets.get(key);

  if (!current || current.resetAtMs <= nowMs) {
    rateLimitBuckets.set(key, {
      count: 1,
      resetAtMs: nowMs + windowMs,
    });
    return null;
  }

  current.count += 1;
  if (current.count <= limit) {
    return null;
  }

  const retryAfterSeconds = Math.max(1, Math.ceil((current.resetAtMs - nowMs) / 1000));
  return errorResponse(c, 429, 'rate_limited', 'Too many requests. Please retry later.', {
    retryAfterSeconds,
  });
}

async function requireAdminSession(c, deps = {}) {
  const token = readSessionToken(c);
  if (!token) {
    return {
      ok: false,
      response: buildAuthFailure(c, 'session_required', 'A valid session is required.'),
    };
  }

  const db = getDb(c, deps);
  if (!db) {
    return {
      ok: false,
      response: buildAuthFailure(c, 'auth_store_unavailable', 'D1 binding is required.', 503),
    };
  }

  const session = await authenticateSessionRequest(db, {
    token,
    touch: false,
    ipAddress: c.req.header('cf-connecting-ip') || null,
    userAgent: c.req.header('user-agent') || null,
  });

  if (!session.ok) {
    return {
      ok: false,
      response: buildAuthFailure(c, 'session_required', 'A valid session is required.'),
    };
  }

  const hasAdminRole = Array.isArray(session.roles) && session.roles.some((role) => {
    const slug = String(role?.slug || role?.role || role?.name || '').trim().toLowerCase();
    return slug === 'admin' || slug === 'superadmin';
  });

  if (!hasAdminRole) {
    return {
      ok: false,
      response: buildAuthFailure(c, 'admin_required', 'Admin privileges are required.', 403),
    };
  }

  c.set('userId', session.user?.id || null);
  c.set('actorId', session.user?.id || null);
  c.set('sessionUser', session.user);
  c.set('sessionRoles', session.roles);

  return {
    ok: true,
    db,
    session,
  };
}

async function attachSessionActor(c, deps = {}) {
  if (c && typeof c.get === 'function') {
    const existing = c.get('userId') || c.get('actorId');
    if (existing) {
      return null;
    }
  }

  const token = readSessionToken(c);
  const db = getDb(c, deps);
  if (!token || !db) {
    return null;
  }

  const session = await authenticateSessionRequest(db, {
    token,
    touch: false,
    ipAddress: c.req.header('cf-connecting-ip') || null,
    userAgent: c.req.header('user-agent') || null,
  });

  if (!session.ok) {
    return null;
  }

  c.set('userId', session.user?.id || null);
  c.set('actorId', session.user?.id || null);
  c.set('sessionUser', session.user);
  c.set('sessionRoles', session.roles);

  return session;
}

async function requireActor(c, deps = {}) {
  await attachSessionActor(c, deps);
  const userId = getRequestUserId(c, deps);
  if (!userId) {
    return {
      ok: false,
      response: buildAuthFailure(c, 'session_required', 'A valid session is required.'),
    };
  }

  return {
    ok: true,
    userId,
  };
}

function isDevEndpointAllowed(c, deps = {}) {
  const env = getEnv(c, deps);
  return isLocalUrl(c) || isTruthy(env.VF_DEV_ENDPOINTS_ENABLED);
}

function readSessionToken(c) {
  const authHeader = String(c.req.header('authorization') || '').trim();
  if (authHeader.toLowerCase().startsWith('bearer ')) {
    return authHeader.slice(7).trim() || null;
  }

  const cookieHeader = String(c.req.header('cookie') || '').trim();
  const cookieMatch = cookieHeader.match(/(?:^|;\s*)vf_session=([^;]+)/i);
  if (cookieMatch?.[1]) {
    return decodeURIComponent(cookieMatch[1]);
  }

  const devSessionToken = c.req.header('x-dev-session-token');
  if (devSessionToken && isDevEndpointAllowed(c)) {
    return devSessionToken;
  }

  return c.req.header('x-session-token') || null;
}

function buildAuthFailure(c, code, message, status = 401) {
  return errorResponse(c, status, code, message);
}

async function readRequestBody(c) {
  try {
    return await readJsonBody(c.req);
  } catch (error) {
    return {
      __error: error instanceof Error ? error.message : String(error),
    };
  }
}

function buildRuntimeStatus(c, deps = {}) {
  const env = getEnv(c, deps);
  const ttsBroker = resolveTtsBrokerConfig(env);
  const openAiTts = resolveOpenAiTtsConfig(env);
  return {
    bindings: {
      DB: Boolean(getDb(c, deps)),
      ASSETS: Boolean(env.ASSETS),
      ARTIFACTS_BUCKET: Boolean(env.ARTIFACTS_BUCKET || resolveArtifactBucket(env)),
      JOB_QUEUE: Boolean(env.JOB_QUEUE),
      JOB_COORDINATOR: Boolean(env.JOB_COORDINATOR),
    },
    external: {
      tts: {
        brokerUrl: Boolean(ttsBroker.brokerUrl),
        apiKey: Boolean(ttsBroker.apiKey),
        defaultEngine: Boolean(ttsBroker.defaultEngine),
        callbackBaseUrl: Boolean(ttsBroker.callbackBaseUrl),
        openAiBaseUrl: Boolean(openAiTts.baseUrl),
        openAiApiKey: Boolean(openAiTts.apiKey),
        openAiModel: Boolean(openAiTts.model),
        ready: Boolean(ttsBroker.brokerUrl || openAiTts.enabled),
      },
      readerStorage: {
        backend: String(env[STORAGE_ENV_KEYS.backend] || 'r2'),
        publicBaseUrl: Boolean(env[STORAGE_ENV_KEYS.publicBaseUrl]),
        bucketBinding: Boolean(env[STORAGE_ENV_KEYS.bucketBinding]),
        ready: Boolean(env.ARTIFACTS_BUCKET || resolveArtifactBucket(env)),
      },
    },
    envKeys: {
      ttsBrokerUrl: TTS_ENV_KEYS.brokerUrl,
      ttsBrokerApiKey: TTS_ENV_KEYS.brokerApiKey,
      ttsOpenAiBaseUrl: TTS_ENV_KEYS.openAiBaseUrl,
      ttsOpenAiApiKey: TTS_ENV_KEYS.openAiApiKey,
      ttsOpenAiModel: TTS_ENV_KEYS.openAiModel,
      ttsOpenAiVoice: TTS_ENV_KEYS.openAiVoice,
      readerStorageBackend: STORAGE_ENV_KEYS.backend,
      readerStoragePublicBaseUrl: STORAGE_ENV_KEYS.publicBaseUrl,
      readerStorageBucketBinding: STORAGE_ENV_KEYS.bucketBinding,
    },
  };
}

function buildStorageObjectUrl(c, key) {
  const url = new URL(c.req.url);
  url.pathname = '/api/v1/storage/object';
  url.search = '';
  url.searchParams.set('key', normalizeArtifactKey(key));
  return url.toString();
}

function createAuthRoutes(deps = {}) {
  const app = new Hono();

  app.get('/session', async (c) => {
    const db = getDb(c, deps);
    const token = readSessionToken(c);
    if (!db || !token) {
      return buildAuthFailure(c, 'session_required', 'A valid session is required.');
    }

    const session = await authenticateSessionRequest(db, {
      token,
      touch: false,
      ipAddress: c.req.header('cf-connecting-ip') || null,
      userAgent: c.req.header('user-agent') || null,
    });

    if (!session.ok) {
      return buildAuthFailure(c, 'session_required', 'A valid session is required.');
    }

    return jsonResponse(c, {
      ok: true,
      user: session.user,
      session: session.session,
      roles: session.roles,
    });
  });

  app.post('/session', async (c) => {
    const limited = enforceRateLimit(c, 'auth');
    if (limited) {
      return limited;
    }

    const db = getDb(c, deps);
    const body = await readRequestBody(c);
    if (body.__error) {
      return buildAuthFailure(c, 'invalid_json', body.__error, 400);
    }

    const email = String(body.email || '').trim();
    const password = String(body.password || '').trim();
    if (!email || !password) {
      return buildAuthFailure(c, 'missing_credentials', 'Email and password are required.');
    }
    if (!db) {
      return buildAuthFailure(c, 'auth_store_unavailable', 'D1 binding is required.', 503);
    }

    const result = await signInWithPassword(db, {
      email,
      password,
      now: Date.now(),
      ipAddress: c.req.header('cf-connecting-ip') || null,
      userAgent: c.req.header('user-agent') || null,
      sessionTtlDays: body.sessionTtlDays,
    });

    if (!result.ok) {
      return buildAuthFailure(c, 'invalid_credentials', 'Invalid email or password.');
    }

    const response = jsonResponse(c, {
      ok: true,
      user: result.user,
      session: result.session,
      roles: result.roles,
      needsRehash: result.needsRehash,
    });

    response.headers.set(
      'set-cookie',
      buildSessionSetCookie(result.token, {
        secure: isHttpsRequest(c),
      })
    );

    return response;
  });

  app.post('/session/bootstrap', async (c) => {
    const limited = enforceRateLimit(c, 'auth');
    if (limited) {
      return limited;
    }

    const db = getDb(c, deps);
    const body = await readRequestBody(c);
    if (body.__error) {
      return buildAuthFailure(c, 'invalid_json', body.__error, 400);
    }

    const seed = body.seed || body.bootstrap || body;
    if (!seed || (typeof seed === 'object' && Object.keys(seed).length === 0)) {
      return buildAuthFailure(c, 'missing_seed', 'Bootstrap seed data is required.');
    }
    if (!db) {
      return buildAuthFailure(c, 'auth_store_unavailable', 'D1 binding is required.', 503);
    }

    const adminSession = await requireAdminSession(c, deps);
    if (!adminSession.ok) {
      return adminSession.response;
    }

    const summary = await importBootstrapConfig(db, seed, {
      source: body.source || 'request',
      assignedByUserId: adminSession.session.user?.id || getRequestUserId(c, deps),
      env: getEnv(c, deps),
      now: Date.now(),
    });

    return jsonResponse(c, {
      ok: true,
      ...summary,
    });
  });

  app.post('/session/logout', async (c) => {
    const db = getDb(c, deps);
    const token = readSessionToken(c);
    if (!db || !token) {
      return buildAuthFailure(c, 'session_required', 'A valid session is required.');
    }

    const context = await authenticateSessionRequest(db, {
      token,
      touch: false,
    });
    if (!context.ok) {
      return buildAuthFailure(c, 'session_required', 'A valid session is required.');
    }

    await revokeSession(db, {
      sessionId: context.session.id,
      revokedByUserId: context.user.id,
      now: Date.now(),
      reason: 'logout',
    });

    return jsonResponse(c, { ok: true });
  });

  app.get('/me', async (c) => {
    const db = getDb(c, deps);
    const token = readSessionToken(c);
    if (!db || !token) {
      return buildAuthFailure(c, 'session_required', 'A valid session is required.');
    }

    const session = await authenticateSessionRequest(db, {
      token,
      touch: true,
      ipAddress: c.req.header('cf-connecting-ip') || null,
      userAgent: c.req.header('user-agent') || null,
    });

    if (!session.ok) {
      return buildAuthFailure(c, 'session_required', 'A valid session is required.');
    }

    return jsonResponse(c, {
      ok: true,
      user: session.user,
      roles: session.roles,
    });
  });

  return app;
}

function createAccountRoutes(deps = {}) {
  const app = new Hono();

  app.use('*', async (c, next) => {
    await attachSessionActor(c, deps);
    return next();
  });

  const buildBootstrapPayload = async (c) => {
    const db = getDb(c, deps);
    const userId = getRequestUserId(c, deps);
    if (!userId) {
      return buildAuthFailure(c, 'missing_user', 'User id is required.');
    }

    const profile = db
      ? (await readAccountProfile(db, userId)).profile
      : defaultProfilePayload(userId);
    const entitlements = db
      ? (await readAccountEntitlements(db, userId)).entitlements
      : defaultEntitlementsPayload(userId);
    const settings = db
      ? (await readAccountSettings(db, userId)).settings
      : defaultSettingsPayload(userId);

    const user = defaultAdminUserPayload(userId, {
      email: profile.email || '',
      displayName: profile.displayName || profile.fullName || '',
      billingProfile: profile.billingProfile || defaultProfilePayload(userId).billingProfile,
      entitlements: entitlements.wallet || defaultEntitlementsPayload(userId).wallet,
      settings,
      roles: profile.roles || [],
      support: profile.support || { email: 'support@v-flow-ai.com', topic: 'account' },
    });

    return jsonResponse(c, {
      ok: true,
      user,
      compliance: {
        userId,
        requiredUserId: false,
        legalHold: false,
        termsAccepted: true,
        privacyAccepted: true,
        supportEmail: profile.support?.email || 'support@v-flow-ai.com',
      },
      wallet: entitlements.wallet || defaultEntitlementsPayload(userId).wallet,
      routes: {
        landing: '/',
        login: '/app/login',
        studio: '/app/studio',
        admin: '/app/admin',
        account: '/app/account',
        billing: '/app/billing',
        reader: '/app/reader',
        library: '/app/library',
        legal: '/legal/terms',
        onboarding: '/app/onboarding',
      },
      replatform: {
        stack: 'cloudflare-native',
        auth: 'd1',
        storage: 'r2',
        jobs: 'queue-do',
        tts: 'external',
        runtime: 'hono-workers',
      },
    });
  };

  app.get('/bootstrap', async (c) => buildBootstrapPayload(c));

  app.get('/profile/bootstrap', async (c) => {
    const db = getDb(c, deps);
    const userId = getRequestUserId(c, deps);
    if (!userId) {
      return buildAuthFailure(c, 'missing_user', 'User id is required.');
    }

    if (!db) {
      return jsonResponse(c, {
        profile: defaultProfilePayload(userId),
        requiredUserId: false,
        suggestedUserId: null,
      });
    }

    return jsonResponse(c, await readAccountProfile(db, userId));
  });

  app.get('/profile', async (c) => {
    const db = getDb(c, deps);
    const userId = getRequestUserId(c, deps);
    if (!userId) {
      return buildAuthFailure(c, 'missing_user', 'User id is required.');
    }

    if (!db) {
      return jsonResponse(c, {
        profile: defaultProfilePayload(userId),
      });
    }

    return jsonResponse(c, await readAccountProfile(db, userId));
  });

  const handleProfileWrite = async (c) => {
    const db = getDb(c, deps);
    const userId = getRequestUserId(c, deps);
    if (!userId) {
      return buildAuthFailure(c, 'missing_user', 'User id is required.');
    }

    const body = await readRequestBody(c);
    if (body.__error) {
      return buildAuthFailure(c, 'invalid_json', body.__error, 400);
    }

    if (!db) {
      return jsonResponse(c, {
        profile: defaultProfilePayload(userId, body),
        requiredUserId: false,
        suggestedUserId: null,
      });
    }

    return jsonResponse(c, await writeAccountProfile(db, userId, body));
  };

  app.post('/profile', handleProfileWrite);
  app.patch('/profile', handleProfileWrite);

  app.get('/entitlements', async (c) => {
    const db = getDb(c, deps);
    const userId = getRequestUserId(c, deps);
    if (!userId) {
      return buildAuthFailure(c, 'missing_user', 'User id is required.');
    }

    if (!db) {
      return jsonResponse(c, {
        entitlements: defaultEntitlementsPayload(userId),
      });
    }

    return jsonResponse(c, await readAccountEntitlements(db, userId));
  });

  app.get('/settings', async (c) => {
    const db = getDb(c, deps);
    const userId = getRequestUserId(c, deps);
    if (!userId) {
      return buildAuthFailure(c, 'missing_user', 'User id is required.');
    }

    if (!db) {
      return jsonResponse(c, {
        settings: defaultSettingsPayload(userId),
      });
    }

    return jsonResponse(c, await readAccountSettings(db, userId));
  });

  app.patch('/settings', async (c) => {
    const db = getDb(c, deps);
    const userId = getRequestUserId(c, deps);
    if (!userId) {
      return buildAuthFailure(c, 'missing_user', 'User id is required.');
    }

    const body = await readRequestBody(c);
    if (body.__error) {
      return buildAuthFailure(c, 'invalid_json', body.__error, 400);
    }

    if (!db) {
      return jsonResponse(c, {
        settings: defaultSettingsPayload(userId, body),
      });
    }

    return jsonResponse(c, await writeAccountSettings(db, userId, body));
  });

  app.get('/support/messages', async (c) => {
    const db = getDb(c, deps);
    const userId = getRequestUserId(c, deps);
    if (!userId) {
      return buildAuthFailure(c, 'missing_user', 'User id is required.');
    }

    if (!db) {
      return jsonResponse(c, { items: [] });
    }

    const url = new URL(c.req.url);
    const limit = Math.max(1, Math.min(200, Number(url.searchParams.get('limit') || 50)));
    return jsonResponse(c, await listSupportMessages(db, userId, limit));
  });

  app.post('/support/messages', async (c) => {
    const db = getDb(c, deps);
    const userId = getRequestUserId(c, deps);
    if (!userId) {
      return buildAuthFailure(c, 'missing_user', 'User id is required.');
    }

    const body = await readRequestBody(c);
    if (body.__error) {
      return buildAuthFailure(c, 'invalid_json', body.__error, 400);
    }

    if (!db) {
      const message = defaultSupportMessagePayload(userId, body);
      const conversation = defaultConversationPayload(userId, {
        id: message.conversationId,
        subject: message.subject,
        status: 'open',
        unreadCount: 0,
        lastMessageAt: message.createdAt,
        messages: [message],
      });
      return jsonResponse(c, {
        message,
        conversation,
      });
    }

    return jsonResponse(c, await createSupportMessage(db, userId, body));
  });

  app.get('/support/conversations/me', async (c) => {
    const db = getDb(c, deps);
    const userId = getRequestUserId(c, deps);
    if (!userId) {
      return buildAuthFailure(c, 'missing_user', 'User id is required.');
    }

    if (!db) {
      return jsonResponse(c, { items: [] });
    }

    const url = new URL(c.req.url);
    const limit = Math.max(1, Math.min(200, Number(url.searchParams.get('limit') || 50)));
    return jsonResponse(c, await listSupportConversations(db, userId, limit));
  });

  return app;
}

function createBillingRoutes(deps = {}) {
  const app = new Hono();

  app.use('*', async (c, next) => {
    await attachSessionActor(c, deps);
    return next();
  });

  app.get('/account-summary', async (c) => {
    const db = getDb(c, deps);
    const userId = getRequestUserId(c, deps);
    if (!userId) {
      return buildAuthFailure(c, 'missing_user', 'User id is required.');
    }

    if (!db) {
      return jsonResponse(c, {
        summary: defaultBillingSummaryPayload(userId),
      });
    }

    return jsonResponse(c, await readBillingSummary(db, userId));
  });

  app.post('/portal-session', async (c) => {
    const limited = enforceRateLimit(c, 'billing');
    if (limited) {
      return limited;
    }

    const db = getDb(c, deps);
    const userId = getRequestUserId(c, deps);
    if (!userId) {
      return buildAuthFailure(c, 'missing_user', 'User id is required.');
    }

    const body = await readRequestBody(c);
    if (body.__error) {
      return buildAuthFailure(c, 'invalid_json', body.__error, 400);
    }

    const returnUrl = normalizeBillingReturnUrl(body.returnUrl);
    const sessionId = `portal_${userId}_${Date.now().toString(36)}`;
    const url = `${returnUrl}${returnUrl.includes('?') ? '&' : '?'}portalSession=${encodeURIComponent(sessionId)}`;
    const payload = {
      sessionId,
      userId,
      returnUrl,
      url,
      provider: 'd1',
      createdAt: Date.now(),
    };

    if (db) {
      await upsertPayloadRecord(db, TABLES.billingSessions, 'session_id', sessionId, payload, {
        user_id: userId,
      });
    }

    return jsonResponse(c, {
      ok: true,
      provider: 'd1',
      url,
    });
  });

  app.post('/subscription/cancel', async (c) => {
    const limited = enforceRateLimit(c, 'billing');
    if (limited) {
      return limited;
    }

    const db = getDb(c, deps);
    const userId = getRequestUserId(c, deps);
    if (!userId) {
      return buildAuthFailure(c, 'missing_user', 'User id is required.');
    }

    if (!db) {
      return jsonResponse(c, {
        ok: true,
        summary: defaultBillingSummaryPayload(userId, {
          subscription: {
            status: 'cancelled',
            cancelAtPeriodEnd: true,
            cancelledAt: Date.now(),
          },
        }),
      });
    }

    const current = await readBillingSummary(db, userId);
    const summary = defaultBillingSummaryPayload(userId, {
      ...current.summary,
      subscription: {
        ...(current.summary.subscription || {}),
        status: 'cancelled',
        cancelAtPeriodEnd: true,
        cancelledAt: Date.now(),
      },
    });
    await writeBillingSummary(db, userId, summary);
    return jsonResponse(c, {
      ok: true,
      summary,
    });
  });

  app.post('/subscription/resume', async (c) => {
    const limited = enforceRateLimit(c, 'billing');
    if (limited) {
      return limited;
    }

    const db = getDb(c, deps);
    const userId = getRequestUserId(c, deps);
    if (!userId) {
      return buildAuthFailure(c, 'missing_user', 'User id is required.');
    }

    if (!db) {
      return jsonResponse(c, {
        ok: true,
        summary: defaultBillingSummaryPayload(userId, {
          subscription: {
            status: 'active',
            cancelAtPeriodEnd: false,
            resumedAt: Date.now(),
          },
        }),
      });
    }

    const current = await readBillingSummary(db, userId);
    const summary = defaultBillingSummaryPayload(userId, {
      ...current.summary,
      subscription: {
        ...(current.summary.subscription || {}),
        status: 'active',
        cancelAtPeriodEnd: false,
        resumedAt: Date.now(),
      },
    });
    await writeBillingSummary(db, userId, summary);
    return jsonResponse(c, {
      ok: true,
      summary,
    });
  });

  return app;
}

function createAdminRoutes(deps = {}) {
  const app = new Hono();

  app.use('*', async (c, next) => {
    const gate = await requireAdminSession(c, deps);
    if (!gate.ok) {
      return gate.response;
    }

    return next();
  });

  app.get('/users', async (c) => {
    const db = getDb(c, deps);
    if (!db) {
      return jsonResponse(c, { items: [], count: 0 });
    }

    const url = new URL(c.req.url);
    const limit = Math.max(1, Math.min(200, Number(url.searchParams.get('limit') || 100)));
    return jsonResponse(c, await listAdminUsers(db, limit));
  });

  app.get('/users/:userId', async (c) => {
    const db = getDb(c, deps);
    const userId = String(c.req.param('userId') || '').trim();
    if (!userId) {
      return buildAuthFailure(c, 'missing_user_id', 'userId is required.', 400);
    }

    if (!db) {
      return jsonResponse(c, { user: defaultAdminUserPayload(userId) });
    }

    return jsonResponse(c, await readAdminUser(db, userId));
  });

  app.post('/users/:userId', async (c) => {
    const db = getDb(c, deps);
    const userId = String(c.req.param('userId') || '').trim();
    if (!userId) {
      return buildAuthFailure(c, 'missing_user_id', 'userId is required.', 400);
    }

    const body = await readRequestBody(c);
    if (body.__error) {
      return buildAuthFailure(c, 'invalid_json', body.__error, 400);
    }

    if (!db) {
      return jsonResponse(c, {
        user: defaultAdminUserPayload(userId, body),
      });
    }

    return jsonResponse(c, await writeAdminUser(db, userId, body));
  });

  app.patch('/users/:userId', async (c) => {
    const db = getDb(c, deps);
    const userId = String(c.req.param('userId') || '').trim();
    if (!userId) {
      return buildAuthFailure(c, 'missing_user_id', 'userId is required.', 400);
    }

    const body = await readRequestBody(c);
    if (body.__error) {
      return buildAuthFailure(c, 'invalid_json', body.__error, 400);
    }

    if (!db) {
      return jsonResponse(c, {
        user: defaultAdminUserPayload(userId, body),
      });
    }

    return jsonResponse(c, await writeAdminUser(db, userId, body));
  });

  app.get('/roles', async (c) => {
    const db = getDb(c, deps);
    if (!db) {
      return jsonResponse(c, { items: [], count: 0 });
    }

    const url = new URL(c.req.url);
    const limit = Math.max(1, Math.min(200, Number(url.searchParams.get('limit') || 100)));
    return jsonResponse(c, await listRoles(db, limit));
  });

  app.get('/roles/:roleId', async (c) => {
    const db = getDb(c, deps);
    const roleId = String(c.req.param('roleId') || '').trim();
    if (!roleId) {
      return buildAuthFailure(c, 'missing_role_id', 'roleId is required.', 400);
    }

    if (!db) {
      return jsonResponse(c, { role: defaultAdminRolePayload(roleId) });
    }

    return jsonResponse(c, await readRole(db, roleId));
  });

  app.post('/roles/:roleId', async (c) => {
    const db = getDb(c, deps);
    const roleId = String(c.req.param('roleId') || '').trim();
    const body = await readRequestBody(c);
    if (body.__error) {
      return buildAuthFailure(c, 'invalid_json', body.__error, 400);
    }

    if (!db) {
      return jsonResponse(c, {
        role: defaultAdminRolePayload(roleId || makeId('role'), body),
      });
    }

    return jsonResponse(c, await writeRole(db, roleId, body));
  });

  app.patch('/roles/:roleId', async (c) => {
    const db = getDb(c, deps);
    const roleId = String(c.req.param('roleId') || '').trim();
    const body = await readRequestBody(c);
    if (body.__error) {
      return buildAuthFailure(c, 'invalid_json', body.__error, 400);
    }

    if (!db) {
      return jsonResponse(c, {
        role: defaultAdminRolePayload(roleId || makeId('role'), body),
      });
    }

    return jsonResponse(c, await writeRole(db, roleId, body));
  });

  app.get('/users/:userId/roles', async (c) => {
    const db = getDb(c, deps);
    const userId = String(c.req.param('userId') || '').trim();
    if (!userId) {
      return buildAuthFailure(c, 'missing_user_id', 'userId is required.', 400);
    }

    if (!db) {
      return jsonResponse(c, { items: [] });
    }

    return jsonResponse(c, await listUserRoles(db, userId));
  });

  app.post('/users/:userId/roles', async (c) => {
    const db = getDb(c, deps);
    const userId = String(c.req.param('userId') || '').trim();
    if (!userId) {
      return buildAuthFailure(c, 'missing_user_id', 'userId is required.', 400);
    }

    const body = await readRequestBody(c);
    if (body.__error) {
      return buildAuthFailure(c, 'invalid_json', body.__error, 400);
    }

    if (!db) {
      return jsonResponse(c, {
        userId,
        roleIds: Array.isArray(body.roleIds) ? body.roleIds : Array.isArray(body.roles) ? body.roles : [],
      });
    }

    return jsonResponse(c, await replaceUserRoles(db, userId, body.roleIds || body.roles || []));
  });

  app.patch('/users/:userId/roles', async (c) => {
    const db = getDb(c, deps);
    const userId = String(c.req.param('userId') || '').trim();
    if (!userId) {
      return buildAuthFailure(c, 'missing_user_id', 'userId is required.', 400);
    }

    const body = await readRequestBody(c);
    if (body.__error) {
      return buildAuthFailure(c, 'invalid_json', body.__error, 400);
    }

    if (!db) {
      return jsonResponse(c, {
        userId,
        roleIds: Array.isArray(body.roleIds) ? body.roleIds : Array.isArray(body.roles) ? body.roles : [],
      });
    }

    return jsonResponse(c, await replaceUserRoles(db, userId, body.roleIds || body.roles || []));
  });

  return app;
}

function createStorageRoutes(deps = {}) {
  const app = new Hono();

  const getBucket = (c) => resolveArtifactBucket(getEnv(c, deps));

  const ensureBucket = (c) => {
    const bucket = getBucket(c);
    if (!bucket) {
      return jsonResponse(c, {
        ok: false,
        error: 'R2 artifact storage is not configured.',
      }, 400);
    }
    return bucket;
  };

  const handleList = async (c) => {
    const bucket = ensureBucket(c);
    if (bucket instanceof Response) {
      return bucket;
    }

    const url = new URL(c.req.url);
    const prefix = String(url.searchParams.get('prefix') || '').trim() || undefined;
    const limit = Math.max(1, Math.min(1000, Number(url.searchParams.get('limit') || 100)));
    const cursor = String(url.searchParams.get('cursor') || '').trim() || undefined;
    return jsonResponse(c, await listArtifacts(getEnv(c, deps), { prefix, limit, cursor }));
  };

  const handleObject = async (c) => {
    const key = String(new URL(c.req.url).searchParams.get('key') || '').trim();
    if (!key) {
      return jsonResponse(c, {
        ok: false,
        error: 'key query parameter is required.',
      }, 400);
    }

    try {
      normalizeArtifactKey(key);
    } catch (error) {
      return errorResponse(c, 400, 'invalid_key', error instanceof Error ? error.message : String(error));
    }

    const method = c.req.method.toUpperCase();

    if (method !== 'GET' && method !== 'HEAD') {
      const actor = await requireActor(c, deps);
      if (!actor.ok) {
        return actor.response;
      }
    }

    const bucket = ensureBucket(c);
    if (bucket instanceof Response) {
      return bucket;
    }

    if (method === 'GET' || method === 'HEAD') {
      const artifact = await getArtifact(getEnv(c, deps), key);
      if (!artifact) {
        return jsonResponse(c, {
          ok: false,
          error: 'Artifact not found.',
        }, 404);
      }

      const headers = new Headers();
      if (artifact.httpMetadata?.contentType) {
        headers.set('content-type', artifact.httpMetadata.contentType);
      }
      if (artifact.etag) {
        headers.set('etag', artifact.etag);
      }

      return new Response(method === 'HEAD' ? null : artifact.body ?? artifact.object?.body ?? null, {
        status: 200,
        headers,
      });
    }

    if (method === 'PUT' || method === 'POST') {
      const contentType = c.req.header('content-type') || undefined;
      const body = await c.req.arrayBuffer();
      const stored = await putArtifact(getEnv(c, deps), key, body, {
        contentType,
        httpMetadata: contentType ? { contentType } : undefined,
      });
      return jsonResponse(c, {
        ok: true,
        artifact: stored,
      });
    }

    if (method === 'DELETE') {
      const deleted = await deleteArtifact(getEnv(c, deps), key);
      return jsonResponse(c, {
        ok: true,
        ...deleted,
      });
    }

    return errorResponse(c, 405, 'method_not_allowed', 'Method not allowed.', 405);
  };

  app.get('/object', handleObject);
  app.put('/object', handleObject);
  app.post('/object', handleObject);
  app.delete('/object', handleObject);
  app.get('/objects', handleList);
  app.get('/list', handleList);

  return app;
}

function createJobsRoutes(deps = {}) {
  const app = new Hono();

  app.post('/jobs', async (c) => {
    const limited = enforceRateLimit(c, 'jobs');
    if (limited) {
      return limited;
    }

    const actor = await requireActor(c, deps);
    if (!actor.ok) {
      return actor.response;
    }

    const env = getEnv(c, deps);
    const body = await readRequestBody(c);
    if (body.__error) {
      return errorResponse(c, 400, 'invalid_json', body.__error);
    }

    const text = String(body.text || '').trim();
    const bookId = String(body.bookId || body.chapterId || body.id || '').trim();
    if (!text && !bookId) {
      return errorResponse(c, 400, 'missing_payload', 'A bookId or text field is required.');
    }

    const job = createJobStatus({
      jobId: body.jobId || makeId('job'),
      kind: body.kind || 'tts',
      status: 'queued',
      payload: body,
      metadata: {
        userId: actor.userId,
        route: c.req.path,
      },
    });

    if (env.JOB_QUEUE?.send) {
      try {
        const enqueued = await submitJob(env, job);
        return jsonResponse(c, {
          ok: true,
          jobId: enqueued.jobId,
          status: enqueued.status,
          cacheHit: false,
          job: enqueued,
        });
      } catch (error) {
        return errorResponse(c, 503, 'job_queue_unavailable', error instanceof Error ? error.message : String(error));
      }
    }

    return jsonResponse(c, {
      ok: true,
      jobId: job.jobId,
      status: job.status,
      cacheHit: false,
      job,
    });
  });

  app.get('/jobs/next', async (c) => jsonResponse(c, {
    ok: true,
    job: null,
  }));

  app.get('/jobs/:jobId', async (c) => {
    return jsonResponse(c, {
      ok: true,
      jobId: String(c.req.param('jobId') || '').trim(),
      status: 'queued',
      cacheHit: false,
    });
  });

  const handleJobStatus = async (c) => {
    const actor = await requireActor(c, deps);
    if (!actor.ok) {
      return actor.response;
    }

    const body = await readRequestBody(c);
    if (body.__error) {
      return errorResponse(c, 400, 'invalid_json', body.__error);
    }

    const jobId = String(c.req.param('jobId') || '').trim();
    const job = createJobStatus({
      ...body,
      jobId,
      status: body.status || 'queued',
      metadata: {
        userId: actor.userId,
        route: c.req.path,
        ...(body.metadata || {}),
      },
    });

    return jsonResponse(c, {
      ok: true,
      jobId: job.jobId,
      status: job.status,
      job,
    });
  };

  app.post('/jobs/:jobId/status', handleJobStatus);
  app.patch('/jobs/:jobId/status', handleJobStatus);

  app.post('/jobs/:jobId/cancel', async (c) => {
    const actor = await requireActor(c, deps);
    if (!actor.ok) {
      return actor.response;
    }

    return jsonResponse(c, {
      ok: true,
      jobId: String(c.req.param('jobId') || '').trim(),
      status: 'canceled',
      job: createJobStatus({
        jobId: String(c.req.param('jobId') || '').trim(),
        status: 'canceled',
        metadata: {
          userId: actor.userId,
          route: c.req.path,
        },
      }),
    });
  });

  app.post('/jobs/:jobId/claim', async (c) => {
    const actor = await requireActor(c, deps);
    if (!actor.ok) {
      return actor.response;
    }

    return jsonResponse(c, {
      ok: true,
      jobId: String(c.req.param('jobId') || '').trim(),
      status: 'claimed',
      job: createJobStatus({
        jobId: String(c.req.param('jobId') || '').trim(),
        status: 'claimed',
        metadata: {
          userId: actor.userId,
          route: c.req.path,
        },
      }),
    });
  });

  return app;
}

function createTtsRoutes(deps = {}) {
  const app = new Hono();

  const handleSynthesize = async (c) => {
    const limited = enforceRateLimit(c, 'tts');
    if (limited) {
      return limited;
    }

    const actor = await requireActor(c, deps);
    if (!actor.ok) {
      return actor.response;
    }

    const env = getEnv(c, deps);
    const body = await readRequestBody(c);
    if (body.__error) {
      return errorResponse(c, 400, 'invalid_json', body.__error);
    }

    const request = normalizeTtsRequest(body);
    request.metadata = {
      ...(request.metadata || {}),
      userId: actor.userId,
    };
    if (!request.text) {
      return jsonResponse(c, {
        ok: false,
        error: 'text is required.',
      }, 400);
    }

    const brokerConfig = resolveTtsBrokerConfig(env);
    if (brokerConfig.brokerUrl) {
      try {
        const client = createTtsBrokerClient(env);
        const response = await client.submit(request);
        return jsonResponse(c, {
          ok: true,
          ...response,
        });
      } catch (error) {
        return errorResponse(c, 502, 'tts_broker_error', error instanceof Error ? error.message : String(error));
      }
    }

    const openAiConfig = resolveOpenAiTtsConfig(env);
    if (openAiConfig.enabled) {
      try {
        const response = await synthesizeOpenAiSpeech(env, request);
        const format = String(request.format || 'mp3').trim().replace(/[^a-z0-9]+/gi, '').toLowerCase() || 'mp3';
        const artifactKey = buildArtifactKey({
          namespace: 'tts',
          jobId: request.jobId || response.requestId,
          filename: `${response.requestId}.${format}`,
        });
        await putArtifact(env, artifactKey, response.audioBytes, {
          contentType: response.contentType || 'audio/mpeg',
          httpMetadata: {
            contentType: response.contentType || 'audio/mpeg',
          },
          customMetadata: {
            requestId: response.requestId,
            userId: actor.userId,
            provider: 'openai-compatible',
          },
        });

        return jsonResponse(c, {
          ok: true,
          ...response,
          audioBytes: undefined,
          artifactKey,
          audioUrl: buildStorageObjectUrl(c, artifactKey),
        });
      } catch (error) {
        return errorResponse(c, 502, 'tts_provider_error', error instanceof Error ? error.message : String(error));
      }
    }

    return jsonResponse(c, {
      ok: true,
      requestId: makeId('tts'),
      status: 'queued',
      audioUrl: null,
      artifactKey: null,
      engine: request.engine || null,
    });
  };

  app.post('/synthesize', handleSynthesize);
  app.post('/long-text', handleSynthesize);
  app.post('/stream', handleSynthesize);

  app.post('/novel/jobs', async (c) => handleSynthesize(c));

  return app;
}

function createOpsRoutes(deps = {}) {
  const app = new Hono();

  app.get('/health', (c) => {
    const runtime = buildRuntimeStatus(c, deps);
    return jsonResponse(c, {
      ok: true,
      service: 'voice-flow-cloudflare-backend',
      runtime: {
        kind: 'cloudflare-worker',
        backend: 'hono',
        d1: runtime.bindings.DB,
        r2: runtime.bindings.ARTIFACTS_BUCKET,
        queue: runtime.bindings.JOB_QUEUE,
        durableObject: runtime.bindings.JOB_COORDINATOR,
        external: runtime.external,
      },
    });
  });

  app.get('/contracts', (c) => jsonResponse(c, {
    ok: true,
    routes: DEFAULT_ROUTE_MAP,
  }));

  return app;
}

export function createBackendApp(deps = {}) {
  const app = new Hono();

  app.use('*', async (c, next) => {
    const requestId = c.req.header('x-request-id') || makeRequestId();
    c.set('requestId', requestId);
    const corsHeaders = buildLocalCorsHeaders(c);
    if (c.req.method.toUpperCase() === 'OPTIONS') {
      const headers = new Headers(corsHeaders || undefined);
      headers.set('x-request-id', requestId);
      return new Response(null, { status: 204, headers });
    }

    await next();

    setSecurityHeaders(c);
    c.header('x-request-id', requestId);

    if (corsHeaders) {
      for (const [name, value] of Object.entries(corsHeaders)) {
        c.header(name, value);
      }
    }
  });

  app.onError((error, c) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(JSON.stringify({
      level: 'error',
      code: 'internal_error',
      requestId: c.get('requestId') || null,
      path: c.req.path,
      method: c.req.method,
      message,
    }));
    c.header('x-request-id', c.get('requestId') || makeRequestId());
    return errorResponse(c, 500, 'internal_error', 'Internal server error.');
  });

  app.notFound((c) => errorResponse(c, 404, 'not_found', 'Not found', 404));

  app.get('/', (c) => jsonResponse(c, {
    ok: true,
    service: 'voice-flow-cloudflare-backend',
    runtime: {
      kind: 'cloudflare-worker',
      backend: 'hono',
    },
  }));

  app.get('/healthz', (c) => {
    const runtime = buildRuntimeStatus(c, deps);
    return jsonResponse(c, {
      ok: true,
      env: runtime.bindings,
      external: runtime.external,
    });
  });

  app.get('/api/env', (c) => {
    if (!isDevEndpointAllowed(c, deps)) {
      return errorResponse(c, 404, 'not_found', 'Not found', 404);
    }

    const runtime = buildRuntimeStatus(c, deps);
    return jsonResponse(c, {
      ok: true,
      bindings: runtime.bindings,
      external: runtime.external,
      envKeys: runtime.envKeys,
    });
  });

  app.post('/api/dev/echo', async (c) => {
    if (!isDevEndpointAllowed(c, deps)) {
      return errorResponse(c, 404, 'not_found', 'Not found', 404);
    }

    const contentType = c.req.header('content-type') || '';
    if (contentType.includes('application/json')) {
      const body = await c.req.json().catch(() => null);
      return jsonResponse(c, { ok: true, echo: body });
    }

    const text = await c.req.text();
    return c.text(text || '', 200);
  });

  app.route('/api/auth', createAuthRoutes(deps));
  app.route('/auth', createAuthRoutes(deps));
  app.route('/api/v1/account', createAccountRoutes(deps));
  app.route('/api/v1/billing', createBillingRoutes(deps));
  app.route('/api/v1/admin', createAdminRoutes(deps));
  app.route('/api/v1/storage', createStorageRoutes(deps));
  app.route('/api/v1/library/reader', createStorageRoutes(deps));
  app.route('/api/v1/library/audio-novel', createJobsRoutes(deps));
  app.route('/api/v1/studio/tts/novel', createJobsRoutes(deps));
  app.route('/api/v1/studio/tts', createTtsRoutes(deps));
  app.route('/api/v1/tts', createTtsRoutes(deps));
  app.route('/api/v1/ops', createOpsRoutes(deps));

  return app;
}

export {
  createAccountRoutes,
  createAdminRoutes,
  createAuthRoutes,
  createBillingRoutes,
  createJobsRoutes,
  createOpsRoutes,
  createStorageRoutes,
  createTtsRoutes,
};
