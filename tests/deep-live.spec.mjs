import { expect, test } from '@playwright/test';

const BACKEND_URL = process.env.PLAYWRIGHT_BACKEND_URL || 'http://127.0.0.1:8787';
const SNAPSHOT_URL = process.env.PLAYWRIGHT_SNAPSHOT_URL || 'http://127.0.0.1:3001';
const DEV_UID = 'deep_live_user';
const ADMIN_EMAIL = 'admin1@vflowai.com';
const ADMIN_PASSWORD = 'rease1999.';

const backendUrl = (path) => `${BACKEND_URL}${path}`;
const snapshotUrl = (path) => `${SNAPSHOT_URL}${path}`;

async function expectJson(response, status = 200) {
  expect(response.status()).toBe(status);
  const contentType = response.headers()['content-type'] || '';
  expect(contentType).toContain('application/json');
  return response.json();
}

function devHeaders(extra = {}) {
  return {
    'x-dev-uid': DEV_UID,
    ...extra,
  };
}

test('backend health, seeded admin login, session read, and admin gate are live', async ({ request }) => {
  const health = await expectJson(await request.get(backendUrl('/healthz')));
  expect(health.ok).toBe(true);
  expect(health.env.DB).toBe(true);
  expect(health.env.ARTIFACTS_BUCKET).toBe(true);
  expect(health.env.JOB_QUEUE).toBe(true);

  const contracts = await expectJson(await request.get(backendUrl('/api/v1/ops/contracts')));
  expect(contracts.routes.auth).toContain('/api/auth');
  expect(contracts.routes.storage).toContain('/api/v1/storage');
  expect(contracts.routes.tts).toContain('/api/v1/studio/tts');

  const loginResponse = await request.post(backendUrl('/api/auth/session'), {
    data: {
      email: ADMIN_EMAIL,
      password: ADMIN_PASSWORD,
    },
  });
  const login = await expectJson(loginResponse);
  expect(login.ok).toBe(true);
  expect(login.user.email_normalized).toBe(ADMIN_EMAIL);
  expect(login.session.revoked_at).toBeNull();
  expect(login.roles.map((role) => role.slug)).toContain('admin');

  const cookie = loginResponse.headers()['set-cookie'];
  expect(cookie).toContain('vf_session=');

  const session = await expectJson(await request.get(backendUrl('/api/auth/session'), {
    headers: {
      cookie,
    },
  }));
  expect(session.ok).toBe(true);
  expect(session.user.email_normalized).toBe(ADMIN_EMAIL);

  const adminUsers = await expectJson(await request.get(backendUrl('/api/v1/admin/users'), {
    headers: {
      cookie,
    },
  }));
  expect(adminUsers.count).toBeGreaterThanOrEqual(4);
  expect(adminUsers.items.map((item) => item.email_normalized || item.email)).toContain(ADMIN_EMAIL);
});

test('account, billing, profile, settings, and support D1 contracts persist locally', async ({ request }) => {
  const headers = devHeaders({ 'content-type': 'application/json' });

  const bootstrap = await expectJson(await request.get(backendUrl('/api/v1/account/bootstrap'), { headers }));
  expect(bootstrap.ok).toBe(true);
  expect(bootstrap.user.userId).toBe(DEV_UID);
  expect(bootstrap.replatform.stack).toBe('cloudflare-native');

  const profilePatch = {
    displayName: 'Deep Live User',
    billingProfile: {
      companyName: 'V Flow QA',
      contactName: 'Deep Live User',
      email: 'deep-live@example.com',
    },
  };
  const savedProfile = await expectJson(await request.post(backendUrl('/api/v1/account/profile'), {
    headers,
    data: profilePatch,
  }));
  expect(savedProfile.profile.displayName).toBe('Deep Live User');
  expect(savedProfile.profile.billingProfile.companyName).toBe('V Flow QA');

  const settings = await expectJson(await request.patch(backendUrl('/api/v1/account/settings'), {
    headers,
    data: {
      theme: 'aurora',
      motionLevel: 'balanced',
      notifications: {
        emailSupport: true,
        emailSecurity: true,
        emailProduct: false,
      },
    },
  }));
  expect(settings.settings.theme).toBe('aurora');
  expect(settings.settings.notifications.emailProduct).toBe(false);

  const support = await expectJson(await request.post(backendUrl('/api/v1/account/support/messages'), {
    headers,
    data: {
      subject: 'Deep live backend QA',
      body: 'Testing persisted support message storage.',
      category: 'qa',
    },
  }));
  expect(support.message.subject).toBe('Deep live backend QA');

  const supportList = await expectJson(await request.get(backendUrl('/api/v1/account/support/messages?limit=10'), { headers }));
  expect(supportList.items.map((item) => item.subject)).toContain('Deep live backend QA');

  const billing = await expectJson(await request.get(backendUrl('/api/v1/billing/account-summary'), { headers }));
  expect(billing.summary.userId).toBe(DEV_UID);

  const portal = await expectJson(await request.post(backendUrl('/api/v1/billing/portal-session'), {
    headers,
    data: {
      returnUrl: '/app/billing?source=deep-live',
    },
  }));
  expect(portal.ok).toBe(true);
  expect(portal.provider).toBe('d1');
  expect(portal.url).toContain('portalSession=');

  const cancelled = await expectJson(await request.post(backendUrl('/api/v1/billing/subscription/cancel'), { headers }));
  expect(cancelled.summary.subscription.status).toBe('cancelled');
  expect(cancelled.summary.subscription.cancelAtPeriodEnd).toBe(true);
  expect(typeof cancelled.summary.subscription.cancelledAt).toBe('number');
  expect('renewedAt' in cancelled.summary.subscription).toBe(false);

  const resumed = await expectJson(await request.post(backendUrl('/api/v1/billing/subscription/resume'), { headers }));
  expect(resumed.summary.subscription.status).toBe('active');
  expect(resumed.summary.subscription.cancelAtPeriodEnd).toBe(false);
  expect(typeof resumed.summary.subscription.resumedAt).toBe('number');
});

test('R2 storage aliases, Queue jobs, and TTS broker boundary contracts are live', async ({ request }) => {
  const key = `qa/deep-live/${Date.now()}.txt`;
  const headers = devHeaders({ 'content-type': 'text/plain' });
  const body = 'deep live storage payload';

  const put = await expectJson(await request.put(backendUrl(`/api/v1/storage/object?key=${encodeURIComponent(key)}`), {
    headers,
    data: body,
  }));
  expect(put.ok).toBe(true);
  expect(put.artifact.key).toBe(key);

  const stored = await request.get(backendUrl(`/api/v1/storage/object?key=${encodeURIComponent(key)}`), {
    headers: devHeaders(),
  });
  expect(stored.status()).toBe(200);
  expect(await stored.text()).toBe(body);

  const readerAlias = await request.get(backendUrl(`/api/v1/library/reader/object?key=${encodeURIComponent(key)}`), {
    headers: devHeaders(),
  });
  expect(readerAlias.status()).toBe(200);
  expect(await readerAlias.text()).toBe(body);

  const list = await expectJson(await request.get(backendUrl('/api/v1/storage/objects?prefix=qa/deep-live&limit=20'), {
    headers: devHeaders(),
  }));
  expect(list.keys.some((item) => item.key === key)).toBe(true);

  const job = await expectJson(await request.post(backendUrl('/api/v1/library/audio-novel/jobs'), {
    headers: devHeaders({ 'content-type': 'application/json' }),
    data: {
      bookId: 'deep-live-book',
      text: 'Narrator: Testing queue orchestration.',
    },
  }));
  expect(job.ok).toBe(true);
  expect(job.status).toBe('queued');
  expect(job.job.enqueued).toBe(true);

  const next = await expectJson(await request.get(backendUrl('/api/v1/library/audio-novel/jobs/next'), {
    headers: devHeaders(),
  }));
  expect(next.ok).toBe(true);
  expect(next.job).toBeNull();
  expect('jobId' in next).toBe(false);

  const status = await expectJson(await request.patch(backendUrl('/api/v1/library/audio-novel/jobs/deep-live/status'), {
    headers: devHeaders({ 'content-type': 'application/json' }),
    data: {
      status: 'running',
      progress: 42,
      message: 'Deep live status update',
    },
  }));
  expect(status.jobId).toBe('deep-live');
  expect(status.job.progress).toBe(42);

  const cancel = await expectJson(await request.post(backendUrl('/api/v1/library/audio-novel/jobs/deep-live/cancel'), {
    headers: devHeaders(),
  }));
  expect(cancel.status).toBe('canceled');

  for (const path of [
    '/api/v1/studio/tts/synthesize',
    '/api/v1/studio/tts/long-text',
    '/api/v1/studio/tts/stream',
    '/api/v1/tts/synthesize',
    '/api/v1/studio/tts/novel/jobs',
  ]) {
    const tts = await expectJson(await request.post(backendUrl(path), {
      headers: devHeaders({ 'content-type': 'application/json' }),
      data: {
        bookId: 'deep-live-book',
        text: 'This is a deep live TTS boundary test.',
        voiceId: 'deep-live-voice',
      },
    }));
    expect(tts.ok).toBe(true);
    expect(tts.status || tts.job?.status).toBe('queued');
  }

  const deleted = await expectJson(await request.delete(backendUrl(`/api/v1/storage/object?key=${encodeURIComponent(key)}`), {
    headers: devHeaders(),
  }));
  expect(deleted.ok).toBe(true);

  const missing = await expectJson(await request.get(backendUrl(`/api/v1/storage/object?key=${encodeURIComponent(key)}`), {
    headers: devHeaders(),
  }), 404);
  expect(missing.error).toBe('Artifact not found.');
});

test('frozen route sections and billing/account tabs remain browser reachable', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  const landing = page.frameLocator('iframe[title="V FLOW AI landing page"]');
  await expect(landing.locator('[data-testid="landing-home"]')).toBeVisible();
  await expect(landing.locator('[data-testid="hero-primary-cta"]')).toHaveAttribute('href', '/app/login?mode=login&next=%2Fapp%2Fstudio');
  await expect(landing.locator('body')).toContainText('Open Studio');

  await page.goto('/app/account', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('[data-vf-app-shell="true"]')).toBeVisible();
  await expect(page.locator('body')).toContainText('Your account is loading.');
  await expect(page.locator('body')).toContainText('Keep this tab open');

  await page.goto('/app/billing', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('[data-vf-app-shell="true"]')).toBeVisible();
  await expect(page.locator('body')).toContainText('Billing stays in the same shell.');
  await expect(page.locator('body')).toContainText('Portal is pending');
});

test('demo audio assets load and can reach browser audio metadata state', async ({ page, request }) => {
  const assets = [
    '/audio/vector-demo/future-is-now-en.wav',
    '/audio/vector-multi-demo/en-ai-debate.wav',
  ];

  for (const asset of assets) {
    const response = await request.get(snapshotUrl(asset));
    expect(response.status(), `${asset} should be served by the snapshot/static server`).toBe(200);
    expect(response.headers()['content-type']).toContain('audio/wav');
    expect((await response.body()).byteLength).toBeGreaterThan(10_000);
  }

  await page.goto(snapshotUrl('/'), { waitUntil: 'domcontentloaded' });
  const result = await page.evaluate(async (src) => {
    const audio = new Audio(src);
    audio.preload = 'metadata';
    audio.muted = true;

    return new Promise((resolve) => {
      const done = (payload) => resolve({
        readyState: audio.readyState,
        duration: Number.isFinite(audio.duration) ? audio.duration : null,
        ...payload,
      });
      audio.addEventListener('loadedmetadata', () => done({ loaded: true }), { once: true });
      audio.addEventListener('canplay', () => done({ canplay: true }), { once: true });
      audio.addEventListener('error', () => done({ errorCode: audio.error?.code || 'unknown' }), { once: true });
      setTimeout(() => done({ timeout: true }), 10_000);
      audio.load();
    });
  }, assets[0]);

  expect(result.errorCode).toBeFalsy();
  expect(result.timeout).toBeFalsy();
  expect(result.readyState).toBeGreaterThan(0);
});
