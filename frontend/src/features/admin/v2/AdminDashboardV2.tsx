"use client";

import { useEffect, useCallback } from "react";
import {
  Users,
  Layers,
  Zap,
  DollarSign,
  ShieldAlert,
  RefreshCw,
  ClipboardList,
  Flag,
  Briefcase,
  Activity,
} from "lucide-react";
import { cn } from "@/ui/cn";
import { Card } from "@/ui/Card";
import { Button } from "@/ui/Button";
import { useAdminStore, type AdminTab, type AdminUser } from "./adminStore";
import { adminApi } from "@/api/index";
import { isAdminLoginEmail } from "@/shared/auth/adminProvisioning";
import { firebaseAuth } from "../../../../services/firebaseClient";

/* ── Helpers ─────────────────────────────────────────── */

const fmtNum = (n: number | null): string =>
  n === null ? "—" : n.toLocaleString();

const fmtMs = (n: number | null): string =>
  n === null ? "—" : `${n.toLocaleString()} ms`;

const fmtMrr = (cents: number | null): string =>
  cents === null ? "—" : `$${(cents / 100).toLocaleString(undefined, { minimumFractionDigits: 2 })}`;

/* ── Stat tile ────────────────────────────────────────── */

interface StatTileProps {
  label: string;
  value: string;
  icon: React.ReactNode;
  loading?: boolean;
  accent?: string;
}

function StatTile({ label, value, icon, loading, accent }: StatTileProps) {
  return (
    <Card elevation={2} className="flex items-start gap-4">
      <span
        className={cn(
          "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl",
          accent ?? "bg-[var(--aurora-1)]/15 text-[var(--aurora-1)]",
        )}
      >
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-xs text-[var(--vf-color-text-muted)]">{label}</p>
        {loading ? (
          <div className="mt-1 h-5 w-24 animate-pulse rounded bg-white/10" />
        ) : (
          <p className="mt-0.5 text-xl font-semibold text-[var(--vf-color-text-primary)]">
            {value}
          </p>
        )}
      </div>
    </Card>
  );
}

/* ── Tab bar ─────────────────────────────────────────── */

const TABS: { id: AdminTab; label: string; icon: React.ReactNode }[] = [
  { id: "overview", label: "Overview", icon: <Activity className="h-4 w-4" /> },
  { id: "users",    label: "Users",    icon: <Users className="h-4 w-4" /> },
  { id: "jobs",     label: "Jobs",     icon: <Briefcase className="h-4 w-4" /> },
  { id: "flags",    label: "Flags",    icon: <Flag className="h-4 w-4" /> },
  { id: "audit",    label: "Audit",    icon: <ClipboardList className="h-4 w-4" /> },
];

function TabBar({
  active,
  onChange,
}: {
  active: AdminTab;
  onChange: (t: AdminTab) => void;
}) {
  return (
    <div className="flex gap-1 rounded-xl border border-white/10 bg-white/5 p-1">
      {TABS.map((t) => (
        <button
          key={t.id}
          onClick={() => onChange(t.id)}
          className={cn(
            "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-all",
            active === t.id
              ? "bg-[var(--aurora-1)]/15 text-[var(--aurora-1)]"
              : "text-[var(--vf-color-text-muted)] hover:text-[var(--vf-color-text-primary)]",
          )}
        >
          {t.icon}
          {t.label}
        </button>
      ))}
    </div>
  );
}

/* ── Users table ─────────────────────────────────────── */

function UsersTable({ users, loading }: { users: AdminUser[]; loading: boolean }) {
  if (loading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="h-10 w-full animate-pulse rounded-lg bg-white/8" />
        ))}
      </div>
    );
  }

  if (!users.length) {
    return (
      <p className="py-12 text-center text-sm text-[var(--vf-color-text-muted)]">
        No users loaded.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-white/10">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-white/10 text-left text-xs text-[var(--vf-color-text-muted)]">
            <th className="px-4 py-2.5">Email</th>
            <th className="px-4 py-2.5">UID</th>
            <th className="px-4 py-2.5">Plan</th>
            <th className="px-4 py-2.5">Tokens</th>
            <th className="px-4 py-2.5">Joined</th>
          </tr>
        </thead>
        <tbody>
          {users.map((u) => (
            <tr
              key={u.uid}
              className="border-b border-white/5 transition-colors hover:bg-white/5"
            >
              <td className="px-4 py-2.5 font-mono text-[var(--vf-color-text-primary)]">
                {u.email || "—"}
              </td>
              <td className="px-4 py-2.5 font-mono text-xs text-[var(--vf-color-text-muted)]">
                {u.uid.slice(0, 16)}…
              </td>
              <td className="px-4 py-2.5">
                <span
                  className={cn(
                    "rounded-full px-2 py-0.5 text-xs font-semibold",
                    u.isPremium
                      ? "bg-[var(--aurora-1)]/15 text-[var(--aurora-1)]"
                      : "bg-white/8 text-[var(--vf-color-text-muted)]",
                  )}
                >
                  {u.isPremium ? "Pro" : "Free"}
                </span>
              </td>
              <td className="px-4 py-2.5 tabular-nums text-[var(--vf-color-text-primary)]">
                {u.tokensRemaining !== null ? u.tokensRemaining.toLocaleString() : "—"}
              </td>
              <td className="px-4 py-2.5 text-xs text-[var(--vf-color-text-muted)]">
                {u.createdAt ? new Date(u.createdAt).toLocaleDateString() : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ── Placeholder panel ───────────────────────────────── */

function PlaceholderPanel({ label }: { label: string }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-white/15 py-20">
      <Layers className="mb-3 h-8 w-8 text-[var(--vf-color-text-muted)]" />
      <p className="text-sm text-[var(--vf-color-text-muted)]">
        {label} — coming soon
      </p>
    </div>
  );
}

/* ── Access denied ───────────────────────────────────── */

function AccessDenied() {
  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center gap-4 text-center">
      <ShieldAlert className="h-12 w-12 text-rose-400" />
      <h2 className="text-lg font-semibold text-[var(--vf-color-text-primary)]">
        Access Denied
      </h2>
      <p className="max-w-sm text-sm text-[var(--vf-color-text-muted)]">
        This page requires admin privileges. Sign in with an admin account.
      </p>
    </div>
  );
}

/* ── Main dashboard ──────────────────────────────────── */

export function AdminDashboardV2() {
  const {
    tab,
    metrics,
    metricsStatus,
    metricsError,
    users,
    usersStatus,
    setTab,
    setMetrics,
    setMetricsStatus,
    setUsers,
    setUsersStatus,
  } = useAdminStore();

  /* ── admin guard (UI-only; server enforces auth via JWT on all /api/admin/* endpoints) ── */
  const currentEmail = firebaseAuth?.currentUser?.email ?? "";
  const isAdmin = Boolean(currentEmail && isAdminLoginEmail(currentEmail));

  /* ── data loaders ─────────────────────────────── */
  const loadMetrics = useCallback(async () => {
    setMetricsStatus("loading");
    try {
      const res = await adminApi.getMetrics();
      const data = (res as { data?: Record<string, unknown> })?.data ?? (res as Record<string, unknown>);
      setMetrics({
        mau: typeof data?.mau === "number" ? data.mau : null,
        queueDepth: typeof data?.queueDepth === "number" ? data.queueDepth : null,
        p95Ms: typeof data?.p95Ms === "number" ? data.p95Ms : null,
        mrrCents: typeof data?.mrrCents === "number" ? data.mrrCents : null,
      });
      setMetricsStatus("loaded");
    } catch (e) {
      const msg = e instanceof Error ? e.message.slice(0, 200) : "Failed to load metrics";
      setMetricsStatus("error", msg);
    }
  }, [setMetrics, setMetricsStatus]);

  const loadUsers = useCallback(async () => {
    setUsersStatus("loading");
    try {
      const res = await adminApi.getUsers();
      const rows = Array.isArray((res as { data?: unknown })?.data)
        ? ((res as { data: unknown[] }).data as Record<string, unknown>[])
        : Array.isArray(res)
        ? (res as Record<string, unknown>[])
        : [];
      const mapped: AdminUser[] = rows.map((r) => ({
        uid: String(r?.uid ?? r?.id ?? ""),
        email: String(r?.email ?? ""),
        displayName: r?.displayName != null ? String(r.displayName) : null,
        isPremium: Boolean(r?.isPremium ?? r?.is_premium),
        tokensRemaining:
          typeof r?.tokensRemaining === "number" ? r.tokensRemaining : null,
        createdAt: String(r?.createdAt ?? r?.created_at ?? ""),
      }));
      setUsers(mapped);
      setUsersStatus("loaded");
    } catch (e) {
      const msg = e instanceof Error ? e.message.slice(0, 200) : "Failed to load users";
      setUsersStatus("error", msg);
    }
  }, [setUsers, setUsersStatus]);

  useEffect(() => {
    if (!isAdmin) return;
    if (metricsStatus === "idle") void loadMetrics();
    if (usersStatus === "idle") void loadUsers();
  }, [isAdmin, metricsStatus, usersStatus, loadMetrics, loadUsers]);

  /* ── render ───────────────────────────────────── */
  if (!isAdmin) return <AccessDenied />;

  const metricsLoading = metricsStatus === "loading" || metricsStatus === "idle";

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[var(--vf-color-text-primary)]">
            Admin Console
          </h1>
          <p className="text-sm text-[var(--vf-color-text-muted)]">
            Voice-Flow control plane
          </p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          leftIcon={<RefreshCw className="h-4 w-4" />}
          onClick={() => {
            void loadMetrics();
            void loadUsers();
          }}
        >
          Refresh
        </Button>
      </div>

      {/* Metric tiles */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatTile
          label="Monthly Active Users"
          value={fmtNum(metrics.mau)}
          icon={<Users className="h-5 w-5" />}
          loading={metricsLoading}
        />
        <StatTile
          label="Queue Depth"
          value={fmtNum(metrics.queueDepth)}
          icon={<Layers className="h-5 w-5" />}
          loading={metricsLoading}
          accent="bg-amber-500/15 text-amber-400"
        />
        <StatTile
          label="p95 Latency"
          value={fmtMs(metrics.p95Ms)}
          icon={<Zap className="h-5 w-5" />}
          loading={metricsLoading}
          accent="bg-sky-500/15 text-sky-400"
        />
        <StatTile
          label="MRR"
          value={fmtMrr(metrics.mrrCents)}
          icon={<DollarSign className="h-5 w-5" />}
          loading={metricsLoading}
          accent="bg-emerald-500/15 text-emerald-400"
        />
      </div>

      {/* Error banner */}
      {metricsError && (
        <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-400">
          Metrics error: {metricsError}
        </div>
      )}

      {/* Tabs */}
      <TabBar active={tab} onChange={setTab} />

      {/* Tab panels */}
      {tab === "overview" && (
        <div className="space-y-4">
          <h2 className="text-base font-semibold text-[var(--vf-color-text-primary)]">
            System overview
          </h2>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Card elevation={1} className="space-y-1">
              <p className="text-xs text-[var(--vf-color-text-muted)]">Active users (7d)</p>
              {metricsLoading ? (
                <div className="h-4 w-20 animate-pulse rounded bg-white/10" />
              ) : (
                <p className="font-semibold text-[var(--vf-color-text-primary)]">
                  {fmtNum(metrics.mau)}
                </p>
              )}
            </Card>
            <Card elevation={1} className="space-y-1">
              <p className="text-xs text-[var(--vf-color-text-muted)]">Queue depth</p>
              {metricsLoading ? (
                <div className="h-4 w-20 animate-pulse rounded bg-white/10" />
              ) : (
                <p className="font-semibold text-[var(--vf-color-text-primary)]">
                  {fmtNum(metrics.queueDepth)} jobs
                </p>
              )}
            </Card>
          </div>
        </div>
      )}

      {tab === "users" && (
        <UsersTable users={users} loading={usersStatus === "loading" || usersStatus === "idle"} />
      )}

      {tab === "jobs" && <PlaceholderPanel label="Jobs queue" />}
      {tab === "flags" && <PlaceholderPanel label="Feature flags" />}
      {tab === "audit" && <PlaceholderPanel label="Audit log" />}
    </div>
  );
}
