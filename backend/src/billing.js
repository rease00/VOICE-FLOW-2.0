import {
  defaultBillingSummaryPayload,
  errorResponse,
  jsonResponse,
  normalizeUserId,
  readAccountEntitlements,
  readJsonBody,
  resolveActorId,
  upsertPayloadRecord,
  readPayloadRecord,
  TABLES,
} from './account.js';

function getDb(c, deps) {
  return c.env?.DB || deps.db;
}

function getUserId(c, deps) {
  return normalizeUserId(resolveActorId(c, deps));
}

async function readBillingSummary(db, userId) {
  const row = await readPayloadRecord(db, TABLES.billingAccounts, 'user_id', userId);
  const entitlements = await readAccountEntitlements(db, userId);
  const summary = defaultBillingSummaryPayload(userId, {
    ...(row?.payload || {}),
    wallet: entitlements.entitlements.wallet,
  });
  return { summary };
}

async function writeBillingSummary(db, userId, patch = {}) {
  const current = await readBillingSummary(db, userId);
  const summary = defaultBillingSummaryPayload(userId, {
    ...current.summary,
    ...patch,
    billingProfile: {
      ...(current.summary.billingProfile || {}),
      ...(patch.billingProfile || {}),
    },
    subscription: {
      ...(current.summary.subscription || {}),
      ...(patch.subscription || {}),
    },
    wallet: {
      ...(current.summary.wallet || {}),
      ...(patch.wallet || {}),
    },
    portal: {
      ...(current.summary.portal || {}),
      ...(patch.portal || {}),
    },
  });

  await upsertPayloadRecord(db, TABLES.billingAccounts, 'user_id', userId, summary);
  return { summary };
}

async function handleBillingSummaryRead(c, deps = {}) {
  const db = getDb(c, deps);
  const userId = getUserId(c, deps);
  if (!db) return errorResponse(c, 500, 'missing_db', 'D1 binding is required.');
  if (!userId) return errorResponse(c, 401, 'missing_user', 'User id is required.');
  return jsonResponse(c, await readBillingSummary(db, userId));
}

async function handleBillingPortalSessionCreate(c, deps = {}) {
  const db = getDb(c, deps);
  const userId = getUserId(c, deps);
  if (!db) return errorResponse(c, 500, 'missing_db', 'D1 binding is required.');
  if (!userId) return errorResponse(c, 401, 'missing_user', 'User id is required.');

  let body;
  try {
    body = await readJsonBody(c.req);
  } catch (error) {
    return errorResponse(c, 400, 'invalid_json', error?.message || 'Request body must be valid JSON.');
  }
  const returnUrl = String(body.returnUrl || '').trim() || '/app/billing';
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

  await upsertPayloadRecord(db, TABLES.billingSessions, 'session_id', sessionId, payload, {
    user_id: userId,
  });

  return jsonResponse(c, {
    ok: true,
    provider: 'd1',
    url,
  });
}

async function handleBillingSubscriptionCancel(c, deps = {}) {
  const db = getDb(c, deps);
  const userId = getUserId(c, deps);
  if (!db) return errorResponse(c, 500, 'missing_db', 'D1 binding is required.');
  if (!userId) return errorResponse(c, 401, 'missing_user', 'User id is required.');

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

  await upsertPayloadRecord(db, TABLES.billingAccounts, 'user_id', userId, summary);
  return jsonResponse(c, {
    ok: true,
    summary,
  });
}

async function handleBillingSubscriptionResume(c, deps = {}) {
  const db = getDb(c, deps);
  const userId = getUserId(c, deps);
  if (!db) return errorResponse(c, 500, 'missing_db', 'D1 binding is required.');
  if (!userId) return errorResponse(c, 401, 'missing_user', 'User id is required.');

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

  await upsertPayloadRecord(db, TABLES.billingAccounts, 'user_id', userId, summary);
  return jsonResponse(c, {
    ok: true,
    summary,
  });
}

function registerBillingRoutes(app, deps = {}) {
  app.get('/billing/account-summary', async (c) => handleBillingSummaryRead(c, deps));
  app.post('/billing/portal-session', async (c) => handleBillingPortalSessionCreate(c, deps));
  app.post('/billing/subscription/cancel', async (c) => handleBillingSubscriptionCancel(c, deps));
  app.post('/billing/subscription/resume', async (c) => handleBillingSubscriptionResume(c, deps));
}

export {
  handleBillingPortalSessionCreate,
  handleBillingSummaryRead,
  handleBillingSubscriptionCancel,
  handleBillingSubscriptionResume,
  registerBillingRoutes,
  readBillingSummary,
  writeBillingSummary,
};
