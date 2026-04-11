import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
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

export interface LandingWritingUnit {
  id: string;
  title: string;
  status: string;
  body: string;
}

export interface LandingWritingProof {
  title: string;
  summary: string;
  modeLabel: string;
  coverLabel: string;
  progressLabel: string;
  activeTitle: string;
  activeStatus: string;
  units: LandingWritingUnit[];
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
    title: 'Daily check-in',
    summary: 'Weather, calendar, reminder.',
    cue: 'Bright, warm, clear.',
  },
  hi: {
    title: 'Support reply',
    summary: 'Calm help with the next step.',
    cue: 'Steady, reassuring.',
  },
  es: {
    title: 'Delivery update',
    summary: 'Quick status, clear next action.',
    cue: 'Crisp, practical.',
  },
  ja: {
    title: 'Meeting reminder',
    summary: 'Polished reminder before the call.',
    cue: 'Measured, professional.',
  },
  fr: {
    title: 'Travel line',
    summary: 'Soft, cinematic narration.',
    cue: 'Airy, warm.',
  },
};

const MULTI_SPEAKER_SUMMARY_COPY: Record<string, string> = {
  'en-weekend-plan': 'A fast weekend pitch-off.',
  'hi-family-dinner': 'Warm family timing.',
  'es-boutique-shop': 'A shop exchange with a clean close.',
  'ja-office-deadline': 'An office handoff under pressure.',
  'fr-city-tour': 'A guide and traveler in sync.',
};

const MULTI_SPEAKER_TITLE_COPY: Record<string, string> = {
  'en-weekend-plan': 'Weekend plan',
  'hi-family-dinner': 'Family dinner',
  'es-boutique-shop': 'Boutique stop',
  'ja-office-deadline': 'Office deadline',
  'fr-city-tour': 'City tour',
};

const MULTI_SPEAKER_CUE_COPY: Record<string, string> = {
  'en-weekend-plan': 'Quick turns. Clean contrast.',
  'hi-family-dinner': 'Warm and teasing.',
  'es-boutique-shop': 'Helpful and bright.',
  'ja-office-deadline': 'Tight, professional.',
  'fr-city-tour': 'Elegant, easy.',
};

const landingDataDirectory = path.dirname(fileURLToPath(import.meta.url));
const landingPublicDirectory = path.resolve(landingDataDirectory, '../../../public');

const readJsonWithBom = <T,>(...segments: string[]): T => (
  JSON.parse(readFileSync(path.join(landingPublicDirectory, ...segments), 'utf8').replace(/^\uFEFF/, '')) as T
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
  title: 'Clone proof',
  summary: 'Compare source and render side by side.',
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
  summary: 'Tighten pace before render.',
  prompt: LANDING_DIRECTOR_PROMPT_BUNDLE.systemPrompt.split('\n').slice(0, 8).join('\n'),
  before: 'Flat pacing, weak contrast.',
  after: 'Cleaner handoffs, better lift.',
  bullets: [
    { label: 'Prompt', value: 'Stable JSON keeps direction usable.' },
    { label: 'Scene-safe', value: 'Tweak delivery, keep meaning.' },
    { label: 'Speed', value: 'Review, rerender, ship.' },
  ],
};

export const LANDING_WRITING_PROOF: LandingWritingProof = {
  title: 'Writing',
  summary: 'Review by ear before release.',
  modeLabel: 'Writing review',
  coverLabel: 'Approval surface',
  progressLabel: '4 scenes locked',
  activeTitle: 'Episode 03 - Final pass',
  activeStatus: 'Reviewing',
  units: [
    {
      id: 'scene-1',
      title: 'Scene 01 - Cold open',
      status: 'Locked',
      body: 'Lead with the promise.',
    },
    {
      id: 'scene-2',
      title: 'Scene 02 - Prime cast reel',
      status: 'Live',
      body: 'Keep the reel easy to scan.',
    },
    {
      id: 'scene-3',
      title: 'Scene 03 - Clone approval',
      status: 'Ready',
      body: 'Keep source and clone together.',
    },
  ],
};
