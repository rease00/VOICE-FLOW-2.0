import { EMOTIONS } from '../constants';

const normalizeKey = (value: string): string => (
  String(value || '')
    .toLowerCase()
    .replace(/[\(\)\[\]\{\}"']/g, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ')
);

const collapseSpaces = (value: string): string => (
  String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
);

const CANONICAL_BY_KEY = new Map<string, string>();
for (const emotion of EMOTIONS) {
  const key = normalizeKey(emotion);
  if (key && !CANONICAL_BY_KEY.has(key)) {
    CANONICAL_BY_KEY.set(key, emotion);
  }
}

const LEGACY_ALIASES: Record<string, string> = {
  'heroic veera': 'Heroic',
  'sorrowful karuna': 'Sad',
  'terrified bhayanaka': 'Fearful',
  'disgusted bibhatsa': 'Disgusted',
  'wonderstruck adbhuta': 'Surprised',
  'peaceful shanta': 'Calm',
  'amused hasya': 'Playful',
  'furious raudra': 'Furious',
  'romantic shringara': 'Romantic',
  'devotional bhakti': 'Devotional',
  stern: 'Serious',
  melodramatic: 'Cinematic Narration',
  sleepy: 'Relaxed',
  smiling: 'Cheerful',
  joking: 'Playful',
  amused: 'Playful',
  concerned: 'Empathetic',
  concern: 'Empathetic',
  whisper: 'Whispering',
  shout: 'Shouting',
  yelled: 'Shouting',
  yelling: 'Shouting',
  cry: 'Crying',
  sobbing: 'Crying',
  weeping: 'Crying',
  worried: 'Anxious',
  panic: 'Anxious',
  shocked: 'Shocked',
};

const FALLBACK_TOKEN_ALIASES: Array<{ token: string; emotion: string }> = [
  { token: 'whisper', emotion: 'Whispering' },
  { token: 'shout', emotion: 'Shouting' },
  { token: 'scream', emotion: 'Screaming' },
  { token: 'cry', emotion: 'Crying' },
  { token: 'laugh', emotion: 'Laughing' },
  { token: 'sad', emotion: 'Sad' },
  { token: 'angry', emotion: 'Angry' },
  { token: 'fear', emotion: 'Fearful' },
  { token: 'calm', emotion: 'Calm' },
  { token: 'happy', emotion: 'Happy' },
  { token: 'surpris', emotion: 'Surprised' },
];

export const normalizeEmotionTag = (value: string): string | undefined => {
  const key = normalizeKey(value);
  if (!key) return undefined;
  if (CANONICAL_BY_KEY.has(key)) return CANONICAL_BY_KEY.get(key);
  if (Object.prototype.hasOwnProperty.call(LEGACY_ALIASES, key)) return LEGACY_ALIASES[key];

  for (const { token, emotion } of FALLBACK_TOKEN_ALIASES) {
    if (key.includes(token)) return emotion;
  }
  return undefined;
};

export const splitTagBlock = (rawTags: string | null | undefined): string[] => {
  const source = String(rawTags || '').trim();
  if (!source) return [];
  return source
    .split(/[,|/;]+/g)
    .map((token) => collapseSpaces(token.replace(/^[\-\*\u2022]+|[\-\*\u2022]+$/g, '')))
    .filter(Boolean);
};

export interface ExtractedTagBundle {
  primaryEmotion: string;
  emotionTags: string[];
  crewTags: string[];
  orderedTags: string[];
}

export const extractEmotionAndCrewTags = (rawTags: string | null | undefined): ExtractedTagBundle => {
  const tokens = splitTagBlock(rawTags);
  const emotionTags: string[] = [];
  const crewTags: string[] = [];
  const orderedTags: string[] = [];

  const seenOrdered = new Set<string>();
  const seenEmotions = new Set<string>();
  const seenCrew = new Set<string>();

  for (const token of tokens) {
    const emotion = normalizeEmotionTag(token);
    if (emotion) {
      const emotionKey = normalizeKey(emotion);
      if (!seenEmotions.has(emotionKey)) {
        seenEmotions.add(emotionKey);
        emotionTags.push(emotion);
      }
      if (!seenOrdered.has(emotionKey)) {
        seenOrdered.add(emotionKey);
        orderedTags.push(emotion);
      }
      continue;
    }

    const cleanedCrew = collapseSpaces(token);
    const crewKey = normalizeKey(cleanedCrew);
    if (!crewKey || seenCrew.has(crewKey)) continue;
    seenCrew.add(crewKey);
    crewTags.push(cleanedCrew);
    if (!seenOrdered.has(crewKey)) {
      seenOrdered.add(crewKey);
      orderedTags.push(cleanedCrew);
    }
  }

  return {
    primaryEmotion: emotionTags[0] || 'Neutral',
    emotionTags,
    crewTags,
    orderedTags,
  };
};

