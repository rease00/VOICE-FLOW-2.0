'use client';

import React, { useState, useCallback, useEffect } from 'react';
import {
  Wallet,
  ArrowDownToLine,
  ArrowUpFromLine,
  BookOpen,
  Mic,
  Zap,
  ChevronRight,
  RefreshCw,
} from 'lucide-react';
import type {
  TokenType,
  VnTransaction,
  WithdrawalRequest,
} from '../../../types';
import { fetchVnTransactions, fetchVnBalance } from '../../../services/vnTokenService';

/* ────────────────────────────── Types ────────────────────────────── */

export type WalletTab = 'vf' | 'vc' | 'vn';

export interface WalletBalances {
  vfSpendable: number;
  vfFreeRemaining: number;
  vfPaid: number;
  vcSpendable: number;
  vnBalance: number;
}

export interface WalletViewProps {
  balances: WalletBalances;
  isAuthor?: boolean;
  onBuyTokens?: (tab: 'token' | 'vc' | 'vn') => void;
  onWithdraw?: () => void;
  onRefresh?: () => void;
}

/* ────────────────────────────── Helpers ──────────────────────────── */

function fmt(n: number): string {
  return new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(
    Math.max(0, n),
  );
}

const TAB_META: Record<WalletTab, { label: string; icon: React.ReactNode; color: string }> = {
  vf: { label: 'Voice Flow', icon: <Zap className="h-4 w-4" />, color: 'text-amber-400' },
  vc: { label: 'Voice Credits', icon: <Mic className="h-4 w-4" />, color: 'text-purple-400' },
  vn: { label: 'Novel Tokens', icon: <BookOpen className="h-4 w-4" />, color: 'text-emerald-400' },
};

const TXN_TYPE_LABELS: Record<string, string> = {
  vn_purchase: 'Purchased VN',
  chapter_unlock: 'Chapter unlock',
  full_novel_unlock: 'Novel unlock',
  author_earning: 'Author earning',
  withdrawal: 'Withdrawal',
  refund: 'Refund',
  daily_free_unlock: 'Daily free unlock',
};

/* ────────────────────────────── Component ────────────────────────── */

export default function WalletView({
  balances,
  isAuthor = false,
  onBuyTokens,
  onWithdraw,
  onRefresh,
}: WalletViewProps) {
  const [activeTab, setActiveTab] = useState<WalletTab>('vf');
  const [transactions, setTransactions] = useState<VnTransaction[]>([]);
  const [loadingTxns, setLoadingTxns] = useState(false);

  /* ── Fetch VN transactions when VN tab is active ── */
  useEffect(() => {
    if (activeTab !== 'vn') return;
    let cancelled = false;
    setLoadingTxns(true);
    fetchVnTransactions(20)
      .then((txns) => {
        if (!cancelled) setTransactions(txns);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoadingTxns(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activeTab]);

  const handleBuy = useCallback(() => {
    const mapping: Record<WalletTab, 'token' | 'vc' | 'vn'> = {
      vf: 'token',
      vc: 'vc',
      vn: 'vn',
    };
    onBuyTokens?.(mapping[activeTab]);
  }, [activeTab, onBuyTokens]);

  /* ────────────── Render ────────────── */
  return (
    <div className="flex min-h-0 flex-col rounded-2xl border border-slate-700/60 bg-slate-900/80 backdrop-blur-md">
      {/* ── Header ── */}
      <div className="flex items-center justify-between border-b border-slate-700/50 px-4 py-3 sm:px-6">
        <div className="flex items-center gap-2">
          <Wallet className="h-5 w-5 text-slate-300" />
          <h2 className="text-base font-semibold text-slate-100 sm:text-lg">Wallet</h2>
        </div>
        {onRefresh && (
          <button
            onClick={onRefresh}
            className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-700/50 hover:text-slate-200"
            aria-label="Refresh balances"
          >
            <RefreshCw className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* ── Tab bar ── */}
      <div className="flex border-b border-slate-700/40">
        {(Object.keys(TAB_META) as WalletTab[]).map((tab) => {
          const meta = TAB_META[tab];
          const isActive = tab === activeTab;
          return (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`flex flex-1 items-center justify-center gap-1.5 px-2 py-2.5 text-xs font-medium transition sm:text-sm ${
                isActive
                  ? `border-b-2 ${meta.color} border-current bg-slate-800/40`
                  : 'text-slate-400 hover:bg-slate-800/30 hover:text-slate-300'
              }`}
            >
              {meta.icon}
              <span className="hidden sm:inline">{meta.label}</span>
              <span className="sm:hidden">{tab.toUpperCase()}</span>
            </button>
          );
        })}
      </div>

      {/* ── Balance cards ── */}
      <div className="p-4 sm:p-6">
        {activeTab === 'vf' && (
          <BalanceGrid
            items={[
              { label: 'Spendable', value: fmt(balances.vfSpendable), unit: 'VF' },
              { label: 'Free remaining', value: fmt(balances.vfFreeRemaining), unit: 'VF' },
              { label: 'Paid credits', value: fmt(balances.vfPaid), unit: 'VF' },
            ]}
          />
        )}
        {activeTab === 'vc' && (
          <BalanceGrid
            items={[
              { label: 'Spendable', value: fmt(balances.vcSpendable), unit: 'VC' },
            ]}
          />
        )}
        {activeTab === 'vn' && (
          <BalanceGrid
            items={[
              { label: 'Balance', value: fmt(balances.vnBalance), unit: 'VN' },
            ]}
          />
        )}

        {/* ── Action buttons ── */}
        <div className="mt-4 flex flex-col gap-2 sm:flex-row">
          <button
            onClick={handleBuy}
            className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-indigo-500"
          >
            <ArrowDownToLine className="h-4 w-4" />
            Buy {activeTab.toUpperCase()} Tokens
          </button>
          {isAuthor && activeTab === 'vn' && onWithdraw && (
            <button
              onClick={onWithdraw}
              className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-slate-600 bg-slate-800/60 px-4 py-2.5 text-sm font-semibold text-slate-200 transition hover:bg-slate-700/70"
            >
              <ArrowUpFromLine className="h-4 w-4" />
              Withdraw VN
            </button>
          )}
        </div>
      </div>

      {/* ── Transaction history (VN tab only) ── */}
      {activeTab === 'vn' && (
        <div className="border-t border-slate-700/40 px-4 pb-4 pt-3 sm:px-6">
          <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-slate-400">
            Recent Transactions
          </h3>
          {loadingTxns ? (
            <p className="py-4 text-center text-xs text-slate-500">Loading...</p>
          ) : transactions.length === 0 ? (
            <p className="py-4 text-center text-xs text-slate-500">No transactions yet</p>
          ) : (
            <ul className="space-y-1.5">
              {transactions.map((tx) => (
                <TransactionRow key={tx.id} tx={tx} />
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

/* ────────────────────────────── Sub-components ───────────────────── */

function BalanceGrid({ items }: { items: { label: string; value: string; unit: string }[] }) {
  return (
    <div
      className={`grid gap-3 ${
        items.length === 1 ? 'grid-cols-1' : 'grid-cols-2 sm:grid-cols-3'
      }`}
    >
      {items.map((item) => (
        <div
          key={item.label}
          className="rounded-xl border border-slate-700/50 bg-slate-800/50 px-3 py-2.5"
        >
          <div className="text-[11px] text-slate-400">{item.label}</div>
          <div className="mt-0.5 text-lg font-bold text-slate-100 sm:text-xl">
            {item.value}{' '}
            <span className="text-xs font-normal text-slate-400">{item.unit}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

function TransactionRow({ tx }: { tx: VnTransaction }) {
  const isCredit = tx.amount > 0;
  return (
    <li className="flex items-center justify-between rounded-lg bg-slate-800/40 px-3 py-2 text-xs">
      <div className="flex items-center gap-2">
        <span
          className={`flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-semibold ${
            isCredit ? 'bg-emerald-900/50 text-emerald-400' : 'bg-red-900/50 text-red-400'
          }`}
        >
          {isCredit ? '+' : '−'}
        </span>
        <span className="text-slate-300">{TXN_TYPE_LABELS[tx.type] ?? tx.type}</span>
      </div>
      <span className={`font-semibold ${isCredit ? 'text-emerald-400' : 'text-red-400'}`}>
        {isCredit ? '+' : ''}
        {fmt(tx.amount)} VN
      </span>
    </li>
  );
}

/* ────────── Compact wallet badge for header/nav ────────── */

export function WalletBadge({
  vfBalance,
  vnBalance,
  onClick,
}: {
  vfBalance: number;
  vnBalance: number;
  onClick?: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-1.5 rounded-full border border-slate-700/60 bg-slate-800/70 px-3 py-1 text-xs text-slate-300 transition hover:bg-slate-700/70"
      aria-label="Open wallet"
    >
      <Wallet className="h-3.5 w-3.5 text-slate-400" />
      <span className="font-medium text-amber-400">{fmt(vfBalance)}</span>
      <span className="text-slate-500">|</span>
      <span className="font-medium text-emerald-400">{fmt(vnBalance)}</span>
      <ChevronRight className="h-3 w-3 text-slate-500" />
    </button>
  );
}
