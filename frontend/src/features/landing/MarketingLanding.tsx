import {
  ArrowRight,
  AudioLines,
  BookOpen,
  Globe2,
  Mic2,
  Sparkles,
  WandSparkles,
} from 'lucide-react';
import { BrandLogo } from '../../../components/BrandLogo';
import { LANGUAGES } from '../../../constants';
import { APP_ROUTE_PATHS, resolveLoginPath } from '../../app/navigation';
import { LegalLinks } from '../legal/LegalLinks';

const languageCount = LANGUAGES.length;
const signupHref = resolveLoginPath('signup', APP_ROUTE_PATHS.main);

const proofRail = [
  {
    value: `${languageCount}+`,
    label: 'configured languages',
    detail: 'One product lane for multilingual launches and alternate-market voice releases.',
  },
  {
    value: 'Studio',
    label: 'direction-first generation',
    detail: 'Shape tone, pacing, and emotional intent before the first final render.',
  },
  {
    value: 'Clone',
    label: 'signature voice capture',
    detail: 'Bring reference voices into the workflow without splitting tools or tabs.',
  },
  {
    value: 'Reader',
    label: 'review before release',
    detail: 'Move from script to playable review and polish in the same workspace.',
  },
] as const;

const workflowSteps = [
  {
    step: '01',
    title: 'Direct the scene while it still feels alive.',
    body:
      'Start from the studio, set the emotional temperature, define pacing, and lock the performance before you waste time fixing flat first takes.',
  },
  {
    step: '02',
    title: 'Push the same project into dubbing, cloning, and language expansion.',
    body:
      'Carry the same creative intent into cloned voices, dubbed moments, and localized narration instead of rebuilding the production from scratch.',
  },
  {
    step: '03',
    title: 'Review, adjust, and launch from one controlled surface.',
    body:
      'Use the reader, runs, and billing surfaces as the finish lane so production handoff stays clean all the way to release.',
  },
] as const;

const surfaceRows = [
  {
    icon: Mic2,
    title: 'Studio generation',
    body: 'Generate, tune, and replay the take while the direction notes are still fresh.',
    href: APP_ROUTE_PATHS.studio,
    cta: 'Open Studio',
  },
  {
    icon: WandSparkles,
    title: 'Voices and cloning',
    body: 'Build a cast, clone signature tone, and keep character identity tight across scenes.',
    href: APP_ROUTE_PATHS.voices,
    cta: 'Open Voices',
  },
  {
    icon: BookOpen,
    title: 'Reader review',
    body: 'Listen through the final experience, not just the raw render, before you ship.',
    href: APP_ROUTE_PATHS.reader,
    cta: 'Open Reader',
  },
  {
    icon: Globe2,
    title: 'Plans and billing',
    body: 'Keep pricing, credits, and checkout on a clean public billing surface when it is time to scale.',
    href: '/billing',
    cta: 'View Billing',
  },
] as const;

const marqueeItems = [
  'Product trailers',
  'Launch films',
  'Explainer voiceovers',
  'Dub passes',
  'Character voices',
  'Reader review',
  'Audiobook scenes',
  'Training content',
  'Support scripts',
  'Performance clones',
] as const;

const stagePills = ['Voice direction', 'Dub passes', 'Cloned tone', 'Reader review'] as const;

const stageMetrics = [
  {
    label: 'Current scene',
    value: 'Launch narration locked',
  },
  {
    label: 'Direction stack',
    value: 'Warm, assured, cinematic',
  },
  {
    label: 'Release lane',
    value: 'Voiceover, dub, clone, review',
  },
] as const;

const waveformHeights = ['30%', '54%', '42%', '76%', '58%', '88%', '66%', '52%', '78%', '44%', '62%', '90%'];

const navLinks = [
  { label: 'Workflow', href: '#workflow' },
  { label: 'Surfaces', href: '#surfaces' },
  { label: 'Pricing', href: '#pricing' },
] as const;

export function MarketingLanding() {
  return (
    <div
      className="vf-marketing-shell vf-theme-dark relative isolate min-h-screen overflow-x-hidden text-slate-100"
      data-testid="marketing-landing"
      data-vf-brand-theme="aurora"
    >
      <div className="vf-marketing-backdrop" aria-hidden="true" />
      <div className="vf-marketing-grid" aria-hidden="true" />
      <div className="vf-marketing-spotlight vf-marketing-spotlight-a" aria-hidden="true" />
      <div className="vf-marketing-spotlight vf-marketing-spotlight-b" aria-hidden="true" />

      <header className="fixed inset-x-0 top-0 z-50">
        <div className="mx-auto flex w-full max-w-7xl items-center justify-between gap-4 px-4 py-4 sm:px-6 lg:px-8">
          <a
            href="/"
            className="rounded-full border border-white/10 bg-black/[0.25] px-3 py-2 backdrop-blur-xl"
            aria-label="V FLOW AI home"
          >
            <BrandLogo size="sm" tone="light" />
          </a>
          <nav
            className="hidden items-center gap-1 rounded-full border border-white/10 bg-black/[0.2] px-2 py-1 backdrop-blur-xl md:flex"
            aria-label="Landing sections"
          >
            {navLinks.map((link) => (
              <a
                key={link.href}
                href={link.href}
                className="rounded-full px-4 py-2 text-sm font-medium text-slate-300 transition-colors hover:text-white"
              >
                {link.label}
              </a>
            ))}
          </nav>
          <div className="flex items-center gap-2">
            <a
              href="/billing"
              className="hidden rounded-full border border-white/[0.12] px-4 py-2 text-sm font-medium text-slate-200 transition-colors hover:border-white/[0.24] hover:text-white sm:inline-flex"
            >
              Pricing
            </a>
            <a
              href={signupHref}
              className="inline-flex items-center gap-2 rounded-full bg-white px-4 py-2 text-sm font-semibold text-slate-950 shadow-[0_14px_32px_rgba(255,255,255,0.18)] transition-transform hover:-translate-y-0.5"
              data-testid="hero-primary-cta"
            >
              Start free
              <ArrowRight size={16} />
            </a>
          </div>
        </div>
      </header>

      <main>
        <section className="relative overflow-hidden px-4 pb-16 pt-28 sm:px-6 sm:pt-32 lg:px-8 lg:pb-20">
          <div className="mx-auto grid min-h-[calc(100svh-7rem)] w-full max-w-7xl items-end gap-12 lg:grid-cols-[minmax(0,0.98fr)_minmax(25rem,1.02fr)] lg:gap-16">
            <div className="max-w-3xl self-center">
              <p className="animate-fade-in-up text-xs font-semibold uppercase tracking-[0.24em] text-cyan-200">
                V FLOW AI
              </p>
              <h1 className="animate-fade-in-up mt-5 text-4xl font-black leading-[0.94] text-white sm:text-6xl lg:text-[5.4rem]">
                Make every line feel <span className="font-serif text-cyan-100">directed</span>, lit, and ready to
                release.
              </h1>
              <p className="animate-fade-in-up mt-6 max-w-2xl text-base leading-8 text-slate-300 sm:text-lg">
                A premium AI voice studio for voiceovers, cloned performances, dub passes, and review-ready listening
                flows. One calm surface. One creative lane. No stitched-together production stack.
              </p>
              <div className="animate-fade-in-up mt-8 flex flex-wrap items-center gap-3">
                <a
                  href={signupHref}
                  className="inline-flex items-center gap-2 rounded-full bg-white px-6 py-3 text-sm font-semibold text-slate-950 shadow-[0_14px_34px_rgba(255,255,255,0.16)] transition-transform hover:-translate-y-0.5"
                >
                  Start free
                  <ArrowRight size={16} />
                </a>
                <a
                  href={APP_ROUTE_PATHS.main}
                  className="inline-flex items-center gap-2 rounded-full border border-white/[0.12] bg-white/[0.04] px-6 py-3 text-sm font-medium text-slate-100 backdrop-blur-sm transition-colors hover:border-white/[0.24] hover:bg-white/[0.08]"
                >
                  Enter the workspace
                </a>
                <a
                  href="/billing"
                  className="inline-flex items-center gap-2 rounded-full border border-cyan-400/[0.25] px-6 py-3 text-sm font-medium text-cyan-100 transition-colors hover:border-cyan-300/[0.4] hover:text-white"
                >
                  View plans
                </a>
              </div>
              <div className="animate-fade-in-up mt-8 flex flex-wrap gap-2" aria-label="Feature highlights">
                {[
                  'Direction-first generation',
                  'Voice cloning and dubbing',
                  `${languageCount}+ configured languages`,
                ].map((item) => (
                  <span
                    key={item}
                    className="inline-flex items-center rounded-full border border-white/10 bg-white/5 px-3 py-2 text-xs font-medium text-slate-200 backdrop-blur"
                  >
                    {item}
                  </span>
                ))}
              </div>
            </div>

            <div className="animate-fade-in-up self-center" data-testid="hero-stage">
              <div className="vf-marketing-stage relative overflow-hidden rounded-[2.2rem] p-5 sm:p-7">
                <div className="relative z-[1] flex items-center justify-between gap-3">
                  <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.08] px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-cyan-100">
                    <Sparkles size={13} />
                    Premium AI voice studio
                  </span>
                  <span className="rounded-full border border-emerald-400/[0.18] bg-emerald-400/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-200">
                    Live stage
                  </span>
                </div>

                <div className="relative z-[1] mt-8 grid gap-8 lg:grid-cols-[15rem_minmax(0,1fr)] lg:items-center">
                  <div className="flex items-center justify-center">
                    <div className="rounded-full border border-white/10 bg-white/[0.04] p-2 shadow-[0_24px_70px_rgba(15,23,42,0.45)]">
                      <div className="scale-[0.62] sm:scale-[0.74] lg:scale-[0.92]">
                        <BrandLogo size="hero" tone="light" showWordmark={false} />
                      </div>
                    </div>
                  </div>

                  <div>
                    <div className="flex flex-wrap gap-2">
                      {stagePills.map((pill) => (
                        <span
                          key={pill}
                          className="inline-flex items-center rounded-full border border-white/10 bg-black/[0.2] px-3 py-1.5 text-[11px] font-medium uppercase tracking-[0.16em] text-slate-200"
                        >
                          {pill}
                        </span>
                      ))}
                    </div>

                    <div className="mt-5 rounded-[1.75rem] border border-white/10 bg-black/[0.22] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
                      <div className="flex items-end gap-1.5 sm:gap-2" aria-hidden="true">
                        {waveformHeights.map((height, index) => (
                          <span
                            key={`${height}-${index}`}
                            className="vf-marketing-wave-bar flex-1 rounded-full bg-[linear-gradient(180deg,rgba(255,255,255,0.95)_0%,rgba(124,58,237,0.88)_52%,rgba(34,211,238,0.72)_100%)]"
                            style={{
                              height,
                              animationDelay: `${index * 120}ms`,
                            }}
                          />
                        ))}
                      </div>

                      <div className="mt-5 grid gap-3 sm:grid-cols-3">
                        {stageMetrics.map((metric) => (
                          <div
                            key={metric.label}
                            className="rounded-[1.1rem] border border-white/10 bg-white/[0.03] px-4 py-3"
                          >
                            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">
                              {metric.label}
                            </p>
                            <p className="mt-2 text-sm font-semibold text-white">{metric.value}</p>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="mt-4 rounded-[1.5rem] border border-white/10 bg-black/[0.18] p-4">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-cyan-100">
                        Current cue
                      </p>
                      <p className="mt-3 text-sm leading-7 text-slate-200">
                        Roll the opening narration with warmth, authority, and a crisp handoff into the dubbed product
                        sequence. Keep the delivery premium, clear, and film-trailer tight.
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="px-4 pb-6 sm:px-6 lg:px-8">
          <div className="mx-auto w-full max-w-7xl overflow-hidden rounded-[1.8rem] border border-white/10 bg-black/[0.18] backdrop-blur-xl">
            <div className="grid divide-y divide-white/10 md:grid-cols-4 md:divide-x md:divide-y-0">
              {proofRail.map((item) => (
                <div key={item.label} className="p-5 sm:p-6">
                  <p className="text-3xl font-black text-white">{item.value}</p>
                  <p className="mt-2 text-xs font-semibold uppercase tracking-[0.18em] text-cyan-200">{item.label}</p>
                  <p className="mt-3 text-sm leading-7 text-slate-300">{item.detail}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="px-4 py-8 sm:px-6 lg:px-8">
          <div className="mx-auto w-full max-w-7xl overflow-hidden rounded-full border border-white/10 bg-white/[0.04]">
            <div className="vf-marketing-marquee flex w-max items-center gap-4 px-5 py-3">
              {[...marqueeItems, ...marqueeItems].map((item, index) => (
                <span
                  key={`${item}-${index}`}
                  className="inline-flex items-center gap-3 whitespace-nowrap text-sm font-medium text-slate-200"
                >
                  <span className="h-1.5 w-1.5 rounded-full bg-cyan-300" />
                  {item}
                </span>
              ))}
            </div>
          </div>
        </section>

        <section id="workflow" className="scroll-mt-32 px-4 py-14 sm:px-6 lg:px-8">
          <div className="mx-auto grid w-full max-w-7xl gap-10 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] lg:gap-16">
            <div className="max-w-xl">
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-cyan-200">Workflow</p>
              <h2 className="mt-4 text-3xl font-black leading-tight text-white sm:text-5xl">
                Built for production teams that want fewer tools and better takes.
              </h2>
              <p className="mt-5 text-base leading-8 text-slate-300">
                This is not a pile of disconnected generators. It is a single lane for directing, cloning, reviewing,
                localizing, and shipping voice work with the same creative thread still intact.
              </p>
              <a
                href={APP_ROUTE_PATHS.main}
                className="mt-8 inline-flex items-center gap-2 rounded-full border border-white/[0.12] px-5 py-3 text-sm font-medium text-slate-100 transition-colors hover:border-white/[0.22] hover:text-white"
              >
                Explore the workspace
                <ArrowRight size={16} />
              </a>
            </div>

            <div className="border-t border-white/10">
              {workflowSteps.map((item) => (
                <article
                  key={item.step}
                  className="grid gap-4 border-b border-white/10 py-7 sm:grid-cols-[5rem_minmax(0,1fr)] sm:gap-6"
                >
                  <p className="font-serif text-5xl leading-none text-white/85">{item.step}</p>
                  <div>
                    <h3 className="text-2xl font-semibold leading-tight text-white">{item.title}</h3>
                    <p className="mt-3 max-w-2xl text-sm leading-7 text-slate-300">{item.body}</p>
                  </div>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section id="surfaces" className="scroll-mt-32 px-4 py-14 sm:px-6 lg:px-8">
          <div className="mx-auto w-full max-w-7xl rounded-[2.2rem] border border-white/10 bg-white/[0.04] p-5 sm:p-7 lg:p-9">
            <div className="grid gap-8 lg:grid-cols-[minmax(0,1.1fr)_minmax(19rem,0.9fr)] lg:gap-12">
              <div>
                <p className="inline-flex items-center gap-2 rounded-full border border-white/10 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-cyan-100">
                  <AudioLines size={13} />
                  Live direction desk
                </p>
                <h2 className="mt-4 text-3xl font-black text-white sm:text-4xl">
                  One premium control surface for scripts, cues, playback, and release.
                </h2>
                <p className="mt-4 max-w-2xl text-sm leading-7 text-slate-300">
                  Build the take in studio, push it into voices and cloning, check the listening flow in reader, then
                  scale with plans and credits on the dedicated public billing route.
                </p>

                <div className="vf-brand-card mt-8 rounded-[1.8rem] p-5 sm:p-6">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-cyan-100">
                        Scene board
                      </p>
                      <p className="mt-2 text-xl font-semibold text-white">Launch film, hero cut, Hindi alternate ready</p>
                    </div>
                    <span className="rounded-full border border-white/10 bg-black/[0.2] px-3 py-1.5 text-[11px] font-medium uppercase tracking-[0.16em] text-slate-200">
                      Calm pressure, fast control
                    </span>
                  </div>

                  <div className="mt-6 grid gap-4 lg:grid-cols-[minmax(0,1.05fr)_minmax(16rem,0.95fr)]">
                    <div className="rounded-[1.5rem] border border-white/10 bg-black/[0.18] p-4">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">Direction notes</p>
                      <div className="mt-4 space-y-3 text-sm leading-7 text-slate-200">
                        <p className="rounded-[1.1rem] border border-white/8 bg-white/[0.03] px-4 py-3">
                          Open with authority, keep the phrasing bright, then soften into the product promise.
                        </p>
                        <p className="rounded-[1.1rem] border border-white/8 bg-white/[0.03] px-4 py-3">
                          Duplicate the scene for the alternate market and keep the same energy curve through the handoff.
                        </p>
                      </div>
                    </div>

                    <div className="rounded-[1.5rem] border border-white/10 bg-black/[0.18] p-4">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">Active stack</p>
                      <ul className="mt-4 space-y-3 text-sm text-slate-200">
                        {[
                          'Emotion: warm cinematic confidence',
                          'Cast: hero voice plus alternate dub lane',
                          `Languages: ${languageCount}+ configured options`,
                          'Finish: reader review before publish',
                        ].map((line) => (
                          <li key={line} className="rounded-[1rem] border border-white/8 bg-white/[0.03] px-4 py-3">
                            {line}
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                </div>
              </div>

              <div className="flex flex-col justify-between gap-6">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.22em] text-cyan-200">Core surfaces</p>
                  <div className="mt-4 divide-y divide-white/10 border-y border-white/10">
                    {surfaceRows.map((row) => {
                      const Icon = row.icon;
                      return (
                        <article key={row.title} className="py-5">
                          <div className="flex items-start gap-4">
                            <span className="mt-1 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/[0.05] text-cyan-100">
                              <Icon size={18} />
                            </span>
                            <div>
                              <h3 className="text-lg font-semibold text-white">{row.title}</h3>
                              <p className="mt-2 text-sm leading-7 text-slate-300">{row.body}</p>
                              <a
                                href={row.href}
                                className="mt-3 inline-flex items-center gap-2 text-sm font-medium text-cyan-100 transition-colors hover:text-white"
                              >
                                {row.cta}
                                <ArrowRight size={15} />
                              </a>
                            </div>
                          </div>
                        </article>
                      );
                    })}
                  </div>
                </div>

                <div id="pricing" className="scroll-mt-32 rounded-[1.7rem] border border-cyan-300/[0.14] bg-cyan-400/[0.08] p-5">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-cyan-100">Plans and scale</p>
                  <h3 className="mt-3 text-2xl font-semibold text-white">Pricing stays public. Checkout stays clean.</h3>
                  <p className="mt-3 text-sm leading-7 text-slate-200">
                    Review plans and credits on the billing surface first, then continue into the secure app buy flow
                    only when you are ready to commit.
                  </p>
                  <div className="mt-5 flex flex-wrap gap-3">
                    <a
                      href="/billing"
                      className="inline-flex items-center gap-2 rounded-full bg-white px-5 py-3 text-sm font-semibold text-slate-950 transition-transform hover:-translate-y-0.5"
                    >
                      Open billing
                      <ArrowRight size={16} />
                    </a>
                    <a
                      href="/legal/billing-refunds"
                      className="inline-flex items-center gap-2 rounded-full border border-white/[0.12] px-5 py-3 text-sm font-medium text-slate-100 transition-colors hover:border-white/[0.22] hover:text-white"
                    >
                      See billing terms
                    </a>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="px-4 py-14 sm:px-6 lg:px-8">
          <div className="mx-auto w-full max-w-7xl rounded-[2.4rem] border border-white/10 bg-[linear-gradient(135deg,rgba(6,12,27,0.95)_0%,rgba(15,23,42,0.88)_55%,rgba(21,33,62,0.94)_100%)] px-6 py-12 shadow-[0_36px_90px_rgba(2,6,23,0.45)] sm:px-8 lg:px-12">
            <div className="max-w-3xl">
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-cyan-200">Final cue</p>
              <h2 className="mt-4 text-3xl font-black leading-tight text-white sm:text-5xl">
                Open the studio and cut the first premium take.
              </h2>
              <p className="mt-5 text-base leading-8 text-slate-300">
                Start free, shape the scene, clone the voice if you need it, and move into review without leaving the
                product.
              </p>
              <div className="mt-8 flex flex-wrap gap-3">
                <a
                  href={signupHref}
                  className="inline-flex items-center gap-2 rounded-full bg-white px-6 py-3 text-sm font-semibold text-slate-950 transition-transform hover:-translate-y-0.5"
                >
                  Start free
                  <ArrowRight size={16} />
                </a>
                <a
                  href={APP_ROUTE_PATHS.main}
                  className="inline-flex items-center gap-2 rounded-full border border-white/[0.12] px-6 py-3 text-sm font-medium text-slate-100 transition-colors hover:border-white/[0.24] hover:text-white"
                >
                  Enter workspace
                </a>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-white/10 px-4 py-10 sm:px-6 lg:px-8">
        <div className="mx-auto grid w-full max-w-7xl gap-8 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
          <div>
            <BrandLogo size="md" tone="light" />
            <p className="mt-4 max-w-2xl text-sm leading-7 text-slate-400">
              V FLOW AI is a premium web studio for AI voice direction, dubbing, cloning, multilingual release, and
              review-ready listening flows.
            </p>
            <div className="mt-5 flex flex-wrap gap-4 text-sm text-slate-300">
              <a href={APP_ROUTE_PATHS.main} className="transition-colors hover:text-white">
                Workspace
              </a>
              <a href="/billing" className="transition-colors hover:text-white">
                Billing
              </a>
              <a href="/legal" className="transition-colors hover:text-white">
                Legal
              </a>
            </div>
          </div>

          <div className="max-w-xl">
            <LegalLinks className="justify-start lg:justify-end" linkClassName="vf-marketing-legal-link" />
          </div>
        </div>
      </footer>
    </div>
  );
}
