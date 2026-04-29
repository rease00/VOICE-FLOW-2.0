import { useEffect, useMemo, useRef, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type { LoaderFunctionArgs } from 'react-router';
import { useRevalidator } from 'react-router';
import {
  ACCOUNT_PROFILE_ENDPOINTS,
  AnchorButton,
  BrandMark,
  ShellRoot,
  StatCard,
  clampText,
  loadAccountProfile,
  loadAuthSession,
  loadBillingSummary,
  loginHref,
  useRouteData,
} from './_shared';

export async function loader({ request, context }: LoaderFunctionArgs) {
  const backendEnv = (context as any)?.cloudflare?.env;
  const [session, billing, profile] = await Promise.all([
    loadAuthSession(request, backendEnv),
    loadBillingSummary(request, backendEnv),
    loadAccountProfile(request, backendEnv),
  ]);

  return {
    session,
    billing,
    profile,
  };
}

type AccountLoaderData = Awaited<ReturnType<typeof loader>>;

type SessionUserLike = {
  email?: string;
  displayName?: string;
  name?: string;
};

type SessionStateLike = {
  data?: {
    user?: SessionUserLike;
  };
  user?: SessionUserLike;
} | null;

type AccountDraft = {
  displayName: string;
  fullName: string;
  email: string;
  username: string;
  bio: string;
  timezone: string;
  locale: string;
  billingProfile: BillingProfileDraft;
};

type BillingProfileDraft = {
  companyName: string;
  contactName: string;
  email: string;
  phone: string;
  line1: string;
  line2: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
  taxId: string;
  notes: string;
};

type ProfileRecord = NonNullable<NonNullable<AccountLoaderData['profile']>['data']>['profile'];

const AUTOSAVE_DELAY_MS = 650;
const EMPTY_LOADER_RECORD = Object.freeze({}) as Record<string, never>;

export default function AppAccountRoute() {
  return <Component />;
}

export function Component() {
  const { session, billing, profile } = useRouteData<AccountLoaderData>();
  const summary = billing?.data?.summary ?? null;
  const profileRecord = profile?.data?.profile ?? null;
  const account = summary?.account ?? EMPTY_LOADER_RECORD;
  const billingProfile = summary?.billingProfile ?? EMPTY_LOADER_RECORD;
  const subscription = summary?.subscription ?? EMPTY_LOADER_RECORD;
  const portal = summary?.portal ?? EMPTY_LOADER_RECORD;
  const support = summary?.support ?? EMPTY_LOADER_RECORD;
  const sessionState = session as SessionStateLike;
  const user = sessionState?.data?.user ?? sessionState?.user ?? null;
  const profileLoadError = profile?.ok ? null : profile?.error || 'Account profile could not be loaded.';
  const initialDraft = useMemo(
    () => buildInitialDraft(account, billingProfile, profileRecord, user),
    [account, billingProfile, profileRecord, user]
  );
  const [draft, setDraft] = useState<AccountDraft>(initialDraft);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('saved');
  const [saveMessage, setSaveMessage] = useState('Synced with backend');
  const revalidator = useRevalidator();
  const lastSavedSnapshotRef = useRef<string>(serializeDraft(initialDraft));
  const requestSequenceRef = useRef(0);

  useEffect(() => {
    const snapshot = serializeDraft(initialDraft);
    lastSavedSnapshotRef.current = snapshot;
    setDraft(initialDraft);
    setSaveState('saved');
    setSaveMessage('Loaded current profile state');
  }, [initialDraft]);

  useEffect(() => {
    if (profileLoadError) {
      setSaveState('error');
      setSaveMessage(profileLoadError);
      return;
    }

    const snapshot = serializeDraft(draft);
    if (snapshot === lastSavedSnapshotRef.current) {
      if (saveState !== 'error') {
        setSaveState('saved');
        setSaveMessage('All profile changes are saved');
      }
      return;
    }

    setSaveState('saving');
    setSaveMessage('Saving account profile changes');
    const sequence = requestSequenceRef.current + 1;
    requestSequenceRef.current = sequence;

    const timeout = window.setTimeout(async () => {
      try {
        const response = await fetch(ACCOUNT_PROFILE_ENDPOINTS[0], {
          method: 'POST',
          headers: {
            accept: 'application/json',
            'content-type': 'application/json',
          },
          credentials: 'include',
          body: JSON.stringify(toProfilePatch(draft)),
        });
        const body = await response.json().catch(() => null);

        if (sequence !== requestSequenceRef.current) {
          return;
        }

        if (!response.ok) {
          throw new Error(readResponseError(body, response.statusText || 'Unable to save account profile.'));
        }

        lastSavedSnapshotRef.current = snapshot;
        setSaveState('saved');
        setSaveMessage('Autosaved to account profile');
        revalidator.revalidate();
      } catch (error) {
        if (sequence !== requestSequenceRef.current) {
          return;
        }

        setSaveState('error');
        setSaveMessage(error instanceof Error ? error.message : 'Unable to save account profile.');
      }
    }, AUTOSAVE_DELAY_MS);

    return () => window.clearTimeout(timeout);
  }, [draft, profileLoadError, revalidator]);

  const accountStateLabel =
    saveState === 'saving'
      ? 'Saving'
      : saveState === 'error'
        ? 'Needs attention'
        : 'Synced';
  const accountStateTone =
    saveState === 'saving'
      ? 'text-cyan-100 border-cyan-300/20 bg-cyan-500/10'
      : saveState === 'error'
        ? 'text-rose-100 border-rose-300/20 bg-rose-500/10'
        : 'text-emerald-100 border-emerald-300/20 bg-emerald-500/10';

  const email = clampText(draft.email || account.email || user?.email, 'Session not loaded');
  const displayName = clampText(draft.displayName || account.displayName || user?.displayName || user?.name, 'Account');
  const country = clampText(draft.billingProfile.country || account.country || billingProfile.country, 'IN');
  const plan = clampText(subscription.planName || subscription.planId, 'Inactive');
  const billingCompany = clampText(draft.billingProfile.companyName || billingProfile.companyName, 'Not set');
  const billingContact = clampText(draft.billingProfile.contactName || billingProfile.contactName, 'Not set');
  const subscriptionStatus = clampText(subscription.status, 'inactive');
  const subscriptionProvider = clampText(subscription.provider, 'Not set');
  const renewsAt = formatDate(subscription.renewsAt);
  const supportEmail = clampText(support.email, 'Not set');
  const supportTopic = clampText(support.topic, 'General');
  const portalState = portal.enabled ? 'Ready' : 'Pending';
  const portalUrl = clampText(portal.url, 'Not available');
  const wallet = summary?.wallet ?? {};

  return (
    <ShellRoot ariaLabel="Account overview">
      <div className="relative z-10 flex min-h-[100dvh] items-start justify-center px-4 py-8 sm:items-center">
        <div className="ap-card w-full max-w-2xl p-6 sm:p-8">
          <span className="ap-eyebrow">
            <span className="ap-live-dot" style={{ height: 6, width: 6 }} />
            Account
          </span>
          <div className="mt-6 flex items-start justify-between gap-4">
            <div className="min-w-0 flex-1">
              <BrandMark />
              <h1 className="mt-4 text-2xl font-black tracking-tight text-white sm:text-3xl">Your account is loading.</h1>
              <p className="mt-2 text-sm leading-7 text-slate-400">
                We&apos;re checking session state and billing profile data without changing the shell.
              </p>
            </div>
          </div>
          <div className="mt-6 flex flex-wrap gap-2.5">
            <div className="min-w-0 break-words rounded-full border border-white/12 bg-white/[0.05] px-3 py-2 text-[11px] font-semibold text-slate-100">
              {displayName}
            </div>
            <div className="min-w-0 break-all rounded-full border border-white/12 bg-white/[0.05] px-3 py-2 text-[11px] font-semibold text-slate-100">
              {email}
            </div>
            <div className="rounded-full border border-emerald-300/20 bg-emerald-500/10 px-3 py-2 text-[11px] font-semibold text-emerald-100">
              {country}
            </div>
            <div className={`rounded-full border px-3 py-2 text-[11px] font-semibold ${accountStateTone}`}>
              {accountStateLabel}
            </div>
          </div>
          <div className="mt-6 grid gap-3 sm:grid-cols-3">
            <StatCard label="Plan" value={plan} />
            <StatCard label="VF" value={String(wallet?.vfBalance ?? 0)} />
            <StatCard label="VC" value={String(wallet?.vcSpendableBalance ?? wallet?.vcPaidBalance ?? 0)} />
          </div>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <section className="rounded-2xl border border-white/10 bg-slate-950/48 p-4">
              <div className="text-[10px] uppercase tracking-[0.16em] text-slate-500">Profile details</div>
              <div className="mt-3 grid gap-3">
                <EditableField
                  label="Display name"
                  value={draft.displayName}
                  onChange={(value) => updateDraft(setDraft, 'displayName', value)}
                  placeholder="Your display name"
                />
                <EditableField
                  label="Full name"
                  value={draft.fullName}
                  onChange={(value) => updateDraft(setDraft, 'fullName', value)}
                  placeholder="Full legal name"
                />
                <EditableField
                  label="Email"
                  type="email"
                  value={draft.email}
                  onChange={(value) => updateDraft(setDraft, 'email', value)}
                  placeholder="name@company.com"
                />
                <div className="grid gap-3 sm:grid-cols-2">
                  <EditableField
                    label="Username"
                    value={draft.username}
                    onChange={(value) => updateDraft(setDraft, 'username', value)}
                    placeholder="Optional handle"
                  />
                  <EditableField
                    label="Timezone"
                    value={draft.timezone}
                    onChange={(value) => updateDraft(setDraft, 'timezone', value)}
                    placeholder="Asia/Calcutta"
                  />
                </div>
                <EditableTextArea
                  label="Bio"
                  value={draft.bio}
                  onChange={(value) => updateDraft(setDraft, 'bio', value)}
                  placeholder="Short profile note"
                />
              </div>
            </section>
            <section className="rounded-2xl border border-white/10 bg-slate-950/48 p-4">
              <div className="text-[10px] uppercase tracking-[0.16em] text-slate-500">Billing profile</div>
              <div className="mt-3 grid gap-3">
                <EditableField
                  label="Company"
                  value={draft.billingProfile.companyName}
                  onChange={(value) => updateBillingDraft(setDraft, 'companyName', value)}
                  placeholder="Company name"
                />
                <EditableField
                  label="Contact"
                  value={draft.billingProfile.contactName}
                  onChange={(value) => updateBillingDraft(setDraft, 'contactName', value)}
                  placeholder="Billing contact"
                />
                <EditableField
                  label="Billing email"
                  type="email"
                  value={draft.billingProfile.email}
                  onChange={(value) => updateBillingDraft(setDraft, 'email', value)}
                  placeholder="billing@company.com"
                />
                <div className="grid gap-3 sm:grid-cols-2">
                  <EditableField
                    label="Phone"
                    type="tel"
                    value={draft.billingProfile.phone}
                    onChange={(value) => updateBillingDraft(setDraft, 'phone', value)}
                    placeholder="+91..."
                  />
                  <EditableField
                    label="Country"
                    value={draft.billingProfile.country}
                    onChange={(value) => updateBillingDraft(setDraft, 'country', value)}
                    placeholder="IN"
                  />
                </div>
                <EditableField
                  label="Address line 1"
                  value={draft.billingProfile.line1}
                  onChange={(value) => updateBillingDraft(setDraft, 'line1', value)}
                  placeholder="Street address"
                />
                <EditableField
                  label="Address line 2"
                  value={draft.billingProfile.line2}
                  onChange={(value) => updateBillingDraft(setDraft, 'line2', value)}
                  placeholder="Suite, floor, unit"
                />
                <div className="grid gap-3 sm:grid-cols-2">
                  <EditableField
                    label="City"
                    value={draft.billingProfile.city}
                    onChange={(value) => updateBillingDraft(setDraft, 'city', value)}
                    placeholder="City"
                  />
                  <EditableField
                    label="State"
                    value={draft.billingProfile.state}
                    onChange={(value) => updateBillingDraft(setDraft, 'state', value)}
                    placeholder="State"
                  />
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <EditableField
                    label="Postal code"
                    value={draft.billingProfile.postalCode}
                    onChange={(value) => updateBillingDraft(setDraft, 'postalCode', value)}
                    placeholder="Postal code"
                  />
                  <EditableField
                    label="Tax ID"
                    value={draft.billingProfile.taxId}
                    onChange={(value) => updateBillingDraft(setDraft, 'taxId', value)}
                    placeholder="GST / VAT / tax id"
                  />
                </div>
                <EditableTextArea
                  label="Billing notes"
                  value={draft.billingProfile.notes}
                  onChange={(value) => updateBillingDraft(setDraft, 'notes', value)}
                  placeholder="Invoice instructions or billing notes"
                />
              </div>
            </section>
            <section className="rounded-2xl border border-white/10 bg-slate-950/48 p-4">
              <div className="text-[10px] uppercase tracking-[0.16em] text-slate-500">Subscription</div>
              <dl className="mt-3 grid gap-3 text-sm">
                <KeyValue label="Plan" value={plan} />
                <KeyValue label="Provider" value={subscriptionProvider} />
                <KeyValue label="Renews" value={renewsAt} />
              </dl>
            </section>
            <section className="rounded-2xl border border-white/10 bg-slate-950/48 p-4">
              <div className="text-[10px] uppercase tracking-[0.16em] text-slate-500">Support & portal</div>
              <dl className="mt-3 grid gap-3 text-sm">
                <KeyValue label="Support email" value={supportEmail} />
                <KeyValue label="Support topic" value={supportTopic} />
                <KeyValue label="Portal" value={`${portalState} - ${portalUrl}`} />
                <KeyValue label="Billing profile" value={`${billingCompany} - ${billingContact} - ${country}`} />
              </dl>
            </section>
          </div>
          <div className="mt-4 flex flex-col items-start justify-between gap-3 rounded-xl border border-white/[0.07] bg-white/[0.025] px-4 py-2.5 text-xs text-slate-400 sm:flex-row sm:items-center">
            <span className="min-w-0 break-words">Checking session and billing - {saveMessage}</span>
            <span className="flex shrink-0 items-center gap-1 text-cyan-300">
              Keep this tab open
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="lucide lucide-arrow-right"
                aria-hidden="true"
              >
                <path d="M5 12h14" />
                <path d="m12 5 7 7-7 7" />
              </svg>
            </span>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <AnchorButton
              href="/app/studio"
              className="inline-flex min-h-11 items-center rounded-full bg-gradient-to-r from-[#47d6ca] via-[#2f80ed] to-[#f3b86b] px-4 py-2 text-[12px] font-semibold text-slate-950 shadow-[0_18px_40px_rgba(71,214,202,0.24)] transition hover:brightness-105"
            >
              Open studio
            </AnchorButton>
            <AnchorButton
              href={loginHref('/app/studio')}
              className="inline-flex min-h-11 items-center rounded-full border border-white/14 bg-white/5 px-4 py-2 text-[12px] font-semibold text-slate-100 transition hover:bg-white/10"
            >
              Re-auth
            </AnchorButton>
          </div>
        </div>
      </div>
    </ShellRoot>
  );
}

function buildInitialDraft(
  account: { displayName?: string | null; email?: string | null; country?: string | null } | null,
  billingProfile: { companyName?: string | null; contactName?: string | null; email?: string | null; country?: string | null } | null,
  profile: ProfileRecord,
  user: SessionUserLike | null
): AccountDraft {
  const profileBilling = profile?.billingProfile ?? {};
  return {
    displayName: clampText(profile?.displayName || account?.displayName || user?.displayName || user?.name, ''),
    fullName: clampText(profile?.fullName || account?.displayName || user?.displayName || user?.name, ''),
    email: clampText(profile?.email || account?.email || billingProfile?.email || user?.email, ''),
    username: clampText(profile?.username, ''),
    bio: clampText(profile?.bio, ''),
    timezone: clampText(profile?.timezone, 'Asia/Calcutta'),
    locale: clampText(profile?.locale, 'en-IN'),
    billingProfile: {
      companyName: clampText(profileBilling.companyName || billingProfile?.companyName, ''),
      contactName: clampText(profileBilling.contactName || billingProfile?.contactName || account?.displayName || user?.displayName || user?.name, ''),
      email: clampText(profileBilling.email || billingProfile?.email || account?.email || user?.email, ''),
      phone: clampText(profileBilling.phone, ''),
      line1: clampText(profileBilling.line1, ''),
      line2: clampText(profileBilling.line2, ''),
      city: clampText(profileBilling.city, ''),
      state: clampText(profileBilling.state, ''),
      postalCode: clampText(profileBilling.postalCode, ''),
      country: clampText(profileBilling.country || billingProfile?.country || account?.country, 'IN'),
      taxId: clampText(profileBilling.taxId, ''),
      notes: clampText(profileBilling.notes, ''),
    },
  };
}

function serializeDraft(draft: AccountDraft) {
  return JSON.stringify(draft);
}

function toProfilePatch(draft: AccountDraft) {
  return {
    displayName: draft.displayName,
    fullName: draft.fullName,
    email: draft.email,
    username: draft.username,
    bio: draft.bio,
    timezone: draft.timezone,
    locale: draft.locale,
    billingProfile: {
      companyName: draft.billingProfile.companyName,
      contactName: draft.billingProfile.contactName,
      email: draft.billingProfile.email,
      phone: draft.billingProfile.phone,
      line1: draft.billingProfile.line1,
      line2: draft.billingProfile.line2,
      city: draft.billingProfile.city,
      state: draft.billingProfile.state,
      postalCode: draft.billingProfile.postalCode,
      country: draft.billingProfile.country,
      taxId: draft.billingProfile.taxId,
      notes: draft.billingProfile.notes,
    },
  };
}

function readResponseError(body: unknown, fallback: string) {
  if (body && typeof body === 'object') {
    const error = (body as { error?: unknown }).error;
    if (error && typeof error === 'object') {
      const message = (error as { message?: unknown }).message;
      if (typeof message === 'string' && message.trim()) {
        return message.trim();
      }
    }
    if (typeof (body as { message?: unknown }).message === 'string') {
      return String((body as { message?: unknown }).message).trim() || fallback;
    }
  }

  return fallback;
}

function updateDraft<K extends keyof Omit<AccountDraft, 'billingProfile'>>(
  setDraft: Dispatch<SetStateAction<AccountDraft>>,
  key: K,
  value: string
) {
  setDraft((current) => ({
    ...current,
    [key]: value,
  }));
}

function updateBillingDraft<K extends keyof BillingProfileDraft>(
  setDraft: Dispatch<SetStateAction<AccountDraft>>,
  key: K,
  value: string
) {
  setDraft((current) => ({
    ...current,
    billingProfile: {
      ...current.billingProfile,
      [key]: value,
    },
  }));
}

function EditableField({
  label,
  value,
  onChange,
  placeholder,
  type = 'text',
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: 'text' | 'email' | 'tel';
}) {
  return (
    <label className="grid gap-1.5">
      <span className="text-[10px] uppercase tracking-[0.14em] text-slate-500">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className={fieldInputClass}
      />
    </label>
  );
}

function EditableTextArea({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="grid gap-1.5">
      <span className="text-[10px] uppercase tracking-[0.14em] text-slate-500">{label}</span>
      <textarea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className={`${fieldInputClass} min-h-24 resize-y`}
      />
    </label>
  );
}

function KeyValue({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-1">
      <dt className="text-[10px] uppercase tracking-[0.14em] text-slate-500">{label}</dt>
      <dd className="break-words text-sm leading-6 text-slate-100">{value}</dd>
    </div>
  );
}

const fieldInputClass =
  'w-full rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2.5 text-sm text-slate-100 outline-none transition placeholder:text-slate-500 focus:border-cyan-300/40 focus:bg-white/[0.06] focus-visible:ring-2 focus-visible:ring-cyan-300/70 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950';

function formatDate(value: string | number | null | undefined) {
  if (value == null || value === '') return 'Not set';
  const date = typeof value === 'number' ? new Date(value) : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Kolkata',
  }).format(date);
}
