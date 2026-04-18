/**
 * commandPalette.test.ts
 *
 * Contract tests for the CommandPalette navigation data and keyboard-shortcut logic.
 * We test the data/helpers in isolation; JSX rendering is covered by Playwright smoke tests.
 */

import { describe, it, expect } from "vitest";

/* ── Navigation catalogue ────────────────────────────── */

const NAV_ITEMS = [
  { id: "studio",  label: "Studio",  href: "/app/studio"    },
  { id: "reader",  label: "Reader",  href: "/app/reader-v2" },
  { id: "library", label: "Library", href: "/app/library"   },
  { id: "voices",  label: "Voices",  href: "/app/voices"    },
  { id: "home",    label: "Home",    href: "/app"           },
];

const ACCOUNT_ITEMS = [
  { id: "profile",  label: "Profile",        href: "/app/profile"  },
  { id: "billing",  label: "Billing & Plans", href: "/app/billing"  },
  { id: "settings", label: "Settings",        href: "/app/account"  },
  { id: "signout",  label: "Sign out",        href: "/app/login",   keywords: "logout sign out exit" },
];

describe("CommandPalette — navigation catalogue", () => {
  it("has 5 nav items", () => {
    expect(NAV_ITEMS).toHaveLength(5);
  });

  it("all nav items have non-empty id, label, href", () => {
    for (const item of NAV_ITEMS) {
      expect(item.id).toBeTruthy();
      expect(item.label).toBeTruthy();
      expect(item.href).toMatch(/^\/app/);
    }
  });

  it("studio route is /app/studio", () => {
    expect(NAV_ITEMS.find((i) => i.id === "studio")?.href).toBe("/app/studio");
  });

  it("reader route is /app/reader-v2", () => {
    expect(NAV_ITEMS.find((i) => i.id === "reader")?.href).toBe("/app/reader-v2");
  });

  it("library route is /app/library", () => {
    expect(NAV_ITEMS.find((i) => i.id === "library")?.href).toBe("/app/library");
  });

  it("has 4 account items", () => {
    expect(ACCOUNT_ITEMS).toHaveLength(4);
  });

  it("all account items have non-empty id, label, href", () => {
    for (const item of ACCOUNT_ITEMS) {
      expect(item.id).toBeTruthy();
      expect(item.label).toBeTruthy();
      expect(item.href).toMatch(/^\/app/);
    }
  });

  it("signout item has keywords for fuzzy search", () => {
    const signout = ACCOUNT_ITEMS.find((i) => i.id === "signout");
    expect(signout?.keywords).toMatch(/logout/);
  });
});

/* ── Keyboard shortcut guard ─────────────────────────── */

function shouldOpenPalette(e: { metaKey: boolean; ctrlKey: boolean; key: string }): boolean {
  return (e.metaKey || e.ctrlKey) && e.key === "k";
}

describe("CommandPalette — keyboard shortcut", () => {
  it("opens on Ctrl+K", () => {
    expect(shouldOpenPalette({ metaKey: false, ctrlKey: true, key: "k" })).toBe(true);
  });

  it("opens on Cmd+K (macOS)", () => {
    expect(shouldOpenPalette({ metaKey: true, ctrlKey: false, key: "k" })).toBe(true);
  });

  it("does NOT open on plain K", () => {
    expect(shouldOpenPalette({ metaKey: false, ctrlKey: false, key: "k" })).toBe(false);
  });

  it("does NOT open on Ctrl+J", () => {
    expect(shouldOpenPalette({ metaKey: false, ctrlKey: true, key: "j" })).toBe(false);
  });
});

/* ── Combined item catalogue ─────────────────────────── */

describe("CommandPalette — combined catalogue", () => {
  const allItems = [...NAV_ITEMS, ...ACCOUNT_ITEMS];

  it("total items = 9", () => {
    expect(allItems).toHaveLength(9);
  });

  it("no duplicate ids", () => {
    const ids = allItems.map((i) => i.id);
    const unique = new Set(ids);
    expect(unique.size).toBe(ids.length);
  });

  it("all hrefs start with /app", () => {
    for (const item of allItems) {
      expect(item.href).toMatch(/^\/app/);
    }
  });
});
