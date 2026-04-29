import { expect, test } from '@playwright/test';

async function visitAndAssert(page, route, kind, assertions) {
  const pageErrors = [];

  page.on('pageerror', (error) => {
    pageErrors.push(error.message);
  });

  const response = await page.goto(route, { waitUntil: 'domcontentloaded' });
  expect(response, `No response received for ${route}`).not.toBeNull();
  expect(response.status(), `Route returned an HTTP error for ${route}`).toBeLessThan(400);

  if (kind === 'stub') {
    const stubResponse = await page.request.get(route);
    expect(stubResponse, `No stub response received for ${route}`).not.toBeNull();
    expect(stubResponse.status(), `Stub route returned an HTTP error for ${route}`).toBeLessThan(400);
    const html = await stubResponse.text();

    for (const text of assertions.initialContains ?? []) {
      expect(html, `Missing stub text "${text}" in the initial response for ${route}`).toContain(text);
    }

    if (assertions.redirectPath) {
      await expect.poll(
        () => new URL(page.url()).pathname,
        { timeout: 5_000 }
      ).toBe(assertions.redirectPath);
    }
  }

  if (kind === 'page') {
    const requestedPath = new URL(route, page.url()).pathname;
    const finalPath = new URL(page.url()).pathname;
    expect(finalPath, `Unexpected redirect for ${route}`).toBe(requestedPath);
    await expect(page.locator('body'), `Route drifted to a 404 page for ${route}`).not.toContainText('This page could not be found.');
  }

  const root = assertions.frame ? page.frameLocator(assertions.frameSelector ?? 'iframe') : page;

  if (assertions.titleContains) {
    const title = await page.title();
    expect(title, `Title did not include "${assertions.titleContains}" on ${route}`).toContain(assertions.titleContains);
  }

  for (const text of assertions.contains ?? []) {
    await expect(root.locator('body'), `Missing text "${text}" on ${route}`).toContainText(text);
  }

  for (const [selector, expected] of assertions.attributes ?? []) {
    await expect(root.locator(selector), `Missing selector ${selector} on ${route}`).toHaveAttribute(expected.name, expected.value);
  }

  for (const selector of assertions.visible ?? []) {
    await expect(root.locator(selector), `Missing visible element ${selector} on ${route}`).toBeVisible();
  }

  expect(pageErrors, `Page errors while loading ${route}: ${pageErrors.join(' | ')}`).toEqual([]);
}

const landingAssertions = {
  contains: ['Script to voice.', 'No filler.', 'Open Studio'],
  visible: ['[data-testid="landing-home"]', '[data-testid="hero-primary-cta"]'],
  attributes: [
    ['[data-testid="hero-primary-cta"]', { name: 'href', value: '/app/login?mode=login&next=%2Fapp%2Fstudio' }],
  ],
  frame: true,
  frameSelector: 'iframe[title="V FLOW AI landing page"]',
};

const loginAssertions = {
  contains: ['Sign in to continue to your workspace.', 'New signups are temporarily paused. Existing users can still sign in.'],
  visible: ['form#login-form', '#route-login-email', '#route-login-password'],
  attributes: [
    ['#next-field', { name: 'value', value: '/app/studio' }],
  ],
  frame: true,
  frameSelector: 'iframe[title="Login | V FLOW AI"]',
};

const appAssertions = {
  contains: ['Workspace handoff', 'Opening Studio', "We're checking your session and sending you to the right starting point.", 'Checking session and route', 'Keep this tab open'],
  visible: ['[data-vf-app-shell="true"]', '[data-testid="brand-logo"]'],
};

const onboardingAssertions = {
  contains: ['Workspace handoff', 'Opening Studio', "We're checking your session and sending you to the right starting point.", 'Checking session and route', 'Keep this tab open'],
  visible: ['[data-vf-app-shell="true"]', '[data-testid="brand-logo"]'],
};

const studioAssertions = {
  contains: ['Workspace handoff', 'Opening Studio', "We're checking your session and sending you to the right starting point.", 'Checking session and route', 'Keep this tab open'],
  visible: ['[data-vf-app-shell="true"]', '[data-testid="brand-logo"]'],
};

const billingAssertions = {
  contains: ['Pricing is coming soon.', '5 plans from', 'New account creation is temporarily paused while we finish launch checks.'],
  visible: ['[data-billing-mode="public"]'],
  frame: true,
  frameSelector: 'iframe[title="Billing | V FLOW AI"]',
};

function legalSnapshotAssertions(title, contains = title) {
  return {
    titleContains: title,
    contains: [contains],
    frame: true,
    frameSelector: `iframe[title="${title}"]`,
  };
}

const routeInventory = [
  { route: '/', kind: 'page', assertions: landingAssertions },
  { route: '/landing', kind: 'page', assertions: landingAssertions },
  { route: '/app', kind: 'page', assertions: appAssertions },
  { route: '/app/login', kind: 'page', assertions: loginAssertions },
  { route: '/app/login?mode=login&next=%2Fapp%2Fstudio', kind: 'page', assertions: loginAssertions },
  { route: '/app/onboarding', kind: 'page', assertions: onboardingAssertions },
  { route: '/app/studio', kind: 'page', assertions: studioAssertions },
  { route: '/billing', kind: 'page', assertions: billingAssertions },
  { route: '/legal', kind: 'page', assertions: {} },
  { route: '/legal/terms', kind: 'page', assertions: legalSnapshotAssertions('Terms of Service') },
  { route: '/legal/privacy', kind: 'page', assertions: legalSnapshotAssertions('Privacy Policy') },
  { route: '/legal/acceptable-use', kind: 'page', assertions: legalSnapshotAssertions('Acceptable Use Policy') },
  { route: '/legal/cookies', kind: 'page', assertions: legalSnapshotAssertions('Cookie Policy') },
  { route: '/legal/billing-refunds', kind: 'page', assertions: legalSnapshotAssertions('Billing and Refund Policy', 'Billing') },
  { route: '/legal/copyright', kind: 'page', assertions: legalSnapshotAssertions('Copyright and IP Notice', 'Copyright') },
  { route: '/app/library', kind: 'page', assertions: {} },
  { route: '/app/reader', kind: 'page', assertions: {} },
  { route: '/app/reader/demo-book', kind: 'stub', assertions: { initialContains: ['Reader handoff', 'Loading reader', 'Checking local storage...'], redirectPath: '/app/library/demo-book/read' } },
  { route: '/app/library/demo-book/read', kind: 'page', assertions: {} },
  {
    route: '/app/account',
    kind: 'page',
    assertions: {
      contains: ['Your account is loading.', 'Checking session and billing', 'Keep this tab open'],
      visible: ['[data-vf-app-shell="true"]', '[data-testid="brand-logo"]'],
      attributes: [
        ['a[href="/app/studio"]', { name: 'href', value: '/app/studio' }],
        ['a[href="/app/login?mode=login&next=%2Fapp%2Fstudio"]', { name: 'href', value: '/app/login?mode=login&next=%2Fapp%2Fstudio' }],
      ],
    },
  },
  {
    route: '/app/billing',
    kind: 'page',
    assertions: {
      contains: ['Billing stays in the same shell.', 'We\'re reading the billing summary and keeping the route outcome stable while the UI stays frozen.', 'Portal is pending'],
      visible: ['[data-vf-app-shell="true"]', '[data-testid="brand-logo"]'],
      attributes: [
        ['a[href="/app/studio"]', { name: 'href', value: '/app/studio' }],
        ['a[href="/app/login?mode=login&next=%2Fapp%2Fstudio"]', { name: 'href', value: '/app/login?mode=login&next=%2Fapp%2Fstudio' }],
      ],
    },
  },
  {
    route: '/app/admin',
    kind: 'page',
    assertions: {
      contains: ['Operational controls', 'Admin access blocked', 'Users visible', 'Sign in', 'Back to library'],
      attributes: [
        ['a[href="/app/login?mode=login&next=%2Fapp%2Fadmin"]', { name: 'href', value: '/app/login?mode=login&next=%2Fapp%2Fadmin' }],
        ['a[href="/app/library"]', { name: 'href', value: '/app/library' }],
      ],
    },
  },
  {
    route: '/app/admin/users',
    kind: 'page',
    assertions: {
      contains: ['Operational controls', 'Admin access blocked', 'Users visible', 'Sign in', 'Back to library'],
      attributes: [
        ['a[href="/app/login?mode=login&next=%2Fapp%2Fadmin"]', { name: 'href', value: '/app/login?mode=login&next=%2Fapp%2Fadmin' }],
        ['a[href="/app/library"]', { name: 'href', value: '/app/library' }],
      ],
    },
  },
  { route: '/app/library/library/read', kind: 'stub', assertions: { initialContains: ['Reader handoff', 'Loading reader', 'Checking local storage...'], redirectPath: '/app/library' } },
  { route: '/app/reader/library', kind: 'stub', assertions: { initialContains: ['Reader handoff', 'Loading reader', 'Checking local storage...'], redirectPath: '/app/library' } },
];

for (const { route, kind, assertions } of routeInventory) {
  test(`${kind} route contract: ${route}`, async ({ page }) => {
    await visitAndAssert(page, route, kind, assertions);
  });
}

test('login bridge signs in with the seeded admin account and reaches studio', async ({ page }) => {
  await page.goto('http://127.0.0.1:3001/app/login/index.html?mode=login&next=%2Fapp%2Fstudio', { waitUntil: 'domcontentloaded' });

  await expect(page.locator('form#login-form')).toBeVisible();

  await page.locator('#route-login-email').fill('admin1@vflowai.com');
  await page.locator('#route-login-password').fill('rease1999.');
  await page.locator('#login-form').evaluate((form) => form.requestSubmit());

  await expect.poll(
    () => new URL(page.url()).pathname,
    { timeout: 15_000 }
  ).toBe('/app/studio');
});
