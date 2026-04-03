import { readFileSync } from 'node:fs';
import path from 'node:path';
import { buildStudioLiveMultiSpeakerPrompt } from '../../shared/prompts/liveMultiSpeakerPrompt';

interface VectorDemoSample {
  slug: string;
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

interface VoiceCloneManifestFile {
  role: string;
  file: string;
}

interface VoiceCloneManifest {
  engine: string;
  files: VoiceCloneManifestFile[];
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

export interface LandingVoiceCloneProof {
  title: string;
  summary: string;
  source: {
    label: string;
    name: string;
    audioSrc: string;
  };
  rendered: {
    label: string;
    name: string;
    audioSrc: string;
  };
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

export interface LandingReaderUnit {
  id: string;
  title: string;
  status: string;
  body: string;
}

export interface LandingReaderProof {
  title: string;
  summary: string;
  modeLabel: string;
  coverLabel: string;
  progressLabel: string;
  activeTitle: string;
  activeStatus: string;
  units: LandingReaderUnit[];
}

const SINGLE_SPEAKER_COPY: Record<
  string,
  {
    title: string;
    summary: string;
    cue: string;
  }
> = {
  'en-us': {
    title: 'Daily assistant check-in',
    summary: 'Smart-home weather, schedule, and a playful reminder in one pass.',
    cue: 'Bright, friendly, warm.',
  },
  hi: {
    title: 'Hindi support response',
    summary: 'Support reply built around reassurance and clear next steps.',
    cue: 'Calm, steady, reassuring.',
  },
  es: {
    title: 'Spanish delivery update',
    summary: 'Delivery status with light urgency and practical guidance.',
    cue: 'Upbeat, practical, crisp.',
  },
  ja: {
    title: 'Japanese meeting reminder',
    summary: 'Business reminder with composed pre-meeting pacing.',
    cue: 'Measured, professional, supportive.',
  },
  fr: {
    title: 'French lifestyle narrative',
    summary: 'Dreamy travel-style narration with a soft finish.',
    cue: 'Airy, warm, gentle.',
  },
};

const MULTI_SPEAKER_SUMMARY_COPY: Record<string, string> = {
  'en-weekend-plan': 'Three friends pitch a blockbuster, an indie drama, and a playful middle ground.',
  'hi-family-dinner': 'A family dinner scene that balances warmth, teasing, and gentle authority.',
  'es-boutique-shop': 'A retail exchange that moves from polite ask to confident close.',
  'ja-office-deadline': 'An office handoff scene with tired focus and professional restraint.',
  'fr-city-tour': 'A guide and tourist move through a romantic city recommendation.',
};

const MULTI_SPEAKER_TITLE_COPY: Record<string, string> = {
  'en-weekend-plan': 'The weekend plan',
  'hi-family-dinner': 'Family dinner',
  'es-boutique-shop': 'The boutique shop',
  'ja-office-deadline': 'The office deadline',
  'fr-city-tour': 'The city tour',
};

const MULTI_SPEAKER_CUE_COPY: Record<string, string> = {
  'en-weekend-plan': 'Fast turns with crisp character contrast.',
  'hi-family-dinner': 'Warm family timing with teasing authority.',
  'es-boutique-shop': 'Helpful retail pacing with a bright finish.',
  'ja-office-deadline': 'Tired but professional handoff energy.',
  'fr-city-tour': 'Elegant guide pacing with a romantic finish.',
};

const readJsonWithBom = <T,>(...segments: string[]): T => (
  JSON.parse(readFileSync(path.join('public', ...segments), 'utf8').replace(/^\uFEFF/, '')) as T
);

const asVectorDemoManifest = readJsonWithBom<VectorDemoManifest>('audio', 'vector-demo', 'manifest.json');
const asMultiSpeakerManifest = readJsonWithBom<MultiSpeakerManifest>('audio', 'vector-multi-demo', 'manifest.json');
const asVoiceCloneManifest = readJsonWithBom<VoiceCloneManifest>('audio', 'openvoice-demo', 'manifest.json');

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

const requireCloneFile = (role: string) => {
  const file = asVoiceCloneManifest.files.find((entry) => entry.role === role);
  if (!file) {
    throw new Error(`Voice Clone landing proof is missing the "${role}" file.`);
  }
  return file;
};

const FEATURED_SINGLE_SPEAKER_IDS = ['en-us', 'hi', 'es', 'ja', 'fr'] as const;
const FEATURED_MULTI_SPEAKER_IDS = [
  'en-weekend-plan',
  'hi-family-dinner',
  'es-boutique-shop',
  'ja-office-deadline',
  'fr-city-tour',
] as const;

export const LANDING_SINGLE_SPEAKER_DEMOS: readonly LandingSingleSpeakerDemo[] = FEATURED_SINGLE_SPEAKER_IDS.map((slug) => {
  const sample = requireSingleSample(slug);
  const copy = SINGLE_SPEAKER_COPY[slug];
  if (!copy) {
    throw new Error(`Landing single-speaker copy for "${slug}" is missing.`);
  }

  return {
    id: slug,
    title: copy.title,
    summary: copy.summary,
    language: sample.language,
    market: sample.country,
    audioSrc: sample.file,
    cue: copy.cue,
  };
});

export const LANDING_MULTI_SPEAKER_DEMOS: readonly LandingMultiSpeakerDemo[] = FEATURED_MULTI_SPEAKER_IDS.map((id) => {
  const entry = requireMultiSpeakerEntry(id);

  return {
    id,
    title: MULTI_SPEAKER_TITLE_COPY[id] || entry.scenario,
    summary: MULTI_SPEAKER_SUMMARY_COPY[id] || entry.summary,
    scene: entry.scenario,
    market: entry.market,
    useCase: entry.useCase,
    direction: entry.direction,
    translation: entry.translation,
    cue: MULTI_SPEAKER_CUE_COPY[id] || entry.direction,
    audioSrc: entry.audioSrc,
    cast: entry.cast.map((member) => member.displayName),
    lines: entry.lines.map((line) => ({
      speaker: line.speaker,
      role: line.role,
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

const referenceFile = requireCloneFile('reference');
const renderedFile = requireCloneFile('rendered');

export const LANDING_VOICE_CLONE_PROOF: LandingVoiceCloneProof = {
  title: 'Voice Clone proof',
  summary:
    'Compare the reference clip against the rendered clone before opening the studio.',
  source: {
    label: 'Reference take',
    name: 'reference.wav',
    audioSrc: referenceFile.file,
  },
  rendered: {
    label: 'Rendered clone',
    name: 'rendered.wav',
    audioSrc: renderedFile.file,
  },
};

export const LANDING_DIRECTOR_PROOF: LandingDirectorProof = {
  title: 'AI Director lane',
  summary:
    'Use the same prompt contract as the studio to tighten emphasis and pacing before render.',
  prompt: LANDING_DIRECTOR_PROMPT_BUNDLE.systemPrompt.split('\n').slice(0, 8).join('\n'),
  before: 'Flat pacing with weak contrast between the three voices.',
  after: 'Clearer handoffs, cleaner skepticism, warmer resolution.',
  bullets: [
    { label: 'Prompt contract', value: 'Stable JSON keeps direction usable.' },
    { label: 'Scene-safe edits', value: 'Delivery changes without rewriting the scene.' },
    { label: 'Publish speed', value: 'Review, rerender, and keep the scene moving.' },
  ],
};

export const LANDING_READER_PROOF: LandingReaderProof = {
  title: 'Reader playback',
  summary:
    'The reader closes the loop between script review and final listening.',
  modeLabel: 'Reader review',
  coverLabel: 'Approval surface',
  progressLabel: '4 scenes locked',
  activeTitle: 'Episode 03 - Final listening pass',
  activeStatus: 'Reviewing',
  units: [
    {
      id: 'scene-1',
      title: 'Scene 01 - Cold open',
      status: 'Locked',
      body: 'Lead with the promise, then move straight into proof.',
    },
    {
      id: 'scene-2',
      title: 'Scene 02 - Prime cast reel',
      status: 'Live',
      body: 'Keep the cast reel easy to compare while the team reviews handoffs.',
    },
    {
      id: 'scene-3',
      title: 'Scene 03 - Clone approval',
      status: 'Ready',
      body: 'Keep reference and clone takes together for fast approval.',
    },
  ],
};
