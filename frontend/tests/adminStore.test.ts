/**
 * adminStore.test.ts
 *
 * Contract tests for the adminStore Zustand slice.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { useAdminStore } from "../src/features/admin/v2/adminStore";

beforeEach(() => {
  useAdminStore.getState().reset();
});

/* ── Initial state ───────────────────────────────────── */

describe("adminStore — initial state", () => {
  it("tab defaults to overview", () => {
    expect(useAdminStore.getState().tab).toBe("overview");
  });

  it("metricsStatus is idle", () => {
    expect(useAdminStore.getState().metricsStatus).toBe("idle");
  });

  it("usersStatus is idle", () => {
    expect(useAdminStore.getState().usersStatus).toBe("idle");
  });

  it("metrics are all null", () => {
    const { mau, queueDepth, p95Ms, mrrCents } = useAdminStore.getState().metrics;
    expect(mau).toBeNull();
    expect(queueDepth).toBeNull();
    expect(p95Ms).toBeNull();
    expect(mrrCents).toBeNull();
  });

  it("users is empty array", () => {
    expect(useAdminStore.getState().users).toHaveLength(0);
  });
});

/* ── Tab actions ─────────────────────────────────────── */

describe("adminStore — setTab", () => {
  it("sets tab to users", () => {
    useAdminStore.getState().setTab("users");
    expect(useAdminStore.getState().tab).toBe("users");
  });

  it("sets tab to jobs", () => {
    useAdminStore.getState().setTab("jobs");
    expect(useAdminStore.getState().tab).toBe("jobs");
  });

  it("sets tab to flags", () => {
    useAdminStore.getState().setTab("flags");
    expect(useAdminStore.getState().tab).toBe("flags");
  });

  it("sets tab to audit", () => {
    useAdminStore.getState().setTab("audit");
    expect(useAdminStore.getState().tab).toBe("audit");
  });
});

/* ── Metrics actions ─────────────────────────────────── */

describe("adminStore — metrics", () => {
  it("setMetrics patches mau", () => {
    useAdminStore.getState().setMetrics({ mau: 12345 });
    expect(useAdminStore.getState().metrics.mau).toBe(12345);
  });

  it("setMetrics patches multiple fields without clobbering others", () => {
    useAdminStore.getState().setMetrics({ mau: 100, p95Ms: 480 });
    const { mau, p95Ms, queueDepth } = useAdminStore.getState().metrics;
    expect(mau).toBe(100);
    expect(p95Ms).toBe(480);
    expect(queueDepth).toBeNull();
  });

  it("setMetricsStatus sets loading", () => {
    useAdminStore.getState().setMetricsStatus("loading");
    expect(useAdminStore.getState().metricsStatus).toBe("loading");
    expect(useAdminStore.getState().metricsError).toBeNull();
  });

  it("setMetricsStatus sets error with message", () => {
    useAdminStore.getState().setMetricsStatus("error", "network timeout");
    expect(useAdminStore.getState().metricsStatus).toBe("error");
    expect(useAdminStore.getState().metricsError).toBe("network timeout");
  });

  it("setMetricsStatus clears error on loaded", () => {
    useAdminStore.getState().setMetricsStatus("error", "bad");
    useAdminStore.getState().setMetricsStatus("loaded");
    expect(useAdminStore.getState().metricsError).toBeNull();
  });
});

/* ── Users actions ───────────────────────────────────── */

describe("adminStore — users", () => {
  const SAMPLE_USERS = [
    { uid: "u1", email: "a@a.com", displayName: null, isPremium: false, tokensRemaining: 50000, createdAt: "2025-01-01" },
    { uid: "u2", email: "b@b.com", displayName: "Bob", isPremium: true, tokensRemaining: null, createdAt: "2025-03-15" },
  ];

  it("setUsers stores rows", () => {
    useAdminStore.getState().setUsers(SAMPLE_USERS);
    expect(useAdminStore.getState().users).toHaveLength(2);
  });

  it("setUsersStatus sets loading", () => {
    useAdminStore.getState().setUsersStatus("loading");
    expect(useAdminStore.getState().usersStatus).toBe("loading");
  });

  it("setUsersStatus error stores message", () => {
    useAdminStore.getState().setUsersStatus("error", "403 Forbidden");
    expect(useAdminStore.getState().usersError).toBe("403 Forbidden");
  });

  it("user isPremium flag is preserved", () => {
    useAdminStore.getState().setUsers(SAMPLE_USERS);
    const premium = useAdminStore.getState().users.filter((u) => u.isPremium);
    expect(premium).toHaveLength(1);
    expect(premium[0].uid).toBe("u2");
  });
});

/* ── Reset ───────────────────────────────────────────── */

describe("adminStore — reset", () => {
  it("reset clears all state to defaults", () => {
    useAdminStore.getState().setTab("audit");
    useAdminStore.getState().setMetrics({ mau: 9999 });
    useAdminStore.getState().setMetricsStatus("loaded");
    useAdminStore.getState().reset();

    const s = useAdminStore.getState();
    expect(s.tab).toBe("overview");
    expect(s.metrics.mau).toBeNull();
    expect(s.metricsStatus).toBe("idle");
    expect(s.users).toHaveLength(0);
  });
});

/* ── Selectors ───────────────────────────────────────── */

import { selectMetricsReady, selectUsersReady } from "../src/features/admin/v2/adminStore";

describe("adminStore — selectors", () => {
  it("selectMetricsReady is false when idle", () => {
    expect(selectMetricsReady(useAdminStore.getState())).toBe(false);
  });

  it("selectMetricsReady is true when loaded", () => {
    useAdminStore.getState().setMetricsStatus("loaded");
    expect(selectMetricsReady(useAdminStore.getState())).toBe(true);
  });

  it("selectUsersReady is false when idle", () => {
    expect(selectUsersReady(useAdminStore.getState())).toBe(false);
  });

  it("selectUsersReady is true when loaded", () => {
    useAdminStore.getState().setUsersStatus("loaded");
    expect(selectUsersReady(useAdminStore.getState())).toBe(true);
  });
});
