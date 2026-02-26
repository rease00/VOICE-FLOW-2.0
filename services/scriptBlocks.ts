import { ScriptBlock } from '../types';
import { SFX_REGEX, SPEAKER_REGEX } from './geminiService';

const DEFAULT_SPEAKER = 'Narrator';
const DEFAULT_EMOTION = 'Neutral';

const createId = (): string => `block_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

const normalizeToken = (value: string, fallback = ''): string => {
  const cleaned = String(value || '').replace(/\s+/g, ' ').trim();
  return cleaned || fallback;
};

const parseEmotionMeta = (rawTagSection?: string | null): { primaryEmotion: string; cueTags: string[] } => {
  const tokens = String(rawTagSection || '')
    .split(',')
    .map((item) => normalizeToken(item))
    .filter(Boolean);
  if (tokens.length === 0) {
    return { primaryEmotion: DEFAULT_EMOTION, cueTags: [] };
  }
  return {
    primaryEmotion: tokens[0] || DEFAULT_EMOTION,
    cueTags: tokens.slice(1),
  };
};

const parseDialogueHeader = (
  line: string
): { speaker: string; text: string; primaryEmotion: string; cueTags: string[] } | null => {
  const match = String(line || '').match(SPEAKER_REGEX);
  if (!match) return null;

  const speaker = normalizeToken(match[2] || '', DEFAULT_SPEAKER);
  const text = normalizeToken(match[5] || '');
  const emotionMeta = parseEmotionMeta(match[3] || '');

  return {
    speaker,
    text,
    primaryEmotion: emotionMeta.primaryEmotion,
    cueTags: emotionMeta.cueTags,
  };
};

export const createEmptyDialogueBlock = (): ScriptBlock => ({
  id: createId(),
  type: 'dialogue',
  speaker: DEFAULT_SPEAKER,
  text: '',
  emotion: {
    primaryEmotion: DEFAULT_EMOTION,
    cueTags: [],
  },
});

export const createEmptySfxBlock = (): ScriptBlock => ({
  id: createId(),
  type: 'sfx',
  speaker: 'SFX',
  text: '',
  emotion: {
    primaryEmotion: DEFAULT_EMOTION,
    cueTags: [],
  },
});

export const createEmptyDirectionBlock = (): ScriptBlock => ({
  id: createId(),
  type: 'direction',
  speaker: DEFAULT_SPEAKER,
  text: '',
  emotion: {
    primaryEmotion: DEFAULT_EMOTION,
    cueTags: [],
  },
});

export const normalizeScriptBlocks = (input: ScriptBlock[]): ScriptBlock[] => {
  if (!Array.isArray(input)) return [];
  return input.map((block) => {
    const type = block?.type === 'sfx' || block?.type === 'direction' ? block.type : 'dialogue';
    const speaker = normalizeToken(block?.speaker || '', type === 'sfx' ? 'SFX' : DEFAULT_SPEAKER);
    const primaryEmotion = normalizeToken(block?.emotion?.primaryEmotion || '', DEFAULT_EMOTION);
    const cueTags = Array.isArray(block?.emotion?.cueTags)
      ? block.emotion.cueTags.map((item) => normalizeToken(item)).filter(Boolean)
      : [];
    return {
      id: normalizeToken(block?.id || '', createId()),
      type,
      speaker,
      text: String(block?.text || ''),
      emotion: {
        primaryEmotion,
        cueTags,
      },
    };
  });
};

export const parseScriptToBlocks = (text: string): ScriptBlock[] => {
  const lines = String(text || '').split('\n');
  const blocks: ScriptBlock[] = [];

  lines.forEach((line) => {
    const trimmed = String(line || '').trim();
    if (!trimmed) return;

    const sfxMatch = trimmed.match(SFX_REGEX);
    if (sfxMatch) {
      blocks.push({
        id: createId(),
        type: 'sfx',
        speaker: 'SFX',
        text: normalizeToken(sfxMatch[1] || ''),
        emotion: {
          primaryEmotion: DEFAULT_EMOTION,
          cueTags: [],
        },
      });
      return;
    }

    const parsedDialogue = parseDialogueHeader(trimmed);
    if (parsedDialogue) {
      blocks.push({
        id: createId(),
        type: 'dialogue',
        speaker: parsedDialogue.speaker,
        text: parsedDialogue.text,
        emotion: {
          primaryEmotion: parsedDialogue.primaryEmotion,
          cueTags: parsedDialogue.cueTags,
        },
      });
      return;
    }

    if (trimmed.startsWith('(') && trimmed.endsWith(')')) {
      blocks.push({
        id: createId(),
        type: 'direction',
        speaker: DEFAULT_SPEAKER,
        text: trimmed.slice(1, -1).trim(),
        emotion: {
          primaryEmotion: DEFAULT_EMOTION,
          cueTags: [],
        },
      });
      return;
    }

    const previous = blocks[blocks.length - 1];
    if (previous && previous.type === 'dialogue') {
      previous.text = previous.text ? `${previous.text}\n${trimmed}` : trimmed;
      return;
    }

    blocks.push({
      id: createId(),
      type: 'dialogue',
      speaker: DEFAULT_SPEAKER,
      text: trimmed,
      emotion: {
        primaryEmotion: DEFAULT_EMOTION,
        cueTags: [],
      },
    });
  });

  return normalizeScriptBlocks(blocks);
};

const serializeDialogueBlock = (block: ScriptBlock): string => {
  const speaker = normalizeToken(block.speaker, DEFAULT_SPEAKER);
  const dialogue = String(block.text || '').trim();
  const tags = [normalizeToken(block.emotion?.primaryEmotion || '', DEFAULT_EMOTION)];
  const cues = Array.isArray(block.emotion?.cueTags)
    ? block.emotion.cueTags.map((item) => normalizeToken(item)).filter(Boolean)
    : [];
  if (cues.length > 0) tags.push(...cues);
  const tagText = tags.join(', ');
  if (!dialogue) return `${speaker} (${tagText}):`;
  return `${speaker} (${tagText}): ${dialogue}`;
};

export const serializeBlocksToScript = (input: ScriptBlock[]): string => {
  const blocks = normalizeScriptBlocks(input);
  const lines = blocks.map((block) => {
    if (block.type === 'sfx') {
      const sfxText = normalizeToken(block.text);
      return sfxText ? `[SFX: ${sfxText}]` : '';
    }
    if (block.type === 'direction') {
      const directionText = normalizeToken(block.text);
      return directionText ? `(${directionText})` : '';
    }
    return serializeDialogueBlock(block);
  }).filter(Boolean);

  return lines.join('\n').trim();
};

