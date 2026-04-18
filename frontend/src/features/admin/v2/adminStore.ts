import { create } from "zustand";

/* ── Types ────────────────────────────────────────────── */

export type AdminTab = "overview" | "users" | "jobs" | "flags" | "audit";

export type LoadStatus = "idle" | "loading" | "loaded" | "error";

export interface AdminMetrics {
  /** Monthly active users */
  mau: number | null;
  /** Current TTS jobs waiting in queue */
  queueDepth: number | null;
  /** 95th-percentile generation latency in ms */
  p95Ms: number | null;
  /** Monthly recurring revenue in USD cents */
  mrrCents: number | null;
}

export interface AdminUser {
  uid: string;
  email: string;
  displayName: string | null;
  isPremium: boolean;
  tokensRemaining: number | null;
  createdAt: string;
}

/* ── State + Actions ──────────────────────────────────── */

interface AdminState {
  tab: AdminTab;
  metrics: AdminMetrics;
  metricsStatus: LoadStatus;
  metricsError: string | null;
  users: AdminUser[];
  usersStatus: LoadStatus;
  usersError: string | null;
}

interface AdminActions {
  setTab: (tab: AdminTab) => void;
  setMetrics: (m: Partial<AdminMetrics>) => void;
  setMetricsStatus: (s: LoadStatus, err?: string | null) => void;
  setUsers: (users: AdminUser[]) => void;
  setUsersStatus: (s: LoadStatus, err?: string | null) => void;
  reset: () => void;
}

/* ── Defaults ─────────────────────────────────────────── */

const DEFAULT_METRICS: AdminMetrics = {
  mau: null,
  queueDepth: null,
  p95Ms: null,
  mrrCents: null,
};

const INITIAL_STATE: AdminState = {
  tab: "overview",
  metrics: DEFAULT_METRICS,
  metricsStatus: "idle",
  metricsError: null,
  users: [],
  usersStatus: "idle",
  usersError: null,
};

/* ── Store ─────────────────────────────────────────────── */

export const useAdminStore = create<AdminState & AdminActions>((set) => ({
  ...INITIAL_STATE,

  setTab: (tab) => set({ tab }),

  setMetrics: (m) =>
    set((s) => ({ metrics: { ...s.metrics, ...m } })),

  setMetricsStatus: (metricsStatus, err = null) =>
    set({ metricsStatus, metricsError: err ?? null }),

  setUsers: (users) => set({ users }),

  setUsersStatus: (usersStatus, err = null) =>
    set({ usersStatus, usersError: err ?? null }),

  reset: () => set(INITIAL_STATE),
}));

/* ── Selectors ────────────────────────────────────────── */

export const selectMetricsReady = (s: AdminState) =>
  s.metricsStatus === "loaded";

export const selectUsersReady = (s: AdminState) =>
  s.usersStatus === "loaded";
