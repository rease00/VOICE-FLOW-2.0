import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

const SESSION_TTL_MS = 45000;
const SESSION_PRUNE_MS = 15000;

type SessionEvent = 'heartbeat' | 'close';
type SessionRecord = {
  lastSeenAtMs: number;
  path: string;
};

type SessionStore = {
  sessions: Map<string, SessionRecord>;
  lastPrunedAtMs: number;
};

declare global {
  // eslint-disable-next-line no-var
  var __vfDevSessionStore: SessionStore | undefined;
}

const isLocalhostRequest = (request: Request): boolean => {
  const host = String(request.headers.get('host') || '').toLowerCase();
  return host.includes('localhost') || host.includes('127.0.0.1');
};

const getSessionStore = (): SessionStore => {
  if (!globalThis.__vfDevSessionStore) {
    globalThis.__vfDevSessionStore = {
      sessions: new Map<string, SessionRecord>(),
      lastPrunedAtMs: 0,
    };
  }
  return globalThis.__vfDevSessionStore;
};

const pruneStaleSessions = (store: SessionStore, nowMs: number): void => {
  if ((nowMs - store.lastPrunedAtMs) < SESSION_PRUNE_MS) return;
  store.lastPrunedAtMs = nowMs;
  for (const [sessionId, entry] of store.sessions.entries()) {
    if ((nowMs - Number(entry.lastSeenAtMs || 0)) > SESSION_TTL_MS) {
      store.sessions.delete(sessionId);
    }
  }
};

const toActiveSessionPayload = (store: SessionStore) => ({
  ok: true,
  activeSessions: store.sessions.size,
});

export const GET = async (request: Request): Promise<Response> => {
  if (!isLocalhostRequest(request)) {
    return NextResponse.json({ ok: false, message: 'Not available for non-local hosts.' }, { status: 404 });
  }
  const nowMs = Date.now();
  const store = getSessionStore();
  pruneStaleSessions(store, nowMs);
  return NextResponse.json(toActiveSessionPayload(store), { headers: { 'Cache-Control': 'no-store' } });
};

export const POST = async (request: Request): Promise<Response> => {
  if (!isLocalhostRequest(request)) {
    return NextResponse.json({ ok: false, message: 'Not available for non-local hosts.' }, { status: 404 });
  }

  let payload: { sessionId?: unknown; event?: unknown; path?: unknown } = {};
  try {
    payload = await request.json();
  } catch {
    payload = {};
  }

  const sessionId = String(payload.sessionId || '').trim();
  const event = String(payload.event || 'heartbeat').trim().toLowerCase() as SessionEvent;
  const path = String(payload.path || '/').trim() || '/';
  if (!sessionId) {
    return NextResponse.json({ ok: false, message: 'Missing session id.' }, { status: 400 });
  }

  const store = getSessionStore();
  const nowMs = Date.now();
  pruneStaleSessions(store, nowMs);

  if (event === 'close') {
    store.sessions.delete(sessionId);
  } else {
    store.sessions.set(sessionId, {
      lastSeenAtMs: nowMs,
      path,
    });
  }

  return NextResponse.json(toActiveSessionPayload(store), { headers: { 'Cache-Control': 'no-store' } });
};

