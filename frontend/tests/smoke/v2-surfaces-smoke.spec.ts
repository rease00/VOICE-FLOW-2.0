/**
 * v2-surfaces-smoke.spec.ts
 *
 * Live browser smoke tests for v2 surfaces.
 * Auth-protected routes redirect to /app/login — tests verify:
 *   1. Redirect works correctly (no 500s)
 *   2. Login page renders
 *   3. Redirect preserves ?next= parameter
 *   4. Landing page (public) renders without crash
 */

import { test, expect } from "@playwright/test";

test.describe("v2 surfaces — auth redirect", () => {
  const protectedRoutes = [
    { path: "/app/settings", label: "Settings" },
    { path: "/app/admin", label: "Admin" },
    { path: "/app/studio", label: "Studio" },
  ];

  for (const { path, label } of protectedRoutes) {
    test(`${label} (${path}) redirects to login without crashing`, async ({ page }) => {
      const response = await page.goto(path, { waitUntil: "domcontentloaded", timeout: 30000 });
      // Should not 500
      expect(response?.status()).toBeLessThan(500);
      // Should redirect to login
      expect(page.url()).toContain("/app/login");
      // Redirect should preserve next= param
      expect(page.url()).toContain(`next=${encodeURIComponent(path)}`);
    });
  }
});

test.describe("v2 surfaces — login page rendering", () => {
  test("login page loads and shows heading", async ({ page }) => {
    await page.goto("/app/login", { waitUntil: "domcontentloaded", timeout: 30000 });
    // Login heading should be visible
    const heading = page.locator("h1, h2").first();
    await expect(heading).toBeVisible({ timeout: 15000 });
  });

  test("login page has no console errors", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (err) => errors.push(err.message));
    await page.goto("/app/login", { waitUntil: "networkidle", timeout: 30000 });
    // Allow Firebase/network errors but no React crashes
    const reactCrashes = errors.filter(
      (e) => e.includes("Minified React error") || e.includes("Uncaught Error")
    );
    expect(reactCrashes).toHaveLength(0);
  });
});

test.describe("v2 surfaces — public pages", () => {
  test("landing page loads without crash", async ({ page }) => {
    const response = await page.goto("/", { waitUntil: "domcontentloaded", timeout: 30000 });
    expect(response?.status()).toBeLessThan(500);
    // Should have some content
    await expect(page.locator("body")).not.toBeEmpty();
  });

  test("landing page has no React crashes", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (err) => errors.push(err.message));
    await page.goto("/", { waitUntil: "networkidle", timeout: 30000 });
    const reactCrashes = errors.filter(
      (e) => e.includes("Minified React error") || e.includes("Uncaught Error")
    );
    expect(reactCrashes).toHaveLength(0);
  });

  test("/app/library loads without crash (not auth-gated)", async ({ page }) => {
    const response = await page.goto("/app/library", { waitUntil: "domcontentloaded", timeout: 30000 });
    expect(response?.status()).toBeLessThan(500);
    await expect(page.locator("body")).not.toBeEmpty();
  });
});
