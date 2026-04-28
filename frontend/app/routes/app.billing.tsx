import type { ActionFunctionArgs, LoaderFunctionArgs } from 'react-router';
import { Form, redirect, useActionData, useNavigation } from 'react-router';
import {
  AnchorButton,
  BrandMark,
  BILLING_PORTAL_SESSION_ENDPOINTS,
  BILLING_SUBSCRIPTION_CANCEL_ENDPOINTS,
  BILLING_SUBSCRIPTION_RESUME_ENDPOINTS,
  ShellRoot,
  StatCard,
  clampText,
  loginHref,
  loadAuthSession,
  loadBillingSummary,
  postFirstJson,
  useRouteData,
} from './_shared';

export async function loader({ request, context }: LoaderFunctionArgs) {
  const backendEnv = (context as any)?.cloudflare?.env;
  const [session, billing] = await Promise.all([
    loadAuthSession(request, backendEnv),
    loadBillingSummary(request, backendEnv),
  ]);

  return {
    session,
    billing,
  };
}

type BillingLoaderData = Awaited<ReturnType<typeof loader>>;

type BillingActionData = {
  ok: false;
  message: string;
  intent?: string;
  endpoint?: string | null;
};

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

export default function AppBillingRoute() {
  return <Component />;
}

export async function action({ request, context }: ActionFunctionArgs) {
  const backendEnv = (context as any)?.cloudflare?.env;
  const formData = await request.formData();
  const intent = String(formData.get('intent') || '').trim();

  if (intent === 'portal-session') {
    const response = await postFirstJson<{ ok?: boolean; url?: string }>(
      request,
      BILLING_PORTAL_SESSION_ENDPOINTS,
      { returnUrl: '/app/billing' },
      backendEnv
    );

    if (!response.ok || !response.data?.url) {
      return Response.json(
        {
          ok: false,
          intent,
          endpoint: response.endpoint,
          message: response.error || 'Unable to open the billing portal session.',
        },
        { status: response.status || 500 }
      );
    }

    return redirect(safeRedirectTarget(response.data.url));
  }

  if (intent === 'subscription-cancel') {
    const response = await postFirstJson(request, BILLING_SUBSCRIPTION_CANCEL_ENDPOINTS, {}, backendEnv);

    if (!response.ok) {
      return Response.json(
        {
          ok: false,
          intent,
          endpoint: response.endpoint,
          message: response.error || 'Unable to cancel the subscription.',
        },
        { status: response.status || 500 }
      );
    }

    return redirect('/app/billing');
  }

  if (intent === 'subscription-resume') {
    const response = await postFirstJson(request, BILLING_SUBSCRIPTION_RESUME_ENDPOINTS, {}, backendEnv);

    if (!response.ok) {
      return Response.json(
        {
          ok: false,
          intent,
          endpoint: response.endpoint,
          message: response.error || 'Unable to resume the subscription.',
        },
        { status: response.status || 500 }
      );
    }

    return redirect('/app/billing');
  }

  return Response.json(
    {
      ok: false,
      intent,
      message: 'Unknown billing action.',
    },
    { status: 400 }
  );
}

export function Component() {
  const actionData = useActionData() as BillingActionData | undefined;
  const navigation = useNavigation();
  const { session, billing } = useRouteData<BillingLoaderData>();
  const summary = billing?.data?.summary ?? null;
  const sessionState = session as SessionStateLike;
  const user = sessionState?.data?.user ?? sessionState?.user ?? null;
  const account = summary?.account ?? {};
  const billingProfile = summary?.billingProfile ?? {};
  const wallet = summary?.wallet ?? {};
  const subscription = summary?.subscription ?? {};
  const portalEnabled = Boolean(summary?.portal?.enabled);
  const portalUrl = clampText(summary?.portal?.url, 'No portal session');
  const supportEmail = clampText(summary?.support?.email, 'support@v-flow-ai.com');
  const supportTopic = clampText(summary?.support?.topic, 'billing');
  const planName = clampText(subscription?.planName || subscription?.planId, 'Coming soon');
  const displayName = clampText(
    billingProfile?.contactName || billingProfile?.companyName || account?.displayName || user?.displayName || user?.name,
    'Billing'
  );
  const email = clampText(billingProfile?.email || account?.email || user?.email, 'Session not loaded');
  const contactName = clampText(billingProfile?.contactName || account?.displayName, 'Not set');
  const companyName = clampText(billingProfile?.companyName, 'Not set');
  const country = clampText(billingProfile?.country || account?.country, 'IN');
  const subscriptionStatus = clampText(subscription?.status, 'inactive');
  const cancelAtPeriodEnd = Boolean(subscription?.cancelAtPeriodEnd);
  const canResume = cancelAtPeriodEnd || subscriptionStatus.toLowerCase() === 'cancelled';
  const isSubmitting = navigation.state === 'submitting';
  const statusMessage = actionData?.message || '';

  return (
    <ShellRoot ariaLabel="Billing overview">
      <div className="relative z-10 flex min-h-[100dvh] items-center justify-center px-4 py-8">
        <div className="ap-card w-full max-w-2xl p-6 sm:p-8">
          <span className="ap-eyebrow">
            <span className="ap-live-dot" style={{ height: 6, width: 6 }} />
            Billing
          </span>
          <div className="mt-6 flex items-start justify-between gap-4">
            <div className="min-w-0 flex-1">
              <BrandMark />
              <h1 className="mt-4 text-2xl font-black tracking-tight text-white sm:text-3xl">Billing stays in the same shell.</h1>
              <p className="mt-2 text-sm leading-7 text-slate-400">
                We&apos;re reading the billing summary and keeping the route outcome stable while the UI stays frozen.
              </p>
            </div>
          </div>
          <div className="mt-6 flex flex-wrap gap-2.5">
            <div className="rounded-full border border-white/12 bg-white/[0.05] px-3 py-2 text-[11px] font-semibold text-slate-100">
              {displayName}
            </div>
            <div className="rounded-full border border-white/12 bg-white/[0.05] px-3 py-2 text-[11px] font-semibold text-slate-100">
              {email}
            </div>
            <div className="rounded-full border border-emerald-300/20 bg-emerald-500/10 px-3 py-2 text-[11px] font-semibold text-emerald-100">
              {clampText(subscription?.status, 'inactive')}
            </div>
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <div className="rounded-2xl border border-white/10 bg-slate-950/48 px-3 py-3">
              <div className="text-[10px] uppercase tracking-[0.16em] text-slate-500">Portal</div>
              <div className="mt-1 text-lg font-semibold text-white">{portalEnabled ? 'Enabled' : 'Pending'}</div>
              <div className="mt-1 text-xs leading-5 text-slate-400">{portalUrl}</div>
            </div>
            <div className="rounded-2xl border border-white/10 bg-slate-950/48 px-3 py-3">
              <div className="text-[10px] uppercase tracking-[0.16em] text-slate-500">Support</div>
              <div className="mt-1 text-lg font-semibold text-white">{supportEmail}</div>
              <div className="mt-1 text-xs leading-5 text-slate-400">{supportTopic}</div>
            </div>
          </div>
          <div className="mt-6 grid gap-3 sm:grid-cols-3">
            <StatCard label="Plan" value={planName} />
            <StatCard label="VF" value={String(wallet?.vfBalance ?? 0)} />
            <StatCard label="VC" value={String(wallet?.vcSpendableBalance ?? wallet?.vcPaidBalance ?? 0)} />
          </div>
          <div className="mt-4 flex items-center justify-between gap-3 rounded-xl border border-white/[0.07] bg-white/[0.025] px-4 py-2.5 text-xs text-slate-400">
            <span>
              {portalEnabled ? 'Portal is ready' : 'Portal is pending'}
              {' - '}
              {contactName}
              {' - '}
              {companyName}
            </span>
            <span className="flex items-center gap-1 text-cyan-300">
              {country}
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
          <div className="mt-4 grid gap-2 rounded-2xl border border-white/10 bg-slate-950/48 p-3">
            <div className="text-[10px] uppercase tracking-[0.16em] text-slate-500">Billing actions</div>
            <div className="flex flex-wrap gap-2">
              <BillingFormButton
                intent="portal-session"
                label="Open portal session"
                disabled={isSubmitting}
                className="border border-cyan-300/20 bg-cyan-500/10 text-cyan-100 hover:bg-cyan-500/15"
              />
              <BillingFormButton
                intent="subscription-cancel"
                label={cancelAtPeriodEnd ? 'Cancellation pending' : 'Cancel subscription'}
                disabled={isSubmitting || subscriptionStatus.toLowerCase() === 'cancelled'}
                className="border border-rose-300/20 bg-rose-500/10 text-rose-100 hover:bg-rose-500/15"
              />
              <BillingFormButton
                intent="subscription-resume"
                label={canResume ? 'Resume subscription' : 'Resume unavailable'}
                disabled={isSubmitting || !canResume}
                className="border border-emerald-300/20 bg-emerald-500/10 text-emerald-100 hover:bg-emerald-500/15"
              />
            </div>
            <div className="text-xs leading-6 text-slate-400">
              {statusMessage || 'No recent billing action.'}
            </div>
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

function BillingFormButton({
  intent,
  label,
  className,
  disabled,
}: {
  intent: string;
  label: string;
  className: string;
  disabled?: boolean;
}) {
  return (
    <Form method="post" className="inline-flex">
      <input type="hidden" name="intent" value={intent} />
      <input type="hidden" name="returnUrl" value="/app/billing" />
      <button
        type="submit"
        disabled={disabled}
        className={`inline-flex min-h-11 items-center rounded-full px-4 py-2 text-[12px] font-semibold transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-60 ${className}`}
      >
        {label}
      </button>
    </Form>
  );
}

function safeRedirectTarget(url: string) {
  const fallback = '/app/billing';
  const text = String(url || '').trim();
  if (!text) return fallback;

  if (text.startsWith('/')) {
    return text;
  }

  try {
    const parsed = new URL(text, 'http://localhost');
    if (parsed.origin === 'http://localhost' && parsed.pathname.startsWith('/')) {
      return `${parsed.pathname}${parsed.search}${parsed.hash}`;
    }
  } catch {
    return fallback;
  }

  return fallback;
}
