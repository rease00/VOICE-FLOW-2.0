'use client';

import { useSearchParams } from 'next/navigation';
import { ArrowRight, Lock, Sparkles } from 'lucide-react';
import { BrandLogo } from '../../../components/BrandLogo';
import { APP_ROUTE_PATHS, resolveLoginPath } from '../../app/navigation';
import {
  SIGNUP_DISABLED_MARKETING_DETAIL,
  SIGNUP_DISABLED_MARKETING_HEADLINE,
} from '../../shared/auth/signupLock';
import { BILLING_PLAN_ROWS, BILLING_TOKEN_PACK_ROWS, BILLING_VC_PACK_ROWS } from './catalog';
import { LegalLinks } from '../legal/LegalLinks';

const formatInr = (amount: number): string =>
  new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(Math.max(0, Number(amount || 0)));

const loginHref = resolveLoginPath('login', APP_ROUTE_PATHS.studio);
const billingWorkspaceHref = resolveLoginPath('login', APP_ROUTE_PATHS.billing);

export function PublicBillingPage() {
  const searchParams = useSearchParams();
  const planPreview = BILLING_PLAN_ROWS.slice(0, 3);
  const creditPreview = BILLING_TOKEN_PACK_ROWS.slice(0, 2);
  const clonePreview = BILLING_VC_PACK_ROWS.slice(0, 2);
  const billingState = searchParams?.get('billing');
  const hasCheckoutReturn = billingState === 'success' || billingState === 'cancel';

  return (
    <div
      className="vf-billing-shell relative min-h-screen overflow-x-hidden bg-[radial-gradient(84%_74%_at_8%_8%,rgba(71,214,202,0.18),transparent_58%),radial-gradient(78%_70%_at_92%_12%,rgba(47,128,237,0.16),transparent_60%),linear-gradient(165deg,#041321_0%,#071b31_46%,#0b1730_72%,#17161f_100%)] text-slate-100"
      data-billing-mode="public"
      data-billing-state="coming-soon"
      data-vf-brand-theme="aurora"
    >
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(rgba(148,163,184,0.05)_1px,transparent_1px),linear-gradient(90deg,rgba(148,163,184,0.05)_1px,transparent_1px)] bg-[size:22px_22px] opacity-30" />

      <div className="relative z-10 mx-auto flex min-h-screen w-full max-w-6xl flex-col px-4 pb-16 pt-6 sm:px-6 sm:pt-10">
        <section className="relative overflow-hidden rounded-[2rem] border border-white/10 bg-[linear-gradient(145deg,rgba(6,12,26,0.92),rgba(8,18,34,0.94)_52%,rgba(8,16,33,0.98))] px-6 py-12 text-center shadow-[0_28px_90px_rgba(2,6,23,0.52)] sm:px-10 sm:py-16">
          <div className="pointer-events-none absolute inset-0">
            <div className="absolute -left-16 top-4 h-44 w-44 rounded-full bg-[radial-gradient(circle,rgba(71,214,202,0.28)_0%,rgba(71,214,202,0)_72%)] blur-2xl" />
            <div className="absolute right-[-2rem] top-12 h-52 w-52 rounded-full bg-[radial-gradient(circle,rgba(47,128,237,0.24)_0%,rgba(47,128,237,0)_70%)] blur-3xl" />
          </div>

          <div className="relative flex flex-col items-center">
            <BrandLogo size="lg" tone="light" />
            <div className="mt-6 inline-flex items-center gap-2 rounded-full border border-amber-300/25 bg-amber-400/10 px-4 py-2 text-[11px] font-bold uppercase tracking-[0.18em] text-amber-100">
              <Lock size={13} />
              Pricing coming soon
            </div>
            <h1 className="mt-5 bg-gradient-to-r from-[#47d6ca] via-[#2f80ed] to-[#f3b86b] bg-clip-text text-4xl font-extrabold tracking-tight text-transparent sm:text-5xl">
              Pricing is coming soon.
            </h1>
            <p className="mx-auto mt-5 max-w-2xl text-base leading-7 text-slate-300 sm:text-lg">
              We are locking the public pricing surface while plans, packs, and checkout flows are being finalized.
              You can still explore the landing tour and open the studio, but billing is not live yet.
            </p>
            <div className="mx-auto mt-5 max-w-2xl rounded-[1.25rem] border border-amber-300/20 bg-amber-400/10 px-5 py-4 text-left text-sm leading-6 text-amber-50">
              <p className="font-semibold">{SIGNUP_DISABLED_MARKETING_HEADLINE}</p>
              <p className="mt-1 text-amber-100/90">{SIGNUP_DISABLED_MARKETING_DETAIL}</p>
            </div>
            {hasCheckoutReturn ? (
              <div className="mx-auto mt-5 max-w-2xl rounded-[1.25rem] border border-cyan-300/20 bg-cyan-400/8 px-5 py-4 text-left text-sm leading-6 text-cyan-50">
                {billingState === 'success'
                  ? 'A checkout return was detected. Public pricing is still locked, so open the billing workspace to review your account and usage.'
                  : 'A checkout cancellation was detected. Public pricing is still locked, so open the billing workspace if you want to review your account before trying again.'}
              </div>
            ) : null}
            <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
              <a
                href={loginHref}
                className="inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-[#47d6ca] via-[#2f80ed] to-[#f3b86b] px-7 py-3 text-[14px] font-semibold text-slate-950 shadow-[0_18px_40px_rgba(71,214,202,0.24)] transition hover:brightness-110"
              >
                Sign in
                <ArrowRight size={16} />
              </a>
              <a
                href="/landing"
                className="inline-flex items-center gap-2 rounded-full border border-white/14 bg-white/5 px-7 py-3 text-[14px] font-semibold text-slate-100 transition hover:bg-white/10"
              >
                Back to landing
              </a>
              {hasCheckoutReturn ? (
                <a
                  href={billingWorkspaceHref}
                  className="inline-flex items-center gap-2 rounded-full border border-cyan-300/25 bg-cyan-400/10 px-7 py-3 text-[14px] font-semibold text-cyan-50 transition hover:bg-cyan-400/16"
                >
                  Open billing workspace
                </a>
              ) : null}
            </div>
          </div>
        </section>

        <section className="relative mt-8 overflow-hidden rounded-[1.75rem] border border-white/10 bg-white/[0.04] px-5 py-6 sm:px-6">
          <div className="pointer-events-none absolute inset-0 backdrop-blur-[14px]" />
          <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,rgba(6,12,26,0.22),rgba(6,12,26,0.56))]" />
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center px-6">
            <div className="max-w-xl rounded-[1.5rem] border border-white/14 bg-slate-950/55 px-6 py-6 text-center shadow-[0_22px_60px_rgba(2,6,23,0.4)]">
              <div className="mx-auto inline-flex items-center gap-2 rounded-full border border-cyan-300/25 bg-cyan-400/10 px-4 py-2 text-[11px] font-bold uppercase tracking-[0.18em] text-cyan-100">
                <Sparkles size={13} />
                Locked preview
              </div>
              <h2 className="mt-4 text-2xl font-bold text-white">Plans are blurred until launch.</h2>
              <p className="mt-3 text-sm leading-6 text-slate-300">
                Pricing tables are intentionally obscured while we finish packaging and launch checks.
                When billing opens, this page will switch back to live plan and checkout controls.
              </p>
            </div>
          </div>

          <div aria-hidden="true" className="grid gap-6 blur-[10px] saturate-[0.8] sm:grid-cols-3">
            {planPreview.map((plan) => (
              <article
                key={plan.key}
                className="rounded-[1.25rem] border border-white/10 bg-[linear-gradient(180deg,rgba(15,23,42,0.78),rgba(7,12,24,0.94))] p-5"
              >
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-cyan-200/80">Plan</p>
                <h3 className="mt-3 text-xl font-bold text-white">{plan.name}</h3>
                <p className="mt-2 text-3xl font-extrabold text-white">{formatInr(plan.firstCycleInr)}</p>
                <p className="mt-2 text-sm text-slate-300">{plan.vfCredits.toLocaleString('en-IN')} VF included</p>
              </article>
            ))}
          </div>

          <div aria-hidden="true" className="mt-6 grid gap-6 blur-[10px] saturate-[0.8] sm:grid-cols-2">
            <div className="rounded-[1.25rem] border border-white/10 bg-[linear-gradient(180deg,rgba(15,23,42,0.78),rgba(7,12,24,0.94))] p-5">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-cyan-200/80">Credit packs</p>
              <div className="mt-4 space-y-3">
                {creditPreview.map((pack) => (
                  <div key={pack.key} className="flex items-center justify-between rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3">
                    <span className="font-semibold text-white">{pack.label}</span>
                    <span className="text-slate-300">{formatInr(pack.priceInr)}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-[1.25rem] border border-white/10 bg-[linear-gradient(180deg,rgba(15,23,42,0.78),rgba(7,12,24,0.94))] p-5">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-cyan-200/80">Voice clone packs</p>
              <div className="mt-4 space-y-3">
                {clonePreview.map((pack) => (
                  <div key={pack.key} className="flex items-center justify-between rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3">
                    <span className="font-semibold text-white">{pack.label}</span>
                    <span className="text-slate-300">{formatInr(pack.priceInr)}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        <footer className="mt-10 border-t border-white/10 pt-8">
          <div className="flex flex-col items-center gap-6">
            <BrandLogo size="sm" tone="light" />
            <LegalLinks
              className="justify-center"
              linkClassName="vf-billing-legal-link text-slate-400 hover:text-slate-200"
            />
            <p className="text-center text-[11px] text-slate-500">
              &copy; {new Date().getFullYear()} V Flow AI. All rights reserved.
            </p>
          </div>
        </footer>
      </div>
    </div>
  );
}
