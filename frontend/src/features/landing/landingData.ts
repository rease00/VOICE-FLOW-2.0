import { existsSync, readFileSync } from 'node:fs';
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

interface OpenVoiceManifestFile {
  role: string;
  file: string;
}

interface OpenVoiceManifest {
  engine: string;
  files: OpenVoiceManifestFile[];
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
    title: 'Launch film narration',
    summary: 'Polished English pacing for hero films, product reveals, and broadcast-style intros.',
    cue: 'Bright authority with controlled lift on the close.',
  },
  hi: {
    title: 'Hindi explainer read',
    summary: 'Localized delivery tuned for onboarding films, app walkthroughs, and education cuts.',
    cue: 'Measured, practical, and warm enough for repeat listening.',
  },
  es: {
    title: 'Spanish campaign pass',
    summary: 'A cleaner market read for social promos, paid spots, and short-form launch assets.',
    cue: 'Expressive opening with a compact, persuasive finish.',
  },
  ar: {
    title: 'Arabic documentary tone',
    summary: 'Measured narration with enough gravity for premium editorial and documentary framing.',
    cue: 'Low, composed, and cinematic without losing clarity.',
  },
  'zh-cn': {
    title: 'Mandarin release teaser',
    summary: 'Fast, crisp delivery for high-end teasers, feature drops, and product announcements.',
    cue: 'Compact phrasing with a sharp editorial cadence.',
  },
};

const MULTI_SPEAKER_TITLE_COPY: Record<string, string> = {
  'en-roundtable': 'Creator roundtable',
  'zh-briefing': 'Mandarin creator briefing',
  'hi-audiobook': 'Hindi audiobook scene',
  'es-culture': 'Culture recap panel',
  'ar-documentary': 'Arabic documentary passage',
};

const MULTI_SPEAKER_CUE_COPY: Record<string, string> = {
  'en-roundtable': 'Lead with a confident host and keep the strategist turn punchy.',
  'zh-briefing': 'Presenter first, reporter second, analyst last. Calm all the way through.',
  'hi-audiobook': 'Hold the suspense between narration and dialogue instead of rushing the reveal.',
  'es-culture': 'Keep it conversational, then tighten the final production handoff.',
  'ar-documentary': 'Low cinematic narration with warm expert context and a deliberate archival close.',
};

const resolveFrontendAssetPath = (...segments: string[]) => {
  const directPath = path.join(/* turbopackIgnore: true */ process.cwd(), ...segments);
  if (existsSync(directPath)) return directPath;

  const repoRelativePath = path.join(/* turbopackIgnore: true */ process.cwd(), 'frontend', ...segments);
  if (existsSync(repoRelativePath)) return repoRelativePath;

  throw new Error(`Unable to resolve frontend asset path for ${segments.join('/')}.`);
};

const readJsonWithBom = <T,>(...segments: string[]): T => {
  const filePath = resolveFrontendAssetPath(...segments);
  const raw = readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '');
  return JSON.parse(raw) as T;
};

const asVectorDemoManifest = readJsonWithBom<VectorDemoManifest>('public', 'audio', 'vector-demo', 'manifest.json');
const asMultiSpeakerManifest = readJsonWithBom<MultiSpeakerManifest>('public', 'audio', 'vector-multi-demo', 'manifest.json');
const asOpenVoiceManifest = readJsonWithBom<OpenVoiceManifest>('public', 'audio', 'openvoice-demo', 'manifest.json');

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
  const file = asOpenVoiceManifest.files.find((entry) => entry.role === role);
  if (!file) {
    throw new Error(`OpenVoice landing proof is missing the "${role}" file.`);
  }
  return file;
};

const FEATURED_SINGLE_SPEAKER_IDS = ['en-us', 'hi', 'es', 'ar', 'zh-cn'] as const;
const FEATURED_MULTI_SPEAKER_IDS = ['en-roundtable', 'zh-briefing', 'hi-audiobook', 'es-culture', 'ar-documentary'] as const;

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
    summary: entry.summary,
    scene: entry.scenario,
    market: entry.market,
    useCase: entry.useCase,
    direction: entry.direction,
    translation: entry.translation,
    cue: MULTI_SPEAKER_CUE_COPY[id] || entry.direction,
    audioSrc: entry.audioSrc,
    cast: entry.cast.map((member) => `${member.role}: ${member.displayName}`),
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
  castNames: LANDING_DIRECTOR_SOURCE_DEMO?.cast.map((member) => member.split(':')[0] || member) || [],
  sourceText:
    LANDING_DIRECTOR_SOURCE_DEMO?.lines.map((line) => `(${line.speaker}) : ${line.text}`).join('\n') || '',
  topic: LANDING_DIRECTOR_SOURCE_DEMO?.scene || 'Creator roundtable',
  pacingStyle: 'Confident premium pacing',
  language: 'English',
  style: 'studio-direct',
  tone: 'calm and premium',
});

const referenceFile = requireCloneFile('reference');
const renderedFile = requireCloneFile('rendered');

export const LANDING_VOICE_CLONE_PROOF: LandingVoiceCloneProof = {
  title: 'OpenVoice clone proof',
  summary:
    'The public proof pair lets listeners compare the reference clip against the rendered clone before they ever enter the studio.',
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
    'The same live prompt contract used in the studio can tighten emphasis, reshape pacing, and steer a scene before you commit the render.',
  prompt: LANDING_DIRECTOR_PROMPT_BUNDLE.systemPrompt.split('\n').slice(0, 11).join('\n'),
  before: 'Flat pacing, neutral emphasis, and no clear contrast between the opening question and the strategic answer.',
  after: 'The host lands the opener with lift, the strategist drives the middle beat, and the close resolves with calm authority.',
  bullets: [
    { label: 'Prompt contract', value: 'Stable JSON output keeps direction usable instead of ornamental.' },
    { label: 'Scene-safe edits', value: 'Direction changes delivery while preserving the source script and speaker order.' },
    { label: 'Publish speed', value: 'Review the prompt, render again, and keep the same scene ready for release across markets.' },
  ],
};

export const LANDING_READER_PROOF: LandingReaderProof = {
  title: 'Reader playback',
  summary:
    'The reader closes the loop between script review and final listening, so creative teams can approve pacing and narrative flow in one surface.',
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
      body: 'Lead with the premium promise, then move directly into proof instead of marketing filler.',
    },
    {
      id: 'scene-2',
      title: 'Scene 02 - Prime cast reel',
      status: 'Live',
      body: 'The multi-speaker reel stays audible and easy to compare while the team reviews each cast handoff.',
    },
    {
      id: 'scene-3',
      title: 'Scene 03 - Clone approval',
      status: 'Ready',
      body: 'Reference and rendered voice-clone takes stay together so approvals happen with real playback context.',
    },
  ],
};
