import vectorDemoManifestJson from '../../../public/audio/vector-demo/manifest.json';
import vectorMultiDemoManifestJson from '../../../public/audio/vector-multi-demo/manifest.json';
import { buildStudioLiveMultiSpeakerPrompt } from '../../shared/prompts/liveMultiSpeakerPrompt';

interface VectorDemoSample {
  slug: string;
  title?: string;
  summary?: string;
  language: string;
  country: string;
  file: string;
}

interface VectorDemoManifest {
  engine: string;
  samples: VectorDemoSample[];
}

interface MultiSpeakerManifestLine {
  speaker: string;
  role: string;
  text: string;
}

interface MultiSpeakerManifestCast {
  speaker: string;
  role: string;
  displayName: string;
}

interface MultiSpeakerManifestEntry {
  id: string;
  title?: string;
  language: string;
  market: string;
  useCase: string;
  scenario: string;
  direction: string;
  summary: string;
  translation: string;
  audioSrc: string;
  cast: MultiSpeakerManifestCast[];
  lines: MultiSpeakerManifestLine[];
  rtl?: boolean;
}

interface MultiSpeakerManifest {
  engine: string;
  featuredIds: string[];
  entries: MultiSpeakerManifestEntry[];
}

export interface LandingSingleSpeakerDemo {
  id: string;
  title: string;
  summary: string;
  language: string;
  market: string;
  audioSrc: string;
  cue: string;
}

export interface LandingMultiSpeakerLine {
  speaker: string;
  role: string;
  text: string;
}

export interface LandingMultiSpeakerDemo {
  id: string;
  title: string;
  summary: string;
  scene: string;
  market: string;
  useCase: string;
  direction: string;
  translation: string;
  cue: string;
  audioSrc: string;
  cast: string[];
  lines: LandingMultiSpeakerLine[];
  rtl?: boolean;
}

export interface LandingDirectorBullet {
  label: string;
  value: string;
}

export interface LandingDirectorProof {
  title: string;
  summary: string;
  prompt: string;
  before: string;
  after: string;
  bullets: LandingDirectorBullet[];
}

export interface LandingVoiceCloneProof {
  title: string;
  summary: string;
  source: { label: string; name: string; audioSrc: string };
  rendered: { label: string; name: string; audioSrc: string };
}

const asVectorDemoManifest = vectorDemoManifestJson as VectorDemoManifest;
const asMultiSpeakerManifest = vectorMultiDemoManifestJson as MultiSpeakerManifest;

/**
 * When NEXT_PUBLIC_DEMO_AUDIO_BASE is set (e.g. an R2 public bucket URL),
 * rewrite `/audio/…` paths to serve from the CDN instead of the origin.
 * Falls back to the local public path when the env var is empty.
 *
 * Example: NEXT_PUBLIC_DEMO_AUDIO_BASE=https://pub-xxx.r2.dev/demo-audio
 *   /audio/vector-demo/morning-brief-en.wav
 *   → https://pub-xxx.r2.dev/demo-audio/vector-demo/morning-brief-en.wav
 */
const DEMO_AUDIO_BASE = (typeof process !== 'undefined' && process.env?.NEXT_PUBLIC_DEMO_AUDIO_BASE || '').replace(/\/+$/, '');

export const resolveDemoAudioSrc = (localPath: string): string => {
  if (!DEMO_AUDIO_BASE) return localPath;
  // /audio/vector-demo/file.wav → vector-demo/file.wav
  const stripped = localPath.replace(/^\/audio\//, '');
  return `${DEMO_AUDIO_BASE}/${stripped}`;
};

const resolveSingleDemoTitle = (sample: VectorDemoSample, index: number): string => {
  const explicitTitle = String(sample.title || '').trim();
  if (explicitTitle) return explicitTitle;
  return `Single Voice Demo ${index + 1}`;
};

const buildSpeakerAliasMap = (entry: MultiSpeakerManifestEntry): Map<string, string> => {
  const orderedSpeakers = [
    ...entry.cast.map((member) => String(member.speaker || '').trim()),
    ...entry.lines.map((line) => String(line.speaker || '').trim()),
  ].filter(Boolean);

  const unique = Array.from(new Set(orderedSpeakers));
  return new Map(unique.map((speaker, index) => [speaker, `Voice ${index + 1}`]));
};

const buildVoiceCastLabels = (entry: MultiSpeakerManifestEntry, aliasMap: Map<string, string>): string[] => {
  const aliasLabels = Array.from(aliasMap.values());
  if (aliasLabels.length > 0) {
    return aliasLabels;
  }
  const fallbackCount = Math.max(0, entry.cast.length);
  return Array.from({ length: fallbackCount }, (_, index) => `Voice ${index + 1}`);
};

const requireSingleSample = (slug: string) => {
  const sample = asVectorDemoManifest.samples.find((entry) => entry.slug === slug);
  if (!sample) {
    throw new Error(`Landing single-speaker sample "${slug}" is missing from the vector manifest.`);
  }
  return sample;
};

const requireMultiSpeakerEntry = (id: string) => {
  const entry = asMultiSpeakerManifest.entries.find((candidate) => candidate.id === id);
  if (!entry) {
    throw new Error(`Landing multi-speaker sample "${id}" is missing from the Prime manifest.`);
  }
  return entry;
};

const FEATURED_SINGLE_SPEAKER_IDS: readonly string[] = asVectorDemoManifest.samples
  .map((sample) => sample.slug)
  .slice(0, 10);

const FEATURED_MULTI_SPEAKER_IDS: readonly string[] = (
  asMultiSpeakerManifest.featuredIds.length > 0
    ? asMultiSpeakerManifest.featuredIds
    : asMultiSpeakerManifest.entries.map((entry) => entry.id)
).slice(0, 8);

export const LANDING_SINGLE_SPEAKER_DEMOS: readonly LandingSingleSpeakerDemo[] = FEATURED_SINGLE_SPEAKER_IDS.map((slug, index) => {
  const sample = requireSingleSample(slug);
  const market = String(sample.country || '').trim() || 'Global';
  const runtimeLabel = String(asVectorDemoManifest.engine || 'runtime').trim();
  const explicitSummary = String(sample.summary || '').trim();

  return {
    id: slug,
    title: resolveSingleDemoTitle(sample, index),
    summary: explicitSummary || `Generated in the app and published for fast ${sample.language} voice checks.`,
    language: sample.language,
    market,
    audioSrc: resolveDemoAudioSrc(sample.file),
    cue: `${runtimeLabel} render`,
  };
});

export const LANDING_MULTI_SPEAKER_DEMOS: readonly LandingMultiSpeakerDemo[] = FEATURED_MULTI_SPEAKER_IDS.map((id) => {
  const entry = requireMultiSpeakerEntry(id);
  const aliasMap = buildSpeakerAliasMap(entry);
  const voiceCast = buildVoiceCastLabels(entry, aliasMap);
  const explicitTitle = String(entry.title || '').trim();

  return {
    id,
    title: explicitTitle || entry.scenario,
    summary: entry.summary,
    scene: entry.scenario,
    market: entry.market,
    useCase: entry.useCase,
    direction: entry.direction,
    translation: entry.translation,
    cue: entry.direction,
    audioSrc: resolveDemoAudioSrc(entry.audioSrc),
    cast: voiceCast,
    lines: entry.lines.map((line) => ({
      speaker: aliasMap.get(line.speaker) || 'Voice',
      role: aliasMap.get(line.speaker) || 'Voice',
      text: line.text,
    })),
    ...(entry.rtl ? { rtl: true } : {}),
  };
});

const LANDING_DIRECTOR_SOURCE_DEMO = LANDING_MULTI_SPEAKER_DEMOS[0];

const LANDING_DIRECTOR_PROMPT_BUNDLE = buildStudioLiveMultiSpeakerPrompt({
  castNames: Array.from(new Set(LANDING_DIRECTOR_SOURCE_DEMO?.lines.map((line) => line.role) || [])),
  sourceText: LANDING_DIRECTOR_SOURCE_DEMO?.lines.map((line) => line.text).join('\n') || '',
  topic: LANDING_DIRECTOR_SOURCE_DEMO?.scene || 'Creator roundtable',
  pacingStyle: 'Confident premium pacing',
  language: 'English',
  style: 'studio-direct',
  tone: 'calm and premium',
});

export const LANDING_DIRECTOR_PROOF: LandingDirectorProof = {
  title: 'AI Director',
  summary: 'Write or paste any story, press AI Director, and get a fully directed multi-speaker script in seconds.',
  prompt: LANDING_DIRECTOR_PROMPT_BUNDLE.systemPrompt.split('\n').slice(0, 8).join('\n'),
  before: 'Maya wiped her headphones off. "Can AI actually be creative, or is it just really good at copying?"\nDev leaned back. "Creativity requires intent. AI doesn\'t want to create."\nZara crossed her arms. "But does intent matter if the output moves people?"',
  after: 'Maya (Enthusiastic): Can AI actually be creative, or is it just really good at copying?\nDev (Thoughtful): Creativity requires intent. AI doesn\'t want to create.\nZara (Challenging): But does intent matter if the output moves people?\nKai (Calm, Casual): AI is a tool. The best paintbrush in the world doesn\'t make you Picasso.',
  bullets: [
    { label: 'Speaker detection', value: 'Identifies every character, assigns gender and age metadata for voice matching.' },
    { label: 'Emotion tagging', value: 'Tags each line with emotions — Determined, Sarcastic, Anxious — for natural delivery.' },
    { label: 'One click', value: 'Write your story, press AI Director, and the formatted script is ready to render.' },
  ],
};
