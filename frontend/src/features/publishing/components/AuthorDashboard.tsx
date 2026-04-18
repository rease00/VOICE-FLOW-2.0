'use client';

import React, { useEffect, useState, useCallback } from 'react';
import {
  BookOpen,
  TrendingUp,
  ArrowUpFromLine,
  Eye,
  Star,
  RefreshCw,
} from 'lucide-react';
import type { WithdrawalRequest, VnTransaction } from '../../../../types';
import { fetchVnTransactions, fetchVnBalance } from '../../../../services/vnTokenService';

/* ─── Types ─── */

interface BookStat {
  bookId: string;
  title: string;
  totalReads: number;
  totalEarnings: number;
  avgRating: number;
  ratingCount: number;
}

interface AuthorDashboardProps {
  userId: string;
  books: BookStat[];
  withdrawals: WithdrawalRequest[];
  onWithdraw?: () => void;
  onEditBook?: (bookId: string) => void;
  onRefresh?: () => void;
}

/* ─── Helpers ─── */

function fmt(n: number): string {
  return new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(Math.max(0, n));
}

/* ─── Component ─── */

export default function AuthorDashboard({
  userId,
  books,
  withdrawals,
  onWithdraw,
  onEditBook,
  onRefresh,
}: AuthorDashboardProps) {
  const [vnBalance, setVnBalance] = useState(0);
  const [recentTxns, setRecentTxns] = useState<VnTransaction[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([fetchVnBalance(), fetchVnTransactions(10)])
      .then(([bal, txns]) => {
        if (!cancelled) {
          setVnBalance(bal);
          setRecentTxns(txns);
        }
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const totalEarnings = books.reduce((s, b) => s + b.totalEarnings, 0);
  const totalReads = books.reduce((s, b) => s + b.totalReads, 0);
  const avgRating =
    books.length > 0
      ? books.reduce((s, b) => s + b.avgRating * b.ratingCount, 0) /
        Math.max(1, books.reduce((s, b) => s + b.ratingCount, 0))
      : 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-bold text-slate-100 sm:text-xl">Author Dashboard</h1>
        {onRefresh && (
          <button
            onClick={onRefresh}
            className="rounded-lg p-2 text-slate-400 transition hover:bg-slate-700/50 hover:text-slate-200"
            aria-label="Refresh"
          >
            <RefreshCw className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard icon={<BookOpen className="h-5 w-5 text-indigo-400" />} label="Total Reads" value={fmt(totalReads)} />
        <StatCard icon={<TrendingUp className="h-5 w-5 text-emerald-400" />} label="Earnings" value={`${fmt(totalEarnings)} VN`} />
        <StatCard icon={<Star className="h-5 w-5 text-amber-400" />} label="Avg Rating" value={avgRating.toFixed(1)} />
        <StatCard icon={<ArrowUpFromLine className="h-5 w-5 text-purple-400" />} label="VN Balance" value={fmt(vnBalance)} />
      </div>

      {/* Withdraw CTA */}
      {onWithdraw && (
        <button
          onClick={onWithdraw}
          className="w-full rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-indigo-500 sm:w-auto"
        >
          Request Withdrawal
        </button>
      )}

      {/* Books table */}
      <div className="rounded-2xl border border-slate-700/60 bg-slate-900/80">
        <div className="border-b border-slate-700/50 px-4 py-3">
          <h2 className="text-sm font-semibold text-slate-200">Your Books</h2>
        </div>
        {books.length === 0 ? (
          <p className="px-4 py-6 text-center text-xs text-slate-500">No published books yet</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-slate-800/50 text-left text-slate-400">
                  <th className="px-4 py-2 font-medium">Title</th>
                  <th className="px-4 py-2 font-medium">Reads</th>
                  <th className="px-4 py-2 font-medium">Earnings</th>
                  <th className="px-4 py-2 font-medium">Rating</th>
                  <th className="px-4 py-2 font-medium" />
                </tr>
              </thead>
              <tbody>
                {books.map((b) => (
                  <tr key={b.bookId} className="border-b border-slate-800/30 text-slate-300">
                    <td className="max-w-[140px] truncate px-4 py-2 font-medium sm:max-w-none">{b.title}</td>
                    <td className="px-4 py-2">{fmt(b.totalReads)}</td>
                    <td className="px-4 py-2">{fmt(b.totalEarnings)} VN</td>
                    <td className="px-4 py-2">{b.avgRating.toFixed(1)} ({b.ratingCount})</td>
                    <td className="px-4 py-2">
                      {onEditBook && (
                        <button
                          onClick={() => onEditBook(b.bookId)}
                          className="text-indigo-400 transition hover:text-indigo-300"
                        >
                          Edit
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Withdrawal history */}
      <div className="rounded-2xl border border-slate-700/60 bg-slate-900/80">
        <div className="border-b border-slate-700/50 px-4 py-3">
          <h2 className="text-sm font-semibold text-slate-200">Withdrawal History</h2>
        </div>
        {withdrawals.length === 0 ? (
          <p className="px-4 py-6 text-center text-xs text-slate-500">No withdrawals yet</p>
        ) : (
          <ul className="divide-y divide-slate-800/30">
            {withdrawals.map((w) => (
              <li key={w.id} className="flex items-center justify-between px-4 py-3">
                <div>
                  <p className="text-xs font-medium text-slate-200">
                    {fmt(w.vnAmount)} VN → ₹{fmt(w.netAmount)}
                  </p>
                  <p className="text-[10px] text-slate-500">
                    Fee: ₹{fmt(w.platformFee)} | {new Date(w.createdAt).toLocaleDateString('en-IN')}
                  </p>
                </div>
                <StatusBadge status={w.status} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/* ─── Sub-components ─── */

function StatCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-xl border border-slate-700/50 bg-slate-800/50 px-3 py-3 sm:px-4">
      <div className="flex items-center gap-2">
        {icon}
        <span className="text-[11px] text-slate-400">{label}</span>
      </div>
      <p className="mt-1 text-lg font-bold text-slate-100">{value}</p>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    pending: 'bg-yellow-900/40 text-yellow-400',
    processing: 'bg-blue-900/40 text-blue-400',
    completed: 'bg-emerald-900/40 text-emerald-400',
    failed: 'bg-red-900/40 text-red-400',
  };
  return (
    <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${styles[status] ?? 'bg-slate-800 text-slate-400'}`}>
      {status}
    </span>
  );
}
