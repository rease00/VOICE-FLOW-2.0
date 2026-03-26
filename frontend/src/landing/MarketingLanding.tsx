import React from 'react';
import { ArrowRight, ShieldCheck, Sparkles, Zap } from 'lucide-react';
import { BrandLogo } from '../../components/BrandLogo';
import { LegalLinks } from './LegalLinks';

const capabilityCards = [
  {
    title: 'Narration Studio',
    body: 'Create polished voiceovers for videos, reels, and storytelling with fast iteration controls.',
  },
  {
    title: 'Multi-Engine Workflow',
    body: 'Switch engine quality levels by task, balancing speed, quality, and cost on the same project.',
  },
  {
    title: 'Reader & Novel Flow',
    body: 'Turn long-form text into structured listening sessions with reusable voice setups and progress memory.',
  },
  {
    title: 'Production Controls',
    body: 'Track usage, organize drafts, and ship consistent audio output from one focused workspace.',
  },
];

const trustPillars = [
  {
    icon: ShieldCheck,
    title: 'Privacy-forward operation',
    description: 'Account controls, policy transparency, and safer-by-default handling for user content workflows.',
  },
  {
    icon: Zap,
    title: 'Built for speed',
    description: 'Edge-ready frontend delivery and optimized generation flow for responsive user experiences.',
  },
  {
    icon: Sparkles,
    title: 'Creator-first design',
    description: 'VoiceFlow is built to help creators ship more output without production complexity.',
  },
];

const faq = [
  {
    q: 'Do I need a paid plan to start?',
    a: 'No. You can start with the free tier and upgrade only when your production needs grow.',
  },
  {
    q: 'Does this landing page run live TTS demos?',
    a: 'No. This page is static for cost efficiency. Voice generation happens inside the app after you start.',
  },
  {
    q: 'Can I use it for YouTube and short-form content?',
    a: 'Yes. VoiceFlow is designed for creator workflows including narration, short-form clips, and serialized content.',
  },
];

const appUrl = 'https://v-flow-ai.com/app';

export const MarketingLanding: React.FC = () => {
  const ldJson = {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: 'VoiceFlow',
    applicationCategory: 'MultimediaApplication',
    operatingSystem: 'Web',
    offers: {
      '@type': 'Offer',
      price: '0',
      priceCurrency: 'USD',
    },
    publisher: {
      '@type': 'Organization',
      name: 'VoiceFlow',
      url: 'https://v-flow-ai.com',
    },
  };

  return (
    <div className="min-h-screen overflow-x-hidden bg-[#f4f7ff] text-gray-900">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(ldJson) }} />
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(70%_65%_at_6%_8%,rgba(14,165,233,0.22),transparent_60%),radial-gradient(72%_68%_at_92%_10%,rgba(16,185,129,0.16),transparent_62%),radial-gradient(80%_70%_at_50%_96%,rgba(37,99,235,0.13),transparent_74%)]" />

      <header className="relative z-10">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-4 pb-2 pt-5 sm:px-6 sm:pt-8">
          <BrandLogo size="md" tone="dark" />
          <div className="flex items-center gap-2">
            <a
              href="/legal"
              className="rounded-full border border-sky-200 bg-white/85 px-4 py-2 text-xs font-semibold text-sky-700 transition hover:bg-sky-50"
            >
              Legal
            </a>
            <a
              href={appUrl}
              className="rounded-full bg-gradient-to-r from-cyan-500 via-sky-500 to-blue-600 px-5 py-2 text-xs font-semibold text-white shadow-lg shadow-cyan-200 transition hover:translate-y-[-1px] hover:brightness-105"
            >
              Start Free
            </a>
          </div>
        </div>
      </header>

      <main className="relative z-10">
        <section className="mx-auto grid w-full max-w-6xl gap-8 px-4 pb-10 pt-4 sm:px-6 md:grid-cols-[1.1fr_0.9fr] md:items-center md:gap-10 md:pt-8">
          <div>
            <p className="inline-flex items-center gap-2 rounded-full border border-sky-200 bg-white/85 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.18em] text-sky-700">
              VoiceFlow Platform
            </p>
            <h1 className="mt-4 font-serif text-4xl font-bold leading-tight text-gray-900 sm:text-5xl lg:text-6xl">
              Create voice content that sounds production-ready from day one.
            </h1>
            <p className="mt-4 max-w-xl text-sm leading-relaxed text-gray-600 sm:text-base">
              VoiceFlow helps creators turn scripts into polished audio workflows with quality controls, reusable setups,
              and launch-ready output across modern content formats.
            </p>
            <div className="mt-6 flex flex-wrap items-center gap-3">
              <a
                href={appUrl}
                className="inline-flex items-center gap-2 rounded-full bg-gray-900 px-6 py-3 text-sm font-bold text-white shadow-xl shadow-gray-300 transition hover:translate-y-[-1px] hover:bg-black"
              >
                Start Free <ArrowRight size={16} />
              </a>
              <a
                href="#capabilities"
                className="rounded-full border border-sky-200 bg-white/85 px-6 py-3 text-sm font-semibold text-sky-700 transition hover:bg-sky-50"
              >
                Explore Capabilities
              </a>
            </div>
          </div>
          <div className="rounded-[2rem] border border-white/80 bg-white/85 p-6 shadow-2xl shadow-sky-100/80 backdrop-blur animate-in fade-in slide-in-from-right-6 duration-700">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-sky-700">Workflow Snapshot</p>
            <div className="mt-4 space-y-3">
              {[
                'Write or import script',
                'Pick voice profile and style',
                'Generate, review, and export',
              ].map((step, idx) => (
                <div
                  key={step}
                  className="flex items-center gap-3 rounded-2xl border border-sky-100 bg-gradient-to-r from-sky-50/90 to-cyan-50/70 p-3"
                >
                  <span className="flex h-8 w-8 items-center justify-center rounded-full bg-sky-600 text-xs font-bold text-white">
                    {idx + 1}
                  </span>
                  <span className="text-sm font-semibold text-gray-800">{step}</span>
                </div>
              ))}
            </div>
            <div className="mt-5 rounded-2xl border border-emerald-100 bg-emerald-50/70 p-3 text-xs text-emerald-800">
              No public live demo compute is required on this page. Generation starts only inside the app.
            </div>
          </div>
        </section>

        <section id="capabilities" className="mx-auto w-full max-w-6xl px-4 pb-8 sm:px-6">
          <div className="grid gap-4 sm:grid-cols-2">
            {capabilityCards.map((card, idx) => (
              <article
                key={card.title}
                className="rounded-3xl border border-white/80 bg-white/85 p-6 shadow-lg shadow-sky-100/70 backdrop-blur animate-in fade-in slide-in-from-bottom-4 duration-700"
                style={{ animationDelay: `${idx * 70}ms` }}
              >
                <h2 className="text-lg font-bold text-gray-900">{card.title}</h2>
                <p className="mt-2 text-sm leading-relaxed text-gray-600">{card.body}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="mx-auto w-full max-w-6xl px-4 pb-8 sm:px-6">
          <div className="rounded-3xl border border-white/80 bg-white/85 p-6 shadow-xl shadow-sky-100/70 sm:p-8">
            <h2 className="text-2xl font-bold sm:text-3xl">Built for trust and long-term growth</h2>
            <div className="mt-5 grid gap-4 md:grid-cols-3">
              {trustPillars.map((pillar) => (
                <div key={pillar.title} className="rounded-2xl border border-sky-100 bg-sky-50/60 p-4">
                  <pillar.icon size={18} className="text-sky-700" />
                  <p className="mt-2 text-sm font-bold text-gray-900">{pillar.title}</p>
                  <p className="mt-1 text-xs leading-relaxed text-gray-600">{pillar.description}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="mx-auto w-full max-w-6xl px-4 pb-8 sm:px-6">
          <div className="grid gap-4 md:grid-cols-[0.9fr_1.1fr]">
            <div className="rounded-3xl border border-white/80 bg-white/85 p-6 shadow-lg shadow-sky-100/70">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-sky-700">Pricing</p>
              <h3 className="mt-2 text-xl font-bold">Start on Free, scale when ready</h3>
              <p className="mt-2 text-sm text-gray-600">
                Get started with core features, then move to paid capacity only when your audience or production volume grows.
              </p>
              <a
                href={appUrl}
                className="mt-5 inline-flex items-center gap-2 rounded-full bg-sky-600 px-5 py-2.5 text-xs font-bold text-white transition hover:bg-sky-700"
              >
                Open App <ArrowRight size={14} />
              </a>
            </div>
            <div className="rounded-3xl border border-white/80 bg-white/85 p-6 shadow-lg shadow-sky-100/70">
              <h3 className="text-xl font-bold">FAQ</h3>
              <div className="mt-4 space-y-3">
                {faq.map((item) => (
                  <details key={item.q} className="rounded-2xl border border-sky-100 bg-sky-50/50 p-3">
                    <summary className="cursor-pointer text-sm font-semibold text-gray-900">{item.q}</summary>
                    <p className="mt-2 text-xs leading-relaxed text-gray-600">{item.a}</p>
                  </details>
                ))}
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="relative z-10 border-t border-white/80 bg-white/75">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-3 px-4 py-6 sm:px-6 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-gray-600">
            Copyright {new Date().getFullYear()} VoiceFlow. AI voice platform for creators.
          </p>
          <LegalLinks />
        </div>
      </footer>
    </div>
  );
};
