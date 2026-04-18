import openVoiceManifestJson from '../../../public/audio/openvoice-demo/manifest.json';
import readerDemoManifestJson from '../../../public/audio/reader-demo/manifest.json';
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

interface VoiceCloneManifestFile {
  role: string;
  file: string;
}

interface VoiceCloneManifest {
  engine: string;
  files: VoiceCloneManifestFile[];
}

interface ReaderDemoManifestSample {
  id: string;
  title: string;
  summary: string;
  language: string;
  locale: string;
  audioSrc: string;
  posterSrc: string;
  cue: string;
  durationSec: number;
  script: string;
}

interface ReaderDemoManifestVirtualBook {
  id: string;
  title: string;
  author: string;
  language: string;
  locale: string;
  description: string;
  coverSrc: string;
  totalChapters: number;
}

interface ReaderDemoManifestChapter {
  id: string;
  order: number;
  title: string;
  summary: string;
  cue: string;
  audioSrc: string;
  durationSec: number;
  script: string;
}

interface ReaderDemoManifest {
  engine: string;
  sample: ReaderDemoManifestSample;
  virtualBook?: ReaderDemoManifestVirtualBook;
  chapters?: ReaderDemoManifestChapter[];
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

export interface LandingReaderSample {
  id: string;
  title: string;
  summary: string;
  language: string;
  locale: string;
  audioSrc: string;
  posterSrc: string;
  cue: string;
  durationSec: number;
}

export interface LandingReaderChapter {
  id: string;
  order: number;
  title: string;
  summary: string;
  cue: string;
  audioSrc: string;
  durationSec: number;
}

export interface LandingReaderVirtualBook {
  id: string;
  title: string;
  author: string;
  language: string;
  locale: string;
  description: string;
  coverSrc: string;
  totalChapters: number;
  chapters: LandingReaderChapter[];
}

export interface LandingReaderProof {
  title: string;
  summary: string;
  modeLabel: string;
  coverLabel: string;
  progressLabel: string;
  activeTitle: string;
  activeStatus: string;
  sample: LandingReaderSample;
  virtualBook: LandingReaderVirtualBook;
  units: LandingReaderUnit[];
}

const asVectorDemoManifest = vectorDemoManifestJson as VectorDemoManifest;
const asMultiSpeakerManifest = vectorMultiDemoManifestJson as MultiSpeakerManifest;
const asVoiceCloneManifest = openVoiceManifestJson as VoiceCloneManifest;
const asReaderDemoManifest = readerDemoManifestJson as ReaderDemoManifest;

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

const requireCloneFile = (role: string) => {
  const file = asVoiceCloneManifest.files.find((entry) => entry.role === role);
  if (!file) {
    throw new Error(`Voice Clone landing proof is missing the "${role}" file.`);
  }
  return file;
};

const requireReaderSample = () => {
  const sample = asReaderDemoManifest.sample;
  if (!sample) {
    throw new Error('Reader landing proof is missing the sample payload.');
  }

  if (!String(sample.audioSrc || '').trim().startsWith('/audio/reader-demo/')) {
    throw new Error('Reader landing proof has an invalid audio source path.');
  }

  if (!String(sample.posterSrc || '').trim().startsWith('/images/')) {
    throw new Error('Reader landing proof has an invalid poster source path.');
  }

  return sample;
};

const requireReaderVirtualBook = () => {
  const virtualBook = asReaderDemoManifest.virtualBook;
  if (!virtualBook) {
    throw new Error('Reader landing proof is missing the virtual book payload.');
  }

  const chapters = Array.isArray(asReaderDemoManifest.chapters) ? asReaderDemoManifest.chapters : [];
  if (chapters.length < 2) {
    throw new Error('Reader landing proof requires at least two virtual book chapters.');
  }

  if (!String(virtualBook.coverSrc || '').trim().startsWith('/images/')) {
    throw new Error('Reader landing proof has an invalid virtual book cover path.');
  }

  const normalizedChapters = chapters
    .map((chapter) => ({
      ...chapter,
      order: Number(chapter.order || 0),
      durationSec: Number(chapter.durationSec || 0),
    }))
    .sort((a, b) => a.order - b.order);

  const seen = new Set<string>();
  for (const chapter of normalizedChapters) {
    const chapterId = String(chapter.id || '').trim();
    if (!chapterId) {
      throw new Error('Reader landing proof includes a chapter without an id.');
    }
    if (seen.has(chapterId)) {
      throw new Error(`Reader landing proof includes a duplicate chapter id: ${chapterId}`);
    }
    seen.add(chapterId);

    if (!String(chapter.audioSrc || '').trim().startsWith('/audio/reader-demo/')) {
      throw new Error(`Reader landing proof has an invalid chapter audio path for ${chapterId}.`);
    }

    if (!(chapter.durationSec > 0)) {
      throw new Error(`Reader landing proof has an invalid chapter duration for ${chapterId}.`);
    }
  }

  return {
    virtualBook,
    chapters: normalizedChapters,
  };
};

const FEATURED_SINGLE_SPEAKER_IDS: readonly string[] = asVectorDemoManifest.samples
  .map((sample) => sample.slug)
  .slice(0, 6);

const FEATURED_MULTI_SPEAKER_IDS: readonly string[] = (
  asMultiSpeakerManifest.featuredIds.length > 0
    ? asMultiSpeakerManifest.featuredIds
    : asMultiSpeakerManifest.entries.map((entry) => entry.id)
).slice(0, 6);

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
    audioSrc: sample.file,
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
    audioSrc: entry.audioSrc,
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

const referenceFile = requireCloneFile('reference');
const renderedFile = requireCloneFile('rendered');
const readerSample = requireReaderSample();
const readerVirtualBook = requireReaderVirtualBook();

export const LANDING_VOICE_CLONE_PROOF: LandingVoiceCloneProof = {
  title: 'Voice Clone proof',
  summary: 'Compare the reference clip against the rendered clone before opening the studio.',
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
  summary: 'Use the same prompt contract as the studio to tighten emphasis and pacing before render.',
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
  summary: 'The reader closes the loop between script review and final listening.',
  modeLabel: 'Reader review',
  coverLabel: 'Approval surface',
  progressLabel: `${readerVirtualBook.chapters.length} chapters ready`,
  activeTitle: readerVirtualBook.chapters[0]?.title || 'Chapter playback',
  activeStatus: 'Reviewing',
  sample: {
    id: readerSample.id,
    title: readerSample.title,
    summary: readerSample.summary,
    language: readerSample.language,
    locale: readerSample.locale,
    audioSrc: readerSample.audioSrc,
    posterSrc: readerSample.posterSrc,
    cue: readerSample.cue,
    durationSec: Number(readerSample.durationSec || 0),
  },
  virtualBook: {
    id: readerVirtualBook.virtualBook.id,
    title: readerVirtualBook.virtualBook.title,
    author: readerVirtualBook.virtualBook.author,
    language: readerVirtualBook.virtualBook.language,
    locale: readerVirtualBook.virtualBook.locale,
    description: readerVirtualBook.virtualBook.description,
    coverSrc: readerVirtualBook.virtualBook.coverSrc,
    totalChapters: Number(readerVirtualBook.virtualBook.totalChapters || readerVirtualBook.chapters.length),
    chapters: readerVirtualBook.chapters.map((chapter) => ({
      id: chapter.id,
      order: Number(chapter.order || 0),
      title: chapter.title,
      summary: chapter.summary,
      cue: chapter.cue,
      audioSrc: chapter.audioSrc,
      durationSec: Number(chapter.durationSec || 0),
    })),
  },
  units: readerVirtualBook.chapters.map((chapter) => ({
    id: chapter.id,
    title: chapter.title,
    status: chapter.order === 1 ? 'Live' : 'Ready',
    body: chapter.summary,
  })),
};
