'use client';

import dynamic from 'next/dynamic';
import { RefreshCw } from 'lucide-react';
import type { AppScreen } from '../../../types';
import { BrandLogo } from '../../../components/BrandLogo';
import { loadLegacyMainApp } from './workspaceMainAppLoader';

const LegacyMainApp = dynamic<{ setScreen: (screen: AppScreen) => void }>(
  loadLegacyMainApp,
  {
    loading: () => (
      <div
        className="min-h-[100dvh] overflow-hidden bg-[radial-gradient(82%_72%_at_12%_10%,rgba(34,211,238,0.16),transparent_58%),radial-gradient(74%_66%_at_88%_14%,rgba(99,102,241,0.18),transparent_60%),linear-gradient(165deg,#020617_0%,#081226_52%,#050913_100%)] px-4 py-6 text-slate-100"
        role="status"
        aria-live="polite"
      >
        <div className="mx-auto flex min-h-[100dvh] w-full max-w-5xl items-center justify-center">
          <div className="w-full max-w-xl rounded-[2rem] border border-white/10 bg-slate-950/68 p-6 shadow-[0_28px_70px_rgba(2,6,23,0.58)] backdrop-blur-xl sm:p-7">
            <div className="inline-flex rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-cyan-100">
              Workspace handoff
            </div>
            <div className="mt-5 flex items-start justify-between gap-4">
              <div>
                <BrandLogo size="lg" tone="light" />
                <h1 className="mt-5 text-2xl font-semibold tracking-tight text-white sm:text-3xl">
                  Loading Studio workspace
                </h1>
                <p className="mt-3 max-w-lg text-sm leading-7 text-slate-300 sm:text-base">
                  Pulling in the full production workspace only after your session handoff finishes.
                </p>
              </div>
              <span className="inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-cyan-400/25 bg-cyan-500/12 text-cyan-100">
                <RefreshCw size={18} className="animate-spin" />
              </span>
            </div>
          </div>
        </div>
      </div>
    ),
  },
);

export function WorkspaceMainApp({ setScreen }: { setScreen: (screen: AppScreen) => void }) {
  return <LegacyMainApp setScreen={setScreen} />;
}
