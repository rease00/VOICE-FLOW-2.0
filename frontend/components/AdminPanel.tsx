import React, { useEffect, useState } from 'react';
import { Loader2, RefreshCw, Shield, Ticket, Users, Key } from 'lucide-react';
import { useAdminCoupons } from '../src/features/admin/hooks/useAdminCoupons';
import { useAdminUsers } from '../src/features/admin/hooks/useAdminUsers';
import {
  AdminUserSummary,
  DailyUsageResetStatusPayload,
  DailyUsageResetSummary,
  fetchDailyUsageResetStatus,
  fetchGeminiPoolStatus,
  GeminiPoolStatusPayload,
  reloadGeminiPool,
  resetDailyUsageAll,
} from '../services/adminService';

type ToastKind = 'success' | 'error' | 'info';

interface AdminPanelProps {
  mediaBackendUrl: string;
  onToast: (message: string, kind?: ToastKind) => void;
  onRefreshEntitlements: () => Promise<void>;
}

const planOptions = ['Free', 'Pro', 'Plus'] as const;
type AdminUserPatch = Parameters<ReturnType<typeof useAdminUsers>['patchAdminUser']>[1];
type AdminUserDraft = Partial<Pick<AdminUserPatch, 'plan' | 'disabled' | 'paidVfDelta' | 'vffDelta'>>;

export const AdminPanel: React.FC<AdminPanelProps> = ({ mediaBackendUrl, onToast, onRefreshEntitlements }) => {
  const {
    sortedUsers,
    isLoadingUsers,
    reloadUsers,
    patchAdminUser,
    resetAdminUserPassword,
    revokeAdminUserSessions,
    deleteAdminUser,
  } = useAdminUsers({ baseUrl: mediaBackendUrl });
  const {
    coupons,
    isLoadingCoupons,
    reloadCoupons,
    createAdminCoupon,
    patchAdminCoupon,
  } = useAdminCoupons({ baseUrl: mediaBackendUrl });
  const [search, setSearch] = useState('');
  const [isSaving, setIsSaving] = useState<string>('');
  const [userDrafts, setUserDrafts] = useState<Record<string, AdminUserDraft>>({});
  const [newCouponCode, setNewCouponCode] = useState('');
  const [newCouponCredit, setNewCouponCredit] = useState('1000');
  const [newCouponMax, setNewCouponMax] = useState('100');
  const [newCouponExpiry, setNewCouponExpiry] = useState('');
  const [geminiPoolStatus, setGeminiPoolStatus] = useState<GeminiPoolStatusPayload | null>(null);
  const [isLoadingGeminiPool, setIsLoadingGeminiPool] = useState(false);
  const [isReloadingGeminiPool, setIsReloadingGeminiPool] = useState(false);
  const [dailyUsageResetStatus, setDailyUsageResetStatus] = useState<DailyUsageResetStatusPayload | null>(null);
  const [lastDailyDryRun, setLastDailyDryRun] = useState<DailyUsageResetSummary | null>(null);
  const [isLoadingDailyResetStatus, setIsLoadingDailyResetStatus] = useState(false);
  const [isDryRunningDailyReset, setIsDryRunningDailyReset] = useState(false);
  const [isExecutingDailyReset, setIsExecutingDailyReset] = useState(false);

  const reloadUsersSafely = async (query = search) => {
    try {
      await reloadUsers(query, 120);
    } catch (error: any) {
      onToast(error?.message || 'Failed to load admin users.', 'error');
    }
  };

  const reloadCouponsSafely = async () => {
    try {
      await reloadCoupons(200);
    } catch (error: any) {
      onToast(error?.message || 'Failed to load coupons.', 'error');
    }
  };

  const reloadGeminiPoolStatusSafely = async () => {
    setIsLoadingGeminiPool(true);
    try {
      const payload = await fetchGeminiPoolStatus(mediaBackendUrl);
      setGeminiPoolStatus(payload);
    } catch (error: any) {
      onToast(error?.message || 'Failed to load Gemini pool status.', 'error');
    } finally {
      setIsLoadingGeminiPool(false);
    }
  };

  const handleReloadGeminiPool = async () => {
    setIsReloadingGeminiPool(true);
    try {
      const payload = await reloadGeminiPool(mediaBackendUrl);
      setGeminiPoolStatus(payload);
      onToast(payload?.detail || 'Gemini key pool reloaded.', 'success');
    } catch (error: any) {
      onToast(error?.message || 'Failed to reload Gemini pool.', 'error');
    } finally {
      setIsReloadingGeminiPool(false);
    }
  };

  const reloadDailyUsageResetStatusSafely = async () => {
    setIsLoadingDailyResetStatus(true);
    try {
      const payload = await fetchDailyUsageResetStatus(mediaBackendUrl);
      setDailyUsageResetStatus(payload);
    } catch (error: any) {
      onToast(error?.message || 'Failed to load daily reset status.', 'error');
    } finally {
      setIsLoadingDailyResetStatus(false);
    }
  };

  const handleDryRunDailyReset = async () => {
    setIsDryRunningDailyReset(true);
    try {
      const summary = await resetDailyUsageAll(mediaBackendUrl, true);
      setLastDailyDryRun(summary);
      onToast(
        `Dry run: ${Number(summary.docsCleared || 0).toLocaleString()} docs, ${Number(summary.usersAffected || 0).toLocaleString()} users.`,
        'info'
      );
    } catch (error: any) {
      onToast(error?.message || 'Daily reset dry run failed.', 'error');
    } finally {
      setIsDryRunningDailyReset(false);
    }
  };

  const handleExecuteDailyReset = async () => {
    if (!window.confirm('Reset DAILY usage counters for ALL users now? This does not change monthly usage or wallet balances.')) {
      return;
    }
    setIsExecutingDailyReset(true);
    try {
      const summary = await resetDailyUsageAll(mediaBackendUrl, false);
      await reloadDailyUsageResetStatusSafely();
      await onRefreshEntitlements();
      onToast(
        `Daily usage reset complete: ${Number(summary.docsCleared || 0).toLocaleString()} docs, ${Number(summary.usersAffected || 0).toLocaleString()} users.`,
        'success'
      );
    } catch (error: any) {
      onToast(error?.message || 'Daily usage reset failed.', 'error');
    } finally {
      setIsExecutingDailyReset(false);
    }
  };

  useEffect(() => {
    void reloadUsersSafely('');
    void reloadCouponsSafely();
    void reloadGeminiPoolStatusSafely();
    void reloadDailyUsageResetStatusSafely();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mediaBackendUrl]);

  const withSaving = async (key: string, action: () => Promise<void>) => {
    setIsSaving(key);
    try {
      await action();
    } finally {
      setIsSaving('');
    }
  };

  const handleCreateCoupon = async () => {
    const code = newCouponCode.trim().toUpperCase();
    const creditVf = Math.max(1, Math.floor(Number(newCouponCredit) || 0));
    if (!code) {
      onToast('Coupon code is required.', 'info');
      return;
    }
    await withSaving('coupon_create', async () => {
      await createAdminCoupon(
        {
          code,
          creditVf,
          maxRedemptions: Math.max(0, Math.floor(Number(newCouponMax) || 0)),
          ...(newCouponExpiry ? { expiresAt: newCouponExpiry } : {}),
          active: true,
        }
      );
      setNewCouponCode('');
      onToast('Coupon created.', 'success');
      await reloadCouponsSafely();
    });
  };

  const setUserDraft = (uid: string, updater: (previous: AdminUserDraft) => AdminUserDraft) => {
    setUserDrafts((previous) => {
      const nextDraft = updater(previous[uid] || {});
      const normalized: AdminUserDraft = {};
      if (nextDraft.plan) normalized.plan = nextDraft.plan;
      if (typeof nextDraft.disabled === 'boolean') normalized.disabled = nextDraft.disabled;
      const paidDelta = Math.trunc(Number(nextDraft.paidVfDelta || 0));
      const vffDelta = Math.trunc(Number(nextDraft.vffDelta || 0));
      if (paidDelta !== 0) normalized.paidVfDelta = paidDelta;
      if (vffDelta !== 0) normalized.vffDelta = vffDelta;
      if (Object.keys(normalized).length === 0) {
        if (!previous[uid]) return previous;
        const next = { ...previous };
        delete next[uid];
        return next;
      }
      return { ...previous, [uid]: normalized };
    });
  };

  const getPendingUserPatch = (row: AdminUserSummary): AdminUserPatch | null => {
    const draft = userDrafts[row.uid];
    if (!draft) return null;
    const patch: AdminUserPatch = {};
    if (draft.plan && draft.plan !== row.plan) patch.plan = draft.plan;
    if (typeof draft.disabled === 'boolean' && draft.disabled !== row.disabled) patch.disabled = draft.disabled;
    const paidDelta = Math.trunc(Number(draft.paidVfDelta || 0));
    const vffDelta = Math.trunc(Number(draft.vffDelta || 0));
    if (paidDelta !== 0) patch.paidVfDelta = paidDelta;
    if (vffDelta !== 0) patch.vffDelta = vffDelta;
    return Object.keys(patch).length > 0 ? patch : null;
  };

  const dirtyUserUpdates = sortedUsers.reduce<Array<{ uid: string; patch: AdminUserPatch }>>((acc, row) => {
    const patch = getPendingUserPatch(row);
    if (patch) acc.push({ uid: row.uid, patch });
    return acc;
  }, []);

  const removeUserDrafts = (uids: string[]) => {
    setUserDrafts((previous) => {
      let changed = false;
      const next = { ...previous };
      for (const uid of uids) {
        if (uid in next) {
          delete next[uid];
          changed = true;
        }
      }
      return changed ? next : previous;
    });
  };

  const handleSaveUser = async (row: AdminUserSummary) => {
    const patch = getPendingUserPatch(row);
    if (!patch) {
      onToast('No changes to save for this user.', 'info');
      return;
    }
    try {
      await withSaving(`save_user_${row.uid}`, async () => {
        await patchAdminUser(row.uid, patch);
        removeUserDrafts([row.uid]);
        await reloadUsersSafely(search);
        await onRefreshEntitlements();
        onToast(`Saved ${row.email || row.uid}.`, 'success');
      });
    } catch (error: any) {
      onToast(error?.message || 'Failed to save user.', 'error');
    }
  };

  const handleSaveAllUsers = async () => {
    if (dirtyUserUpdates.length === 0) {
      onToast('No user changes to save.', 'info');
      return;
    }
    try {
      await withSaving('save_all_users', async () => {
        for (const update of dirtyUserUpdates) {
          await patchAdminUser(update.uid, update.patch);
        }
        removeUserDrafts(dirtyUserUpdates.map((update) => update.uid));
        await reloadUsersSafely(search);
        await onRefreshEntitlements();
        onToast(`Saved ${dirtyUserUpdates.length} user${dirtyUserUpdates.length === 1 ? '' : 's'}.`, 'success');
      });
    } catch (error: any) {
      onToast(error?.message || 'Failed to save all users.', 'error');
    }
  };

  const backendPool = geminiPoolStatus?.backend?.pool || {};
  const runtimePool = geminiPoolStatus?.runtime?.pool || {};
  const sourceDiag = geminiPoolStatus?.backend?.source || {};
  const lastRun = dailyUsageResetStatus?.lastRun;

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-indigo-100 bg-white p-4 shadow-sm">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-sm font-bold text-gray-800">
            <Shield size={16} className="text-indigo-600" />
            Admin Controls
          </div>
          <button
            onClick={() => {
              void reloadUsersSafely(search);
              void reloadCouponsSafely();
              void reloadGeminiPoolStatusSafely();
              void reloadDailyUsageResetStatusSafely();
            }}
            className="inline-flex items-center gap-1 rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50"
          >
            <RefreshCw size={13} />
            Refresh
          </button>
        </div>
        <p className="text-xs text-gray-500">
          Manage users, plans, balances, account locks, and coupon-based token credits.
        </p>
      </section>

      <section className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
        <div className="mb-3 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-sm font-bold text-gray-800">
            <RefreshCw size={16} className="text-indigo-600" />
            Daily Usage Reset
          </div>
          <div className="inline-flex items-center gap-2">
            <button
              onClick={() => {
                void handleDryRunDailyReset();
              }}
              disabled={isDryRunningDailyReset}
              className="inline-flex items-center gap-1 rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-60"
            >
              {isDryRunningDailyReset ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
              Dry Run
            </button>
            <button
              onClick={() => {
                void handleExecuteDailyReset();
              }}
              disabled={isExecutingDailyReset}
              className="inline-flex items-center gap-1 rounded-lg border border-red-200 bg-red-50 px-2.5 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-100 disabled:opacity-60"
            >
              {isExecutingDailyReset ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
              Reset All Daily Usage
            </button>
          </div>
        </div>
        <p className="mb-3 text-xs text-gray-500">
          Resets only daily usage counters for all users. Wallet balances and monthly usage remain unchanged.
        </p>
        {isLoadingDailyResetStatus && (
          <div className="text-xs text-gray-500 inline-flex items-center gap-2">
            <Loader2 size={13} className="animate-spin" />
            Loading reset status...
          </div>
        )}
        {!isLoadingDailyResetStatus && (
          <div className="grid gap-3 md:grid-cols-2">
            <div className="rounded-xl border border-gray-100 bg-gray-50 p-3 text-xs">
              <div className="mb-1 font-semibold text-gray-800">Last executed reset</div>
              {lastRun ? (
                <div className="space-y-1 text-gray-600">
                  <div>Docs cleared: <strong>{Number(lastRun.docsCleared || 0).toLocaleString()}</strong></div>
                  <div>Users affected: <strong>{Number(lastRun.usersAffected || 0).toLocaleString()}</strong></div>
                  <div>Day: <strong>{String(lastRun.periodKey || '-')}</strong></div>
                  <div>Ran at: <strong>{lastRun.ranAt ? new Date(lastRun.ranAt).toLocaleString() : '-'}</strong></div>
                </div>
              ) : (
                <div className="text-gray-500">Never run.</div>
              )}
            </div>
            <div className="rounded-xl border border-gray-100 bg-gray-50 p-3 text-xs">
              <div className="mb-1 font-semibold text-gray-800">Latest dry run</div>
              {lastDailyDryRun ? (
                <div className="space-y-1 text-gray-600">
                  <div>Docs matched: <strong>{Number(lastDailyDryRun.docsCleared || 0).toLocaleString()}</strong></div>
                  <div>Users matched: <strong>{Number(lastDailyDryRun.usersAffected || 0).toLocaleString()}</strong></div>
                  <div>Day: <strong>{String(lastDailyDryRun.periodKey || '-')}</strong></div>
                  <div>Generated at: <strong>{lastDailyDryRun.ranAt ? new Date(lastDailyDryRun.ranAt).toLocaleString() : '-'}</strong></div>
                </div>
              ) : (
                <div className="text-gray-500">No dry run yet.</div>
              )}
            </div>
          </div>
        )}
      </section>

      <section className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
        <div className="mb-3 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-sm font-bold text-gray-800">
            <Key size={16} className="text-indigo-600" />
            Gemini Pool
          </div>
          <button
            onClick={() => {
              void handleReloadGeminiPool();
            }}
            disabled={isReloadingGeminiPool}
            className="inline-flex items-center gap-1 rounded-lg border border-indigo-200 bg-indigo-50 px-2.5 py-1.5 text-xs font-semibold text-indigo-700 hover:bg-indigo-100 disabled:opacity-60"
          >
            {isReloadingGeminiPool ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
            Reload Pool
          </button>
        </div>
        {isLoadingGeminiPool && (
          <div className="text-xs text-gray-500 inline-flex items-center gap-2">
            <Loader2 size={13} className="animate-spin" />
            Loading Gemini pool status...
          </div>
        )}
        {!isLoadingGeminiPool && (
          <div className="grid gap-3 md:grid-cols-2">
            <div className="rounded-xl border border-gray-100 bg-gray-50 p-3 text-xs">
              <div className="mb-2 font-semibold text-gray-800">Backend allocator</div>
              <div className="space-y-1 text-gray-600">
                <div>Keys: <strong>{Number(backendPool.keyCount || 0)}</strong></div>
                <div>Healthy: <strong>{Number(backendPool.healthyKeys || 0)}</strong></div>
                <div>At limit: <strong>{Number(backendPool.atLimitKeys || 0)}</strong></div>
                <div>Unhealthy: <strong>{Number(backendPool.unhealthyKeys || 0)}</strong></div>
              </div>
            </div>
            <div className="rounded-xl border border-gray-100 bg-gray-50 p-3 text-xs">
              <div className="mb-2 font-semibold text-gray-800">Gemini runtime</div>
              <div className="space-y-1 text-gray-600">
                <div>Keys: <strong>{Number(runtimePool.keyCount || 0)}</strong></div>
                <div>Healthy: <strong>{Number(runtimePool.healthyKeys || 0)}</strong></div>
                <div>At limit: <strong>{Number(runtimePool.atLimitKeys || 0)}</strong></div>
                <div>Unhealthy: <strong>{Number(runtimePool.unhealthyKeys || 0)}</strong></div>
              </div>
            </div>
            <div className="rounded-xl border border-gray-100 bg-gray-50 p-3 text-xs md:col-span-2">
              <div className="mb-2 font-semibold text-gray-800">Key sources</div>
              <div className="grid gap-1 text-gray-600 md:grid-cols-3">
                <div>File exists: <strong>{sourceDiag.fileExists ? 'Yes' : 'No'}</strong></div>
                <div>File keys: <strong>{Number(sourceDiag.fileKeyCount || 0)}</strong></div>
                <div>Env pool keys: <strong>{Number(sourceDiag.envPoolKeyCount || 0)}</strong></div>
              </div>
              <div className="mt-1 truncate text-gray-500">Configured path: {String(sourceDiag.configuredFilePath || '-')}</div>
              <div className="mt-1 truncate text-gray-500">Resolved path: {String(sourceDiag.filePath || '-')}</div>
              <div className="mt-1 truncate text-gray-500">Runtime resolved path: {String(geminiPoolStatus?.runtime?.keyFilePath || '-')}</div>
            </div>
          </div>
        )}
      </section>

      <section className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
        <div className="mb-3 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-sm font-bold text-gray-800">
            <Users size={16} className="text-indigo-600" />
            Users
          </div>
          <div className="flex items-center gap-2">
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search email or uid"
              className="h-9 w-56 rounded-lg border border-gray-200 px-2.5 text-xs outline-none focus:border-indigo-300"
            />
            <button
              onClick={() => {
                void reloadUsersSafely(search);
              }}
              className="h-9 rounded-lg border border-indigo-200 bg-indigo-50 px-3 text-xs font-semibold text-indigo-700 hover:bg-indigo-100"
            >
              Search
            </button>
            <button
              onClick={() => {
                void handleSaveAllUsers();
              }}
              disabled={dirtyUserUpdates.length === 0 || Boolean(isSaving)}
              className="h-9 rounded-lg border border-emerald-200 bg-emerald-50 px-3 text-xs font-semibold text-emerald-700 hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isSaving === 'save_all_users' ? 'Saving...' : `Save all${dirtyUserUpdates.length ? ` (${dirtyUserUpdates.length})` : ''}`}
            </button>
          </div>
        </div>
        <div className="max-h-[28rem] overflow-auto rounded-xl border border-gray-100">
          <table className="min-w-full text-xs">
            <thead className="sticky top-0 bg-gray-50 text-gray-600">
              <tr>
                <th className="px-2 py-2 text-left">User</th>
                <th className="px-2 py-2 text-left">Plan</th>
                <th className="px-2 py-2 text-left">Wallet</th>
                <th className="px-2 py-2 text-left">Status</th>
                <th className="px-2 py-2 text-left">Actions</th>
              </tr>
            </thead>
            <tbody>
              {isLoadingUsers && (
                <tr>
                  <td className="px-2 py-4 text-center text-gray-500" colSpan={5}>
                    <span className="inline-flex items-center gap-2">
                      <Loader2 size={14} className="animate-spin" />
                      Loading users
                    </span>
                  </td>
                </tr>
              )}
              {!isLoadingUsers && sortedUsers.length === 0 && (
                <tr>
                  <td className="px-2 py-4 text-center text-gray-500" colSpan={5}>
                    No users found.
                  </td>
                </tr>
              )}
              {!isLoadingUsers &&
                sortedUsers.map((row) => {
                  const rowDraft = userDrafts[row.uid] || {};
                  const pendingPatch = getPendingUserPatch(row);
                  const isRowDirty = Boolean(pendingPatch);
                  const effectivePlan = rowDraft.plan || row.plan;
                  const effectiveDisabled = typeof rowDraft.disabled === 'boolean' ? rowDraft.disabled : row.disabled;
                  const paidDelta = Math.trunc(Number(rowDraft.paidVfDelta || 0));
                  const vffDelta = Math.trunc(Number(rowDraft.vffDelta || 0));
                  const effectivePaidBalance = row.wallet.paidVfBalance + paidDelta;
                  const effectiveVffBalance = row.wallet.vffBalance + vffDelta;
                  const isActiveUser = !effectiveDisabled;
                  const statusBadgeTone = isActiveUser
                    ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                    : 'border-red-200 bg-red-50 text-red-700';
                  const statusDotTone = isActiveUser ? 'bg-emerald-500' : 'bg-red-500';
                  const statusBarTone = isActiveUser ? 'border-emerald-300 bg-emerald-400/80' : 'border-red-300 bg-red-400/80';
                  const isRowSaving = isSaving.includes(row.uid) || (isSaving === 'save_all_users' && isRowDirty);
                  return (
                    <tr key={row.uid} className="border-t border-gray-100 align-top">
                      <td className="px-2 py-2">
                        <div className="font-semibold text-gray-800">Email: {row.email || '-'}</div>
                        <div className="text-[11px] text-gray-500">UID: {row.uid}</div>
                      </td>
                      <td className="px-2 py-2">
                        <select
                          className="h-8 rounded-md border border-gray-200 px-2 text-xs"
                          value={effectivePlan}
                          onChange={(event) => {
                            const nextPlan = event.target.value;
                            setUserDraft(row.uid, (previous) => {
                              const { plan, ...rest } = previous;
                              return nextPlan === row.plan ? rest : { ...rest, plan: nextPlan };
                            });
                          }}
                        >
                          {planOptions.map((plan) => (
                            <option key={plan} value={plan}>
                              {plan}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="px-2 py-2">
                        <div className="text-[11px] text-gray-700">Paid VF: {effectivePaidBalance.toLocaleString()}</div>
                        <div className="text-[11px] text-gray-700">Free VFF: {effectiveVffBalance.toLocaleString()}</div>
                        <div className="mt-1 flex items-center gap-1">
                          <button
                            className="rounded border border-emerald-200 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700"
                            onClick={() => {
                              setUserDraft(row.uid, (previous) => ({
                                ...previous,
                                paidVfDelta: Number(previous.paidVfDelta || 0) + 1000,
                              }));
                            }}
                          >
                            +1k paid
                          </button>
                          <button
                            className="rounded border border-indigo-200 px-1.5 py-0.5 text-[10px] font-semibold text-indigo-700"
                            onClick={() => {
                              setUserDraft(row.uid, (previous) => ({
                                ...previous,
                                vffDelta: Number(previous.vffDelta || 0) + 1000,
                              }));
                            }}
                          >
                            +1k VFF
                          </button>
                        </div>
                        {(paidDelta !== 0 || vffDelta !== 0) && (
                          <div className="mt-1 text-[10px] text-amber-700">
                            Pending: {paidDelta !== 0 ? `${paidDelta > 0 ? '+' : ''}${paidDelta.toLocaleString()} paid` : ''}
                            {paidDelta !== 0 && vffDelta !== 0 ? ', ' : ''}
                            {vffDelta !== 0 ? `${vffDelta > 0 ? '+' : ''}${vffDelta.toLocaleString()} VFF` : ''}
                          </div>
                        )}
                      </td>
                      <td className="px-2 py-2">
                        <div className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${statusBadgeTone}`}>
                          <span className={`h-1.5 w-1.5 rounded-full ${statusDotTone}`} />
                          {isActiveUser ? 'Active' : 'Inactive'}
                        </div>
                        <div className={`mt-1 h-1.5 w-16 rounded-full border ${statusBarTone}`} />
                        <div className="mt-1 text-[11px] text-gray-500">{row.admin ? 'Admin' : 'User'}</div>
                      </td>
                      <td className="px-2 py-2">
                        <div className="flex flex-wrap items-center gap-1">
                          <button
                            onClick={() => {
                              const nextDisabled = !effectiveDisabled;
                              setUserDraft(row.uid, (previous) => {
                                const { disabled, ...rest } = previous;
                                return nextDisabled === row.disabled ? rest : { ...rest, disabled: nextDisabled };
                              });
                            }}
                            className="rounded border border-gray-200 px-2 py-1 text-[10px] font-semibold text-gray-700"
                          >
                            {effectiveDisabled ? 'Unlock' : 'Lock'}
                          </button>
                          <button
                            onClick={() => {
                              void handleSaveUser(row);
                            }}
                            disabled={!isRowDirty || Boolean(isSaving)}
                            className="rounded border border-emerald-200 px-2 py-1 text-[10px] font-semibold text-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            Save
                          </button>
                          <button
                            onClick={() => {
                              const password = window.prompt('Set new password (min 8 chars):');
                              if (!password) return;
                              void withSaving(`password_${row.uid}`, async () => {
                                await resetAdminUserPassword(row.uid, password);
                                onToast('Password reset.', 'success');
                              });
                            }}
                            className="rounded border border-blue-200 px-2 py-1 text-[10px] font-semibold text-blue-700"
                          >
                            Reset pass
                          </button>
                          <button
                            onClick={() => {
                              void withSaving(`revoke_${row.uid}`, async () => {
                                await revokeAdminUserSessions(row.uid);
                                onToast('Sessions revoked.', 'success');
                              });
                            }}
                            className="rounded border border-amber-200 px-2 py-1 text-[10px] font-semibold text-amber-700"
                          >
                            Revoke
                          </button>
                          <button
                            onClick={() => {
                              if (!window.confirm(`Delete ${row.email || row.uid}? This cannot be undone.`)) return;
                              void withSaving(`delete_${row.uid}`, async () => {
                                await deleteAdminUser(row.uid);
                                onToast('User deleted.', 'success');
                                removeUserDrafts([row.uid]);
                                await reloadUsersSafely(search);
                              });
                            }}
                            className="rounded border border-red-200 px-2 py-1 text-[10px] font-semibold text-red-700"
                          >
                            Delete
                          </button>
                        </div>
                        {isRowSaving && (
                          <div className="mt-1 inline-flex items-center gap-1 text-[10px] text-indigo-600">
                            <Loader2 size={11} className="animate-spin" />
                            Saving
                          </div>
                        )}
                        {!isRowSaving && isRowDirty && (
                          <div className="mt-1 text-[10px] text-amber-700">
                            Unsaved changes
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
        <div className="mb-3 flex items-center gap-2 text-sm font-bold text-gray-800">
          <Ticket size={16} className="text-indigo-600" />
          Coupons
        </div>
        <div className="grid gap-2 md:grid-cols-5">
          <input
            value={newCouponCode}
            onChange={(event) => setNewCouponCode(event.target.value)}
            placeholder="Code"
            className="h-9 rounded-lg border border-gray-200 px-2.5 text-xs outline-none focus:border-indigo-300"
          />
          <input
            value={newCouponCredit}
            onChange={(event) => setNewCouponCredit(event.target.value)}
            placeholder="Credit VF"
            className="h-9 rounded-lg border border-gray-200 px-2.5 text-xs outline-none focus:border-indigo-300"
          />
          <input
            value={newCouponMax}
            onChange={(event) => setNewCouponMax(event.target.value)}
            placeholder="Max redeem"
            className="h-9 rounded-lg border border-gray-200 px-2.5 text-xs outline-none focus:border-indigo-300"
          />
          <input
            value={newCouponExpiry}
            onChange={(event) => setNewCouponExpiry(event.target.value)}
            placeholder="Expiry ISO (optional)"
            className="h-9 rounded-lg border border-gray-200 px-2.5 text-xs outline-none focus:border-indigo-300"
          />
          <button
            onClick={() => {
              void handleCreateCoupon();
            }}
            className="h-9 rounded-lg border border-indigo-200 bg-indigo-50 text-xs font-semibold text-indigo-700 hover:bg-indigo-100"
          >
            Create
          </button>
        </div>

        <div className="mt-3 max-h-72 overflow-auto rounded-xl border border-gray-100">
          <table className="min-w-full text-xs">
            <thead className="sticky top-0 bg-gray-50 text-gray-600">
              <tr>
                <th className="px-2 py-2 text-left">Code</th>
                <th className="px-2 py-2 text-left">Credit</th>
                <th className="px-2 py-2 text-left">Usage</th>
                <th className="px-2 py-2 text-left">Expiry</th>
                <th className="px-2 py-2 text-left">State</th>
              </tr>
            </thead>
            <tbody>
              {isLoadingCoupons && (
                <tr>
                  <td className="px-2 py-3 text-center text-gray-500" colSpan={5}>
                    <span className="inline-flex items-center gap-2">
                      <Loader2 size={14} className="animate-spin" />
                      Loading coupons
                    </span>
                  </td>
                </tr>
              )}
              {!isLoadingCoupons &&
                coupons.map((coupon) => (
                  <tr key={coupon.id} className="border-t border-gray-100">
                    <td className="px-2 py-2 font-semibold text-gray-800">{coupon.code}</td>
                    <td className="px-2 py-2">{Number(coupon.creditVf || 0).toLocaleString()} VF</td>
                    <td className="px-2 py-2">
                      {coupon.redeemedCount || 0}
                      {coupon.maxRedemptions ? ` / ${coupon.maxRedemptions}` : ''}
                    </td>
                    <td className="px-2 py-2">{coupon.expiresAt ? new Date(coupon.expiresAt).toLocaleString() : 'No expiry'}</td>
                    <td className="px-2 py-2">
                      <button
                        onClick={() => {
                          void withSaving(`coupon_toggle_${coupon.id}`, async () => {
                            await patchAdminCoupon(coupon.id, { active: !coupon.active });
                            await reloadCouponsSafely();
                          });
                        }}
                        className={`rounded border px-2 py-1 text-[10px] font-semibold ${
                          coupon.active
                            ? 'border-emerald-200 text-emerald-700'
                            : 'border-gray-200 text-gray-600'
                        }`}
                      >
                        {coupon.active ? 'Active' : 'Inactive'}
                      </button>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
};
