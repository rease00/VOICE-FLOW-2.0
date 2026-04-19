'use client';

import { useState } from 'react';
import type { CSSProperties } from 'react';
import {
  ArrowRight,
  AudioLines,
  Brain,
  Copy,
  Mic2,
  Play,
  WandSparkles,
} from 'lucide-react';
import { MarketingAudioCard } from './MarketingAudioCard';
import type {
  LandingSingleSpeakerDemo,
  LandingMultiSpeakerDemo,
  LandingVoiceCloneProof,
  LandingDirectorProof,
} from './landingData';

/* ─── Tab keys ───────────────────────────────────────────────────────────── */

export const DEMO_TAB_KEYS = [
  'single-voice',
  'prime-scenes',
  'clone-proof',
  'direction',
] as const;
export type DemoTabKey = (typeof DEMO_TAB_KEYS)[number];

const demoTabs = [
  { key: 'single-voice' as DemoTabKey, label: 'Single Voice', icon: <Mic2 size={14} /> },
  { key: 'prime-scenes' as DemoTabKey, label: 'Prime Scenes', icon: <WandSparkles size={14} /> },
  { key: 'clone-proof'  as DemoTabKey, label: 'Clone Proof',  icon: <Copy size={14} /> },
  { key: 'direction'    as DemoTabKey, label: 'AI Direction', icon: <Brain size={14} /> },
] as const;

/* ─── Props ──────────────────────────────────────────────────────────────── */

interface LandingDemoTabsProps {
  initialTab?: DemoTabKey;
  singleSpeakerDemos: readonly LandingSingleSpeakerDemo[];
  multiSpeakerDemos:  readonly LandingMultiSpeakerDemo[];
  voiceCloneProof:    LandingVoiceCloneProof;
  directorProof:      LandingDirectorProof;
}

/* ─── Component ──────────────────────────────────────────────────────────── */

export function LandingDemoTabs({
  initialTab = 'single-voice',
  singleSpeakerDemos,
  multiSpeakerDemos,
  voiceCloneProof,
  directorProof,
}: LandingDemoTabsProps) {
  const [activeTab, setActiveTab] = useState<DemoTabKey>(initialTab);

  return (
    <>
      {/* Tab bar */}
      <div
        className="lp-tabs"
        role="tablist"
        aria-label="Demo categories"
        data-testid="landing-tab-bar"
        data-vf-reveal
        style={{ '--vf-marketing-delay': '100ms' } as CSSProperties}
      >
        {demoTabs.map((tab) => (
          <button
            key={tab.key}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.key}
            aria-controls={`demo-panel-${tab.key}`}
            id={`demo-tab-${tab.key}`}
            className={`lp-tab${activeTab === tab.key ? ' is-active' : ''}`}
            onClick={() => setActiveTab(tab.key)}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </div>

      {/* ── Single voice ─────────────────────────────────────────────── */}
      <div
        id="demo-panel-single-voice"
        role="tabpanel"
        aria-labelledby="demo-tab-single-voice"
        data-testid="landing-single-speaker"
        className={`lp-tab-panel${activeTab === 'single-voice' ? ' is-active' : ''}`}
      >
        <div className="lp-demos__intro" data-vf-reveal style={{ '--vf-marketing-delay': '160ms' } as CSSProperties}>
          <p className="lp-eyebrow"><Mic2 size={13} /> Single Voice</p>
          <h2 className="lp-section-title" style={{ fontSize: 'clamp(1.6rem, 2.5vw, 2.4rem)', marginBottom: '0.5rem' }}>
            Fast reads, cleaner review.
          </h2>
          <p className="lp-section-sub" style={{ textAlign: 'left', maxWidth: '36rem' }}>
            Compact voice checks with shorter copy, calmer visuals, and controls that stay readable on smaller screens.
          </p>
        </div>
        <div className="lp-audio-grid">
          {singleSpeakerDemos.map((demo, i) => (
            <MarketingAudioCard
              key={demo.id}
              eyebrow={`${demo.language} / ${demo.market}`}
              title={demo.title}
              summary={demo.summary}
              audioSrc={demo.audioSrc}
              ariaLabel={`${demo.title} preview`}
              motionDelayMs={200 + i * 80}
              badges={[
                { label: 'Single voice', tone: 'neutral' },
                { label: demo.language, tone: 'warm' },
              ]}
              note={demo.cue}
            />
          ))}
        </div>
      </div>

      {/* ── Prime scenes ─────────────────────────────────────────────── */}
      <div
        id="demo-panel-prime-scenes"
        role="tabpanel"
        aria-labelledby="demo-tab-prime-scenes"
        data-testid="landing-multi-speaker"
        className={`lp-tab-panel${activeTab === 'prime-scenes' ? ' is-active' : ''}`}
      >
        <div className="lp-demos__intro" data-vf-reveal style={{ '--vf-marketing-delay': '160ms' } as CSSProperties}>
          <p className="lp-eyebrow"><WandSparkles size={13} /> Prime Scenes</p>
          <h2 className="lp-section-title" style={{ fontSize: 'clamp(1.6rem, 2.5vw, 2.4rem)', marginBottom: '0.5rem' }}>
            Prime scenes in a tighter compare view.
          </h2>
          <p className="lp-section-sub" style={{ textAlign: 'left', maxWidth: '36rem' }}>
            Scene cards focused on cast contrast, playback, and pacing — without loading the page with extra chrome.
          </p>
        </div>
        <div className="lp-audio-grid">
          {multiSpeakerDemos.map((demo, i) => (
            <MarketingAudioCard
              key={demo.id}
              variant="scene"
              eyebrow={`${demo.scene} / ${demo.market}`}
              title={demo.title}
              summary={demo.summary}
              audioSrc={demo.audioSrc}
              ariaLabel={`${demo.title} preview`}
              motionDelayMs={200 + i * 80}
              badges={[
                { label: 'Prime', tone: 'accent' },
                { label: `${demo.cast.length} voices`, tone: 'neutral' },
              ]}
              cast={demo.cast}
              note={demo.cue}
            />
          ))}
        </div>
      </div>

      {/* ── Clone Proof ──────────────────────────────────────────────── */}
      <div
        id="demo-panel-clone-proof"
        role="tabpanel"
        aria-labelledby="demo-tab-clone-proof"
        data-testid="landing-voice-cloning"
        className={`lp-tab-panel${activeTab === 'clone-proof' ? ' is-active' : ''}`}
      >
        <div className="lp-demos__intro" data-vf-reveal style={{ '--vf-marketing-delay': '160ms' } as CSSProperties}>
          <p className="lp-eyebrow"><Copy size={13} /> Clone Proof</p>
          <h2 className="lp-section-title" style={{ fontSize: 'clamp(1.6rem, 2.5vw, 2.4rem)', marginBottom: '0.5rem' }}>
            Reference and render, clearly paired.
          </h2>
          <p className="lp-section-sub" style={{ textAlign: 'left', maxWidth: '36rem' }}>
            A two-card compare that keeps the approval decision grounded in the actual source and output.
          </p>
        </div>
        <div className="lp-clone-pair">
          <MarketingAudioCard
            eyebrow="Reference source"
            title={voiceCloneProof.source.label}
            summary="Original source used to guide the clone."
            audioSrc={voiceCloneProof.source.audioSrc}
            ariaLabel={`${voiceCloneProof.source.label} preview`}
            motionDelayMs={220}
            badges={[{ label: 'Reference', tone: 'neutral' }]}
            note={voiceCloneProof.source.name}
          />
          <MarketingAudioCard
            eyebrow="Rendered output"
            title={voiceCloneProof.rendered.label}
            summary="Rendered clone kept beside the source for fast approval."
            audioSrc={voiceCloneProof.rendered.audioSrc}
            ariaLabel={`${voiceCloneProof.rendered.label} preview`}
            motionDelayMs={320}
            badges={[{ label: 'Rendered clone', tone: 'accent' }]}
            note={voiceCloneProof.rendered.name}
          />
        </div>
      </div>

      {/* ── AI Direction ─────────────────────────────────────────────── */}
      <div
        id="demo-panel-direction"
        role="tabpanel"
        aria-labelledby="demo-tab-direction"
        data-testid="landing-ai-director"
        className={`lp-tab-panel${activeTab === 'direction' ? ' is-active' : ''}`}
      >
        <div className="lp-demos__intro" data-vf-reveal style={{ '--vf-marketing-delay': '160ms' } as CSSProperties}>
          <p className="lp-eyebrow"><AudioLines size={13} /> AI Director</p>
          <h2 className="lp-section-title" style={{ fontSize: 'clamp(1.6rem, 2.5vw, 2.4rem)', marginBottom: '0.5rem' }}>
            Paste any story. Get a directed script.
          </h2>
          <p className="lp-section-sub" style={{ textAlign: 'left', maxWidth: '36rem' }}>
            Write your story in the editor, press AI Director, and get a fully directed multi-speaker script with emotion tags and cast metadata.
          </p>
        </div>
        <div className="lp-direction-panel">
          <div
            className="lp-direction-block"
            data-testid="landing-ai-director-prompt"
            data-vf-reveal
            style={{ '--vf-marketing-delay': '220ms' } as CSSProperties}
          >
            <p className="lp-direction-block__label">What you write</p>
            <pre>{directorProof.before}</pre>
          </div>
          <div className="lp-direction-block" data-vf-reveal style={{ '--vf-marketing-delay': '320ms' } as CSSProperties}>
            <p className="lp-direction-block__label">What AI Director outputs</p>
            <div className="lp-before-after">
              <div className="lp-ba-item lp-ba-item--after">
                <p className="lp-ba-label">Directed script</p>
                <p className="lp-ba-text">{directorProof.after}</p>
              </div>
            </div>
            <div style={{ marginTop: '1.25rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              {directorProof.bullets.map((bullet, index) => (
                <div key={`director-bullet-${index}-${bullet.label}`} style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
                  <span style={{ color: 'var(--lp-accent, #38e8d0)', fontSize: '0.72rem', fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase' }}>
                    {bullet.label}
                  </span>
                  <span style={{ color: 'rgba(203,213,225,0.78)', fontSize: '0.88rem', lineHeight: 1.65 }}>
                    {bullet.value}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

    </>
  );
}
