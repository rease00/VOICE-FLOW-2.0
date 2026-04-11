#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fetchJsonWithTimeout, normalizeBaseUrl } from './lib/audit-helpers.mjs';

const ROOT = process.cwd();
const ARTIFACT_DIR = path.join(ROOT, 'artifacts', 'load');
const BACKEND_BASE_URL = normalizeBaseUrl(process.env.VF_MEDIA_BACKEND_URL, 'http://127.0.0.1:7800');
const REQUEST_TIMEOUT_MS = Math.max(2_000, Number(process.env.AUDIT_AUTH_TIMEOUT_MS || 12_000));

const EXISTING_BEARER = String(process.env.AUDIT_BEARER_TOKEN || '').trim();
const FIREBASE_CUSTOM_TOKEN = String(process.env.AUDIT_FIREBASE_CUSTOM_TOKEN || process.env.VF_AUDIT_FIREBASE_CUSTOM_TOKEN || '').trim();
const FIREBASE_API_KEY = String(
  process.env.AUDIT_FIREBASE_API_KEY
  || process.env.VF_KEY_BURST_FIREBASE_API_KEY
  || process.env.VITE_FIREBASE_API_KEY
  || ''
).trim();
const FIREBASE_EMAIL = String(process.env.AUDIT_FIREBASE_EMAIL || process.env.VF_KEY_BURST_ADMIN_EMAIL || '').trim().toLowerCase();
const FIREBASE_PASSWORD = String(process.env.AUDIT_FIREBASE_PASSWORD || process.env.VF_KEY_BURST_ADMIN_PASSWORD || '').trim();

const maskToken = (token) => {
  const raw = String(token || '').trim();
  if (!raw) return '';
  if (raw.length <= 16) return `${raw.slice(0, 4)}...${raw.slice(-2)}`;
  return `${raw.slice(0, 10)}...${raw.slice(-6)}`;
};

const readDetail = (payload) => {
  if (payload === undefined || payload === null) return '';
  if (typeof payload === 'string') return payload.trim();
  return String(payload?.detail || payload?.error || '').trim();
};

const fetchJsonPost = async (url, body) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await response.text();
    let payload = null;
    try {
      payload = text ? JSON.parse(text) : null;
    } catch {
      payload = text;
    }
    return {
      ok: response.ok,
      status: response.status,
      payload,
    };
  } finally {
    clearTimeout(timer);
  }
};

const exchangeCustomTokenForIdToken = async (customToken, apiKey) => {
  const url = `https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${encodeURIComponent(apiKey)}`;
  const result = await fetchJsonPost(url, {
    token: customToken,
    returnSecureToken: true,
  });
  if (!result.ok) {
    throw new Error(`Firebase custom-token exchange failed (${result.status}): ${readDetail(result.payload) || 'Unknown error'}`);
  }
  const idToken = String(result.payload?.idToken || '').trim();
  if (!idToken) {
    throw new Error('Firebase custom-token exchange succeeded but no idToken was returned.');
  }
  return {
    idToken,
    uid: String(result.payload?.localId || '').trim(),
    email: String(result.payload?.email || '').trim().toLowerCase(),
  };
};

const signInWithPassword = async (apiKey, email, password) => {
  const url = `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${encodeURIComponent(apiKey)}`;
  const result = await fetchJsonPost(url, {
    email,
    password,
    returnSecureToken: true,
  });
  if (!result.ok) {
    throw new Error(`Firebase password sign-in failed (${result.status}): ${readDetail(result.payload) || 'Unknown error'}`);
  }
  const idToken = String(result.payload?.idToken || '').trim();
  if (!idToken) {
    throw new Error('Firebase password sign-in succeeded but no idToken was returned.');
  }
  return {
    idToken,
    uid: String(result.payload?.localId || '').trim(),
    email: String(result.payload?.email || email).trim().toLowerCase(),
  };
};

const validateTokenAgainstBackend = async (idToken, mode) => {
  const bearerValue = idToken.toLowerCase().startsWith('bearer ') ? idToken : `Bearer ${idToken}`;
  const headers = {
    Accept: 'application/json',
    Authorization: bearerValue,
  };
  const [profileProbe, actorProbe] = await Promise.all([
    fetchJsonWithTimeout(`${BACKEND_BASE_URL}/account/profile`, { method: 'GET', headers }, REQUEST_TIMEOUT_MS),
    fetchJsonWithTimeout(`${BACKEND_BASE_URL}/admin/actor`, { method: 'GET', headers }, REQUEST_TIMEOUT_MS),
  ]);

  const checks = [
    {
      name: 'profile',
      path: '/account/profile',
      ok: profileProbe.ok && profileProbe.status === 200,
      status: profileProbe.status,
      detail: readDetail(profileProbe.payload),
    },
    {
      name: 'admin_actor',
      path: '/admin/actor',
      ok: actorProbe.ok && actorProbe.status === 200,
      status: actorProbe.status,
      detail: readDetail(actorProbe.payload),
    },
  ];
  const ok = checks.every((check) => check.ok);
  const profile = profileProbe.payload && typeof profileProbe.payload === 'object'
    ? profileProbe.payload.profile || {}
    : {};
  const actor = actorProbe.payload && typeof actorProbe.payload === 'object'
    ? actorProbe.payload.actor || {}
    : {};

  return {
    ok,
    mode,
    token: idToken,
    checks,
    profile: {
      uid: String(profile?.uid || '').trim(),
      userId: String(profile?.userId || '').trim(),
      status: String(profile?.status || '').trim(),
    },
    actor: {
      uid: String(actor?.uid || '').trim(),
      role: String(actor?.role || '').trim(),
      status: String(actor?.status || '').trim(),
      permissions: Array.isArray(actor?.permissions) ? actor.permissions.length : 0,
    },
  };
};

const resolveBearerToken = async () => {
  const attempts = [];
  const addAttempt = (attempt) => attempts.push(attempt);

  if (EXISTING_BEARER) {
    try {
      const validated = await validateTokenAgainstBackend(EXISTING_BEARER, 'existing_bearer_env');
      addAttempt({
        mode: 'existing_bearer_env',
        ok: validated.ok,
        tokenMasked: maskToken(EXISTING_BEARER),
        checks: validated.checks,
      });
      if (validated.ok) {
        return { selected: validated, attempts };
      }
    } catch (error) {
      addAttempt({
        mode: 'existing_bearer_env',
        ok: false,
        tokenMasked: maskToken(EXISTING_BEARER),
        error: error instanceof Error ? error.message : String(error),
      });
    }
  } else {
    addAttempt({
      mode: 'existing_bearer_env',
      ok: false,
      skipped: true,
      reason: 'AUDIT_BEARER_TOKEN missing',
    });
  }

  if (FIREBASE_CUSTOM_TOKEN && FIREBASE_API_KEY) {
    try {
      const exchanged = await exchangeCustomTokenForIdToken(FIREBASE_CUSTOM_TOKEN, FIREBASE_API_KEY);
      const validated = await validateTokenAgainstBackend(exchanged.idToken, 'firebase_custom_token_exchange');
      addAttempt({
        mode: 'firebase_custom_token_exchange',
        ok: validated.ok,
        tokenMasked: maskToken(exchanged.idToken),
        firebaseUid: exchanged.uid,
        firebaseEmail: exchanged.email,
        checks: validated.checks,
      });
      if (validated.ok) {
        return { selected: validated, attempts };
      }
    } catch (error) {
      addAttempt({
        mode: 'firebase_custom_token_exchange',
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  } else {
    addAttempt({
      mode: 'firebase_custom_token_exchange',
      ok: false,
      skipped: true,
      reason: !FIREBASE_CUSTOM_TOKEN
        ? 'AUDIT_FIREBASE_CUSTOM_TOKEN missing'
        : 'FIREBASE_API_KEY missing',
    });
  }

  if (FIREBASE_EMAIL && FIREBASE_PASSWORD && FIREBASE_API_KEY) {
    try {
      const session = await signInWithPassword(FIREBASE_API_KEY, FIREBASE_EMAIL, FIREBASE_PASSWORD);
      const validated = await validateTokenAgainstBackend(session.idToken, 'firebase_password_signin');
      addAttempt({
        mode: 'firebase_password_signin',
        ok: validated.ok,
        tokenMasked: maskToken(session.idToken),
        firebaseUid: session.uid,
        firebaseEmail: session.email,
        checks: validated.checks,
      });
      if (validated.ok) {
        return { selected: validated, attempts };
      }
    } catch (error) {
      addAttempt({
        mode: 'firebase_password_signin',
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  } else {
    addAttempt({
      mode: 'firebase_password_signin',
      ok: false,
      skipped: true,
      reason: 'AUDIT_FIREBASE_EMAIL/AUDIT_FIREBASE_PASSWORD/FIREBASE_API_KEY not all set',
    });
  }

  return { selected: null, attempts };
};

const runLoadtestWithResolvedToken = async (token, forwardedArgs) => {
  const childArgs = [path.join('scripts', 'loadtest-tts-concurrency.mjs'), ...forwardedArgs];
  return await new Promise((resolve) => {
    const child = spawn(process.execPath, childArgs, {
      cwd: ROOT,
      stdio: 'inherit',
      env: {
        ...process.env,
        AUDIT_BEARER_TOKEN: String(token || '').trim(),
      },
    });
    child.on('exit', (code, signal) => {
      resolve({
        code: Number.isInteger(code) ? code : 1,
        signal: signal || null,
      });
    });
  });
};

const main = async () => {
  const forwardedArgs = process.argv.slice(2);
  const report = {
    timestamp: new Date().toISOString(),
    backendBaseUrl: BACKEND_BASE_URL,
    passed: false,
    selectedAuth: null,
    attempts: [],
    child: {
      command: `node scripts/loadtest-tts-concurrency.mjs ${forwardedArgs.join(' ')}`.trim(),
      code: null,
      signal: null,
    },
    guidance: [],
  };

  const { selected, attempts } = await resolveBearerToken();
  report.attempts = attempts;

  if (!selected) {
    report.guidance.push('Unable to resolve a bearer token. Set AUDIT_BEARER_TOKEN or Firebase auth env variables.');
    await fs.mkdir(ARTIFACT_DIR, { recursive: true });
    const artifactPath = path.join(ARTIFACT_DIR, `authenticated-load-bootstrap-${Date.now()}.json`);
    await fs.writeFile(artifactPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    console.error('[loadtest-auth] failed to resolve bearer token for protected load test path.');
    console.error(`[loadtest-auth] artifact: ${path.relative(ROOT, artifactPath).replace(/\\/g, '/')}`);
    process.exit(1);
    return;
  }

  report.selectedAuth = {
    mode: selected.mode,
    tokenMasked: maskToken(selected.token),
    profile: selected.profile,
    actor: selected.actor,
  };
  console.log(`[loadtest-auth] auth_ok=true mode=${selected.mode} token_masked=${maskToken(selected.token)}`);

  const childResult = await runLoadtestWithResolvedToken(selected.token, forwardedArgs);
  report.child.code = childResult.code;
  report.child.signal = childResult.signal;
  report.passed = childResult.code === 0;

  await fs.mkdir(ARTIFACT_DIR, { recursive: true });
  const artifactPath = path.join(ARTIFACT_DIR, `authenticated-load-bootstrap-${Date.now()}.json`);
  await fs.writeFile(artifactPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(`[loadtest-auth] artifact: ${path.relative(ROOT, artifactPath).replace(/\\/g, '/')}`);

  if (!report.passed) {
    process.exit(childResult.code || 1);
  }
};

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
