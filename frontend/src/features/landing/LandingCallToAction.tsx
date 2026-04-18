import { ArrowRight } from 'lucide-react';

interface LandingCallToActionProps {
  kicker: string;
  title: string;
  body: string;
  primaryHref?: string;
  primaryLabel?: string;
  secondaryHref?: string;
  secondaryLabel?: string;
}

export function LandingCallToAction({
  kicker,
  title,
  body,
  primaryHref = '/app/studio',
  primaryLabel = 'Open Studio',
  secondaryHref = '/billing',
  secondaryLabel = 'View pricing',
}: LandingCallToActionProps) {
  return (
    <section className="lp-final-cta" data-vf-reveal>
      <div className="lp-section">
        <div className="lp-final-cta__panel">
          <p className="lp-final-cta__kicker">{kicker}</p>
          <h2 className="lp-final-cta__title">{title}</h2>
          <p className="lp-final-cta__body">{body}</p>
          <div className="lp-final-cta__actions">
            <a href={primaryHref} className="lp-btn-primary">
              {primaryLabel} <ArrowRight size={16} />
            </a>
            <a href={secondaryHref} className="lp-btn-secondary">{secondaryLabel}</a>
          </div>
          <p className="lp-final-cta__note">No credit card required to explore the public tour.</p>
        </div>
      </div>
    </section>
  );
}
