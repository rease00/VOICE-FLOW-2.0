'use client';

import { useState } from 'react';
import { BookOpen, ExternalLink } from 'lucide-react';
import { LandingCallToAction } from './LandingCallToAction';
import { MarketingAudioCard } from './MarketingAudioCard';
import type { LandingReaderProof } from './landingData';

interface LandingReaderViewProps {
  proof: LandingReaderProof;
}

const formatDurationLabel = (durationSec: number): string => {
  const safe = Number.isFinite(durationSec) && durationSec > 0 ? Math.round(durationSec) : 0;
  const minutes = Math.floor(safe / 60);
  const seconds = safe % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
};

const formatChapterLabel = (order: number): string => `Chapter ${String(Math.max(order, 1)).padStart(2, '0')}`;

export function LandingReaderView({ proof }: LandingReaderViewProps) {
  const fallbackChapter = proof.virtualBook.chapters[0];
  const [activeChapterId, setActiveChapterId] = useState(() => fallbackChapter?.id || '');
  const activeChapter = proof.virtualBook.chapters.find((chapter) => chapter.id === activeChapterId) || fallbackChapter;

  if (!activeChapter) {
    return null;
  }

  return (
    <>
      <section className="lp-page lp-page--detail" data-testid="landing-reader-playback">
        <div className="lp-section">
          <div className="lp-section-head lp-page__intro" data-vf-reveal>
            <p className="lp-eyebrow"><BookOpen size={13} /> Reader Review</p>
            <h1 className="lp-section-title">Close the loop with a quieter review surface built for final listening.</h1>
            <p className="lp-section-sub">
              The reader view keeps progress, units, and the active listening pass visible without forcing the team back into a crowded production layout.
            </p>
          </div>
          <div className="lp-reader-deck">
            <aside className="lp-reader-rail lp-reveal-delay-140" data-vf-reveal>
              <div className="lp-reader-head lp-reader-head--rail">
                <div>
                  <p className="lp-reader-kicker">
                    {proof.modeLabel}
                  </p>
                  <h3 className="lp-reader-heading">
                    {proof.title}
                  </h3>
                </div>
                <span className="lp-reader-unit__status">{proof.progressLabel}</span>
              </div>
              {proof.units.map((unit) => (
                <div key={unit.id} className="lp-reader-unit">
                  <div className="lp-reader-unit__head">
                    <p className="lp-reader-unit__title">{unit.title}</p>
                    <span className="lp-reader-unit__status">{unit.status}</span>
                  </div>
                  <p className="lp-reader-unit__body">{unit.body}</p>
                </div>
              ))}
            </aside>
            <section className="lp-reader-stage lp-reveal-delay-220" data-vf-reveal>
              <div className="lp-reader-head lp-reader-head--stage">
                <div>
                  <p className="lp-reader-kicker">
                    {proof.coverLabel}
                  </p>
                  <h3 className="lp-reader-heading">
                    {proof.activeTitle}
                  </h3>
                </div>
                <span className="lp-reader-unit__status lp-reader-unit__status--active">
                  {proof.activeStatus}
                </span>
              </div>
              <div className="lp-reader-cover">
                <p className="lp-reader-cover__eyebrow">
                  Final listening pass
                </p>
                <p className="lp-reader-cover__body">
                  Lock the approved scenes, keep the current unit in view, and hand the team a calmer review step.
                </p>
              </div>

              <section className="lp-reader-virtual-book" data-testid="landing-reader-virtual-book" aria-label="Virtual reader book demo">
                <div className="lp-reader-virtual-book__head">
                  <p className="lp-reader-virtual-book__eyebrow">Virtual demo book</p>
                  <h4 className="lp-reader-virtual-book__title">{proof.virtualBook.title}</h4>
                  <p className="lp-reader-virtual-book__meta">
                    By {proof.virtualBook.author} · {proof.virtualBook.totalChapters} chapters
                  </p>
                </div>
                <p className="lp-reader-virtual-book__description">{proof.virtualBook.description}</p>

                <div className="lp-reader-virtual-book__tabs" aria-label={`${proof.virtualBook.title} chapters`}>
                  {proof.virtualBook.chapters.map((chapter) => {
                    const isActive = chapter.id === activeChapter.id;
                    return (
                      <button
                        key={chapter.id}
                        type="button"
                        aria-label={`Open ${chapter.title}`}
                        data-active={isActive ? 'true' : 'false'}
                        data-chapter-audio={chapter.audioSrc}
                        className={`lp-reader-virtual-book__tab${isActive ? ' is-active' : ''}`}
                        onClick={() => setActiveChapterId(chapter.id)}
                      >
                        {formatChapterLabel(chapter.order)}
                      </button>
                    );
                  })}
                </div>

                <div className="lp-reader-virtual-book__panel" aria-label={`${activeChapter.title} preview`}>
                  <img
                    className="lp-reader-virtual-book__cover"
                    src={proof.virtualBook.coverSrc}
                    alt={`${proof.virtualBook.title} cover`}
                    loading="lazy"
                  />
                  <div className="lp-reader-virtual-book__panel-copy">
                    <p className="lp-reader-virtual-book__chapter-kicker">
                      {formatChapterLabel(activeChapter.order)} / {proof.virtualBook.totalChapters}
                    </p>
                    <h5 className="lp-reader-virtual-book__chapter-title">{activeChapter.title}</h5>
                    <p className="lp-reader-virtual-book__chapter-summary">{activeChapter.summary}</p>

                    <MarketingAudioCard
                      className="lp-reader-virtual-book__card"
                      variant="hero"
                      eyebrow={`${proof.virtualBook.language} / ${proof.virtualBook.locale}`}
                      title={activeChapter.title}
                      summary={activeChapter.summary}
                      audioSrc={activeChapter.audioSrc}
                      ariaLabel={`${activeChapter.title} audio chapter`}
                      note={`${activeChapter.cue} · ${formatDurationLabel(activeChapter.durationSec)}`}
                      badges={[
                        { label: formatChapterLabel(activeChapter.order), tone: 'neutral' },
                        { label: proof.virtualBook.locale, tone: 'accent' },
                      ]}
                    />
                  </div>
                </div>
              </section>

              <section className="lp-reader-sample" data-testid="landing-reader-sample" aria-label="Reader sample preview">
                <img
                  className="lp-reader-sample__poster"
                  src={proof.sample.posterSrc}
                  alt={`${proof.sample.title} poster`}
                  loading="lazy"
                />
                <MarketingAudioCard
                  className="lp-reader-sample__card"
                  variant="hero"
                  eyebrow={`${proof.sample.language} / ${proof.sample.locale}`}
                  title={proof.sample.title}
                  summary={proof.sample.summary}
                  audioSrc={proof.sample.audioSrc}
                  ariaLabel={`${proof.sample.title} audio sample`}
                  note={`${proof.sample.cue} · ${formatDurationLabel(proof.sample.durationSec)}`}
                  badges={[
                    { label: 'Reader sample', tone: 'neutral' },
                    { label: proof.sample.locale, tone: 'accent' },
                  ]}
                />
                <a className="lp-btn-secondary lp-reader-sample__link" href="/app/library">
                  Open Reader in App <ExternalLink size={15} />
                </a>
              </section>
            </section>
          </div>
        </div>
      </section>

      <LandingCallToAction
        kicker="Production ready"
        title="Voice Flow's full studio picks up when the public tour has shown you the right lane."
        body="From here, the next step is the real workspace: generate, direct, compare, and ship from one place."
        primaryHref="/app/library"
        primaryLabel="Open Reader in App"
        secondaryHref="/app/studio"
        secondaryLabel="Open Studio"
      />
    </>
  );
}
