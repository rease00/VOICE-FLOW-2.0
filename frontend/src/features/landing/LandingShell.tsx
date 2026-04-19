import type { ReactNode } from 'react';
import { ArrowRight, MoveDownRight } from 'lucide-react';
import { BrandLogo } from '../../../components/BrandLogo';
import { APP_ROUTE_PATHS, resolveLoginPath } from '../../app/navigation';
import {
  SIGNUP_DISABLED_MARKETING_DETAIL,
  SIGNUP_DISABLED_MARKETING_HEADLINE,
} from '../../shared/auth/signupLock';
import { LegalLinks } from '../legal/LegalLinks';
import {
  LANDING_HEADER_TABS,
  type LandingNextAction,
  type LandingPageVariant,
} from './landingTabs';

const loginHref = resolveLoginPath('login', APP_ROUTE_PATHS.studio);

interface LandingShellProps {
  activePage: LandingPageVariant;
  nextAction: LandingNextAction;
  children: ReactNode;
}

export function LandingShell({ activePage, nextAction, children }: LandingShellProps) {
  return (
    <div
      className="lp-shell"
      data-testid="marketing-landing"
      data-vf-brand-theme="aurora"
      data-active-page={activePage}
    >
      <a className="lp-skip" href="#main-content">Skip to main content</a>

      <div className="lp-bg-grid" aria-hidden="true" />
      <div className="lp-spotlight lp-spotlight--a" aria-hidden="true" />
      <div className="lp-spotlight lp-spotlight--b" aria-hidden="true" />
      <div className="lp-spotlight lp-spotlight--c" aria-hidden="true" />

      <header className="lp-header" data-vf-reveal>
        <div className="lp-header__inner">
          <a href="/landing" className="lp-header__brand" aria-label="V FLOW AI home">
            <BrandLogo size="sm" tone="light" />
          </a>

          <nav
            className="lp-header__tabs"
            aria-label="Landing pages"
            data-testid="landing-tab-bar"
          >
            {LANDING_HEADER_TABS.map((tab) => {
              const isActive = tab.key === activePage;
              return (
                <a
                  key={tab.key}
                  href={tab.href}
                  className={`lp-header__tab${isActive ? ' is-active' : ''}`}
                  aria-current={isActive ? 'page' : undefined}
                >
                  {tab.label}
                </a>
              );
            })}
          </nav>

          <div className="lp-header__actions">
            <a href="/billing" className="lp-header__secondary">Pricing</a>
            <a href={loginHref} className="lp-btn-primary" data-testid="hero-primary-cta">
              Sign in <ArrowRight size={16} />
            </a>
          </div>
        </div>
      </header>

      <main id="main-content">
        <section className="lp-section pt-6 sm:pt-8" data-testid="landing-signup-paused">
          <div className="rounded-[1.4rem] border border-amber-300/20 bg-amber-400/10 px-5 py-4 text-sm leading-7 text-amber-50 shadow-[0_18px_44px_rgba(15,23,42,0.18)]">
            <p className="font-semibold">{SIGNUP_DISABLED_MARKETING_HEADLINE}</p>
            <p className="mt-1 text-amber-100/90">{SIGNUP_DISABLED_MARKETING_DETAIL}</p>
          </div>
        </section>

        {children}

        <section className="lp-next-nav" data-testid="landing-next-nav">
          <div className="lp-section">
            <a href={nextAction.href} className="lp-next-nav__link" data-vf-reveal>
              <span className="lp-next-nav__text">
                <span className="lp-next-nav__kicker">{nextAction.kicker}</span>
                <span className="lp-next-nav__label">{nextAction.label}</span>
              </span>
              <span className="lp-next-nav__icon" aria-hidden="true">
                <MoveDownRight size={22} />
              </span>
            </a>
          </div>
        </section>
      </main>

      <footer className="lp-footer" data-vf-reveal>
        <div className="lp-footer__inner">
          <div className="lp-footer__brand">
            <a href="/landing" aria-label="V FLOW AI home"><BrandLogo size="md" tone="light" /></a>
            <p className="lp-footer__tagline">
              Voice Flow keeps voice auditions, multi-speaker scenes, AI direction,
              and reader review moving in one clean production flow.
            </p>
          </div>
          <div>
            <p className="lp-footer__col-title">Explore</p>
            <nav className="lp-footer__links" aria-label="Explore links">
              {LANDING_HEADER_TABS.map((tab) => (
                <a key={tab.key} href={tab.href} className="lp-footer__link">{tab.label}</a>
              ))}
            </nav>
          </div>
          <div>
            <p className="lp-footer__col-title">Continue</p>
            <nav className="lp-footer__links" aria-label="Continue links">
              <a href="/billing" className="lp-footer__link">Pricing</a>
              <a href={APP_ROUTE_PATHS.studio} className="lp-footer__link">Studio</a>
              <a href={loginHref} className="lp-footer__link">Sign in</a>
            </nav>
          </div>
        </div>
        <div className="lp-footer__bottom">
          <p className="lp-footer__copy">© {new Date().getFullYear()} V FLOW AI. All rights reserved.</p>
          <LegalLinks className="justify-start lg:justify-end" linkClassName="lp-footer__link" />
        </div>
      </footer>
    </div>
  );
}
