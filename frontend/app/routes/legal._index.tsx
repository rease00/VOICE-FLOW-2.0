import { Link } from "react-router";
import { publicRouteMeta } from "./_public/public-route";

const LEGAL_LINKS = [
  { href: "/legal/terms", label: "Terms of Service" },
  { href: "/legal/privacy", label: "Privacy Policy" },
  { href: "/legal/acceptable-use", label: "Acceptable Use Policy" },
  { href: "/legal/cookies", label: "Cookie Policy" },
  { href: "/legal/billing-refunds", label: "Billing and Refund Policy" },
  { href: "/legal/copyright", label: "Copyright and IP Notice" },
];

export function meta() {
  return publicRouteMeta(
    "Legal | V FLOW AI",
    "Policies, terms, and legal notices for V FLOW AI."
  );
}

export default function LegalIndexRoute() {
  return (
    <main className="min-h-screen w-full bg-black px-4 py-10 text-slate-100 sm:px-6 lg:px-8">
      <section className="mx-auto flex w-full max-w-4xl flex-col gap-5 rounded-3xl border border-white/10 bg-slate-950/80 p-6 shadow-[0_24px_80px_rgba(0,0,0,0.28)] sm:p-8">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-cyan-300">Legal</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-white">Policies and notices</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-300">
            All legal documents stay in the frozen public shell. Pick the policy you need below.
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          {LEGAL_LINKS.map((item) => (
            <Link
              key={item.href}
              to={item.href}
              className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-4 text-sm font-semibold text-slate-100 transition hover:border-cyan-300/30 hover:bg-cyan-500/10"
            >
              {item.label}
            </Link>
          ))}
        </div>
      </section>
    </main>
  );
}
