import React, { useEffect, useMemo, useState } from 'react';
import { Loader2, RefreshCw, Shield, Ticket, Users } from 'lucide-react';
import {
  AdminCoupon,
  AdminUserSummary,
  createAdminCoupon,
  deleteAdminUser,
  fetchAdminCoupons,
  fetchAdminUsers,
  patchAdminCoupon,
  patchAdminUser,
  resetAdminUserPassword,
  revokeAdminUserSessions,
} from '../services/adminService';

type ToastKind = 'success' | 'error' | 'info';

interface AdminPanelProps {
  mediaBackendUrl: string;
  onToast: (message: string, kind?: ToastKind) => void;
  onRefreshEntitlements: () => Promise<void>;
}

const planOptions = ['Free', 'Pro', 'Plus'] as const;

export const AdminPanel: React.FC<AdminPanelProps> = ({ mediaBackendUrl, onToast, onRefreshEntitlements }) => {
  const [users, setUsers] = useState<AdminUserSummary[]>([]);
  const [coupons, setCoupons] = useState<AdminCoupon[]>([]);
  const [search, setSearch] = useState('');
  const [isLoadingUsers, setIsLoadingUsers] = useState(false);
  const [isLoadingCoupons, setIsLoadingCoupons] = useState(false);
  const [isSaving, setIsSaving] = useState<string>('');
  const [newCouponCode, setNewCouponCode] = useState('');
  const [newCouponCredit, setNewCouponCredit] = useState('1000');
  const [newCouponMax, setNewCouponMax] = useState('100');
  const [newCouponExpiry, setNewCouponExpiry] = useState('');

  const sortedUsers = useMemo(
    () => [...users].sort((a, b) => (a.email || a.uid).localeCompare(b.email || b.uid)),
    [users]
  );

  const reloadUsers = async (query = search) => {
    setIsLoadingUsers(true);
    try {
      const rows = await fetchAdminUsers(mediaBackendUrl, { q: query, limit: 120 });
      setUsers(rows);
    } catch (error: any) {
      onToast(error?.message || 'Failed to load admin users.', 'error');
    } finally {
      setIsLoadingUsers(false);
    }
  };

  const reloadCoupons = async () => {
    setIsLoadingCoupons(true);
    try {
      const rows = await fetchAdminCoupons(mediaBackendUrl, 200);
      setCoupons(rows);
    } catch (error: any) {
      onToast(error?.message || 'Failed to load coupons.', 'error');
    } finally {
      setIsLoadingCoupons(false);
    }
  };

  useEffect(() => {
    void reloadUsers('');
    void reloadCoupons();
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
          expiresAt: newCouponExpiry || undefined,
          active: true,
        },
        mediaBackendUrl
      );
      setNewCouponCode('');
      onToast('Coupon created.', 'success');
      await reloadCoupons();
    });
  };

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
              void reloadUsers();
              void reloadCoupons();
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
                void reloadUsers(search);
              }}
              className="h-9 rounded-lg border border-indigo-200 bg-indigo-50 px-3 text-xs font-semibold text-indigo-700 hover:bg-indigo-100"
            >
              Search
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
                sortedUsers.map((row) => (
                  <tr key={row.uid} className="border-t border-gray-100 align-top">
                    <td className="px-2 py-2">
                      <div className="font-semibold text-gray-800">{row.email || row.uid}</div>
                      <div className="text-[11px] text-gray-500">{row.uid}</div>
                    </td>
                    <td className="px-2 py-2">
                      <select
                        className="h-8 rounded-md border border-gray-200 px-2 text-xs"
                        value={row.plan}
                        onChange={(event) => {
                          const nextPlan = event.target.value;
                          void withSaving(`plan_${row.uid}`, async () => {
                            await patchAdminUser(row.uid, { plan: nextPlan }, mediaBackendUrl);
                            onToast(`Plan updated to ${nextPlan}.`, 'success');
                            await reloadUsers(search);
                            await onRefreshEntitlements();
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
                      <div className="text-[11px] text-gray-700">Paid: {row.wallet.paidVfBalance.toLocaleString()}</div>
                      <div className="text-[11px] text-gray-700">VFF: {row.wallet.vffBalance.toLocaleString()}</div>
                      <div className="mt-1 flex items-center gap-1">
                        <button
                          className="rounded border border-emerald-200 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700"
                          onClick={() => {
                            void withSaving(`add_paid_${row.uid}`, async () => {
                              await patchAdminUser(row.uid, { paidVfDelta: 1000 }, mediaBackendUrl);
                              await reloadUsers(search);
                            });
                          }}
                        >
                          +1k paid
                        </button>
                        <button
                          className="rounded border border-indigo-200 px-1.5 py-0.5 text-[10px] font-semibold text-indigo-700"
                          onClick={() => {
                            void withSaving(`add_vff_${row.uid}`, async () => {
                              await patchAdminUser(row.uid, { vffDelta: 1000 }, mediaBackendUrl);
                              await reloadUsers(search);
                            });
                          }}
                        >
                          +1k vff
                        </button>
                      </div>
                    </td>
                    <td className="px-2 py-2">
                      <div className="text-[11px] text-gray-700">{row.disabled ? 'Locked' : 'Active'}</div>
                      <div className="text-[11px] text-gray-500">{row.admin ? 'Admin' : 'User'}</div>
                    </td>
                    <td className="px-2 py-2">
                      <div className="flex flex-wrap items-center gap-1">
                        <button
                          onClick={() => {
                            void withSaving(`toggle_lock_${row.uid}`, async () => {
                              await patchAdminUser(row.uid, { disabled: !row.disabled }, mediaBackendUrl);
                              await reloadUsers(search);
                            });
                          }}
                          className="rounded border border-gray-200 px-2 py-1 text-[10px] font-semibold text-gray-700"
                        >
                          {row.disabled ? 'Unlock' : 'Lock'}
                        </button>
                        <button
                          onClick={() => {
                            const password = window.prompt('Set new password (min 8 chars):');
                            if (!password) return;
                            void withSaving(`password_${row.uid}`, async () => {
                              await resetAdminUserPassword(row.uid, password, mediaBackendUrl);
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
                              await revokeAdminUserSessions(row.uid, mediaBackendUrl);
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
                              await deleteAdminUser(row.uid, mediaBackendUrl);
                              onToast('User deleted.', 'success');
                              await reloadUsers(search);
                            });
                          }}
                          className="rounded border border-red-200 px-2 py-1 text-[10px] font-semibold text-red-700"
                        >
                          Delete
                        </button>
                      </div>
                      {isSaving && isSaving.includes(row.uid) && (
                        <div className="mt-1 inline-flex items-center gap-1 text-[10px] text-indigo-600">
                          <Loader2 size={11} className="animate-spin" />
                          Saving
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
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
                            await patchAdminCoupon(coupon.id, { active: !coupon.active }, mediaBackendUrl);
                            await reloadCoupons();
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
