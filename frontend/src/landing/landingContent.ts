import { LANGUAGES } from '../../constants';
import { BILLING_PLAN_ROWS, BILLING_TOKEN_PACK_ROWS } from '../features/billing/catalog';
import {
  UI_BRAND_THEME_CONFIGS,
  UI_BRAND_THEME_ORDER,
  type UiBrandThemeConfig,
  type UiBrandThemeId,
} from '../shared/theme/brandThemes';
import { VECTOR_DEMO_AUDIO_ENTRIES, type VectorDemoAudioEntry } from './vectorDemoAudioManifest';
import { VECTOR_MULTI_SPEAKER_DEMO_ENTRIES, type VectorMultiSpeakerDemoEntry } from './vectorMultiSpeakerDemoManifest';

const LANDING_SINGLE_DEMO_IDS = ['en-us', 'hi', 'es', 'fr', 'ar'] as const;

export type LandingThemeId = UiBrandThemeId;
export type LandingThemeConfig = UiBrandThemeConfig;

export interface LandingStatCard {
  label: string;
  value: string;
  detail: string;
}

export interface LandingFeatureItem {
  title: string;
  body: string;
  proof: string;
}

export interface LandingUseCaseItem {
  title: string;
  body: string;
}

export interface LandingPricingCard {
  name: string;
  price: string;
  credits: string;
  description: string;
  ctaHref: string;
  ctaLabel: string;
}

export interface LandingSingleSpeakerDemoCard {
  kind: 'single';
  id: string;
  title: string;
  useCase: string;
  speakerLabels: string[];
  language: string;
  emotionStyle: string;
  emotionCue: string;
  performanceCue: string;
  sampleScript: string;
  playbackConcept: string;
  audioSrc: string;
}

export interface LandingMultiSpeakerDemoCard {
  kind: 'multi';
  id: string;
  title: string;
  useCase: string;
  speakerLabels: string[];
  language: string;
  emotionStyle: string;
  emotionCue: string;
  performanceCue: string;
  sampleScript: string;
  playbackConcept: string;
  audioSrc: string;
}

export type LandingDemoCard = LandingSingleSpeakerDemoCard | LandingMultiSpeakerDemoCard;

const formatInr = (amount: number): string =>
  new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(Math.max(0, Number(amount || 0)));

const formatVf = (amount: number): string =>
  new Intl.NumberFormat('en-IN', {
    maximumFractionDigits: 0,
  }).format(Math.max(0, Number(amount || 0)));

const resolveSingleDemo = (id: string): VectorDemoAudioEntry => {
  const demo = VECTOR_DEMO_AUDIO_ENTRIES.find((entry) => entry.id === id);
  if (!demo) {
    throw new Error(`Landing single-speaker demo id \"${id}\" is missing from VECTOR_DEMO_AUDIO_ENTRIES.`);
  }
  return demo;
};

const summarizeSingleUseCase = (entry: VectorDemoAudioEntry): string => {
  const scenario = String(entry.scenario || '').trim();
  if (!scenario) return 'Narration';
  return scenario;
};

const summarizeMultiScript = (entry: VectorMultiSpeakerDemoEntry): string => {
  const firstLine = entry.lines[0]?.text?.trim();
  if (firstLine) return firstLine;
  return entry.translation;
};

const summarizeLineContext = (entry: VectorMultiSpeakerDemoEntry): string => {
  const roles = entry.lines
    .slice(0, 3)
    .map((line) => `${line.speaker} leads ${line.role.toLowerCase()}`)
    .join(', ');
  return roles || entry.castSummary;
};

export const LANDING_THEME_ORDER = UI_BRAND_THEME_ORDER;
export const LANDING_THEME_CONFIGS = UI_BRAND_THEME_CONFIGS;

export const LANDING_SOCIAL_PROOF: readonly LandingStatCard[] = [
  {
    label: 'Configured Languages',
    value: '83',
    detail: 'Catalog breadth verified from shared runtime language constants.',
  },
  {
    label: 'Bundled Single-Speaker Demos',
    value: '15',
    detail: 'Playable repo assets with scenario, emotion, style, and language mapping.',
  },
  {
    label: 'Bundled Multi-Speaker Demos',
    value: '5',
    detail: 'Cast-mapped demos with role handoffs and line-level scripts.',
  },
  {
    label: 'AI Director Workflow',
    value: 'Preview + Apply',
    detail: 'Prompt profile, diff preview, and controlled script apply flow in the studio.',
  },
] as const;

export const LANDING_FEATURES: readonly LandingFeatureItem[] = [
  {
    title: 'Studio-grade voice quality',
    body: 'Generate polished voice tracks that hold up in ads, explainers, long-form episodes, and launch assets.',
    proof: 'Grounded in bundled demo assets and the app generation pipeline.',
  },
  {
    title: 'Expressive emotional direction',
    body: 'Shape tone, pacing, intensity, and delivery style for cinematic, persuasive, intimate, or urgent moments.',
    proof: 'Emotion and style attributes are present in single-speaker demo manifests and runtime controls.',
  },
  {
    title: 'Single-speaker generation',
    body: 'Create one-voice narrations quickly for creators, support teams, training, and short-form content.',
    proof: '15 curated single-speaker demos with playable audio sources.',
  },
  {
    title: 'Multi-speaker orchestration',
    body: 'Map cast roles, preserve handoffs, and keep conversations easy to follow in multi-voice productions.',
    proof: '5 curated multi-speaker demos with cast summaries and line-level role data.',
  },
  {
    title: 'AI Directors',
    body: 'Use a direction layer to reshape intent before generation with side-by-side change review.',
    proof: 'Studio supports AI Director prompt profiles plus preview/apply controls.',
  },
  {
    title: 'Fast queue-driven workflow',
    body: 'Generate and monitor jobs with a production-friendly pipeline that supports chunked long-form output.',
    proof: 'Gateway and queue job surfaces are implemented in frontend + backend v2 routes.',
  },
  {
    title: 'Simple control surface',
    body: 'Keep scripts, cast, language choices, and generation controls in one focused studio layout.',
    proof: 'Main studio app includes cast controls, editor state, and generation options.',
  },
  {
    title: 'Studio + API-ready operations',
    body: 'Use the web studio for hands-on creation and pair with backend endpoints for product workflows.',
    proof: 'Public app route and backend generation endpoints are available in the codebase.',
  },
] as const;

export const LANDING_PRICING_CARDS: readonly LandingPricingCard[] = BILLING_PLAN_ROWS.map((plan) => ({
  name: plan.name,
  price: formatInr(plan.priceInr),
  credits: `${formatVf(plan.vfCredits)} VF credits`,
  description: 'Monthly subscription tier from the live Buy Center catalog.',
  ctaHref: '/app/buy?tab=subscription',
  ctaLabel: 'Choose Plan',
}));

export const LANDING_TOKEN_PACK_PROOF: readonly string[] = BILLING_TOKEN_PACK_ROWS.map(
  (pack) => `${pack.label}: ${formatVf(pack.vf)} VF for ${formatInr(pack.priceInr)}`,
);

export const LANDING_SINGLE_DEMOS: readonly LandingSingleSpeakerDemoCard[] = LANDING_SINGLE_DEMO_IDS.map((id) => {
  const entry = resolveSingleDemo(id);
  return {
    kind: 'single',
    id: entry.id,
    title: `${entry.language} - ${entry.scenario}`,
    useCase: summarizeSingleUseCase(entry),
    speakerLabels: [`Narrator: ${entry.displayName}`],
    language: `${entry.language} (${entry.resolvedLanguage})`,
    emotionStyle: `${entry.emotion} - ${entry.style}`,
    emotionCue: `${entry.emotion}. ${entry.style}.`,
    performanceCue: `Deliver with ${entry.style} phrasing and hold the emotional turn on the final phrase of the scenario.`,
    sampleScript: entry.translation,
    playbackConcept: 'Single-voice waveform playback with emotion tags and quick scrub controls.',
    audioSrc: entry.audioSrc,
  };
});

export const LANDING_MULTI_DEMOS: readonly LandingMultiSpeakerDemoCard[] = VECTOR_MULTI_SPEAKER_DEMO_ENTRIES.map((entry) => ({
  kind: 'multi',
  id: entry.id,
  title: `${entry.language} - ${entry.scenario}`,
  useCase: entry.useCase,
  speakerLabels: entry.cast.map((member) => `${member.role}: ${member.displayName}`),
  language: `${entry.language} (${entry.resolvedLanguage})`,
  emotionStyle: `${entry.direction} ${entry.summary}`,
  emotionCue: `${entry.summary}. ${entry.direction}. ${summarizeLineContext(entry)}.`,
  performanceCue: `${entry.direction} Lead with ${entry.cast[0]?.role || 'the first speaker'}, keep the middle exchange crisp, and close with the final voice landing cleanly.`,
  sampleScript: summarizeMultiScript(entry),
  playbackConcept: 'Multi-channel cast playback concept with role meters, line handoff markers, and scene pacing.',
  audioSrc: entry.audioSrc,
}));

export const LANDING_DEMOS: readonly LandingDemoCard[] = [...LANDING_SINGLE_DEMOS, ...LANDING_MULTI_DEMOS];

export const LANDING_LANGUAGE_CHIPS = LANGUAGES
  .filter((entry) => ['en', 'en-US', 'hi', 'es', 'fr', 'ar', 'zh', 'ja', 'de', 'pt-BR', 'ko', 'tr', 'it', 'ru'].includes(entry.code))
  .map((entry) => ({
    code: entry.code,
    name: entry.name,
    nativeName: entry.nativeName,
    rtl: entry.rtl,
  }));

export const LANDING_USE_CASES: readonly LandingUseCaseItem[] = [
  {
    title: 'Creators and channels',
    body: 'Ship consistent narration for YouTube, shorts, and serialized content with reusable voice direction.',
  },
  {
    title: 'Podcasts and roundtables',
    body: 'Run cast-aware conversations with role separation that stays clear in every edit pass.',
  },
  {
    title: 'Storytelling and audiobooks',
    body: 'Blend cinematic narration and dialogue-driven scenes with tighter control over pacing and tone.',
  },
  {
    title: 'Dubbing and localization',
    body: 'Adapt core scripts for global releases with multilingual generation and faster market variants.',
  },
  {
    title: 'Games and character scenes',
    body: 'Prototype character voices and scene handoffs quickly without rebuilding the whole pipeline.',
  },
  {
    title: 'Ads and brand campaigns',
    body: 'Launch persuasive voiceovers for product spots, promos, and premium campaign narratives.',
  },
  {
    title: 'Education and training',
    body: 'Produce structured instructional narration, scenario walkthroughs, and internal learning modules.',
  },
  {
    title: 'Support and enterprise media',
    body: 'Standardize high-volume voice output for support scripts, operations updates, and media workflows.',
  },
] as const;
