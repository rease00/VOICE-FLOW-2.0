import type { AudioNovelDialogueLine, AudioNovelEmotion, AudioNovelSpeakerRun } from './contracts.ts';
import { EMOTION_CUE_MAP } from './input.ts';

const MAX_MERGE = 2_800;
const EMOTION_REINFORCE_EVERY = 5;

export const buildEmotionText = (lines: string[], emotion: AudioNovelEmotion): string => {
  if (lines.length === 0) return '';
  const cue = EMOTION_CUE_MAP[emotion] || '';
  const prefix = cue ? `[${cue}]\n` : '';
  if (!cue) {
    return lines.join('\n');
  }

  const result: string[] = [`${prefix}${lines[0]}`];
  for (let index = 1; index < lines.length; index += 1) {
    const reinforce = index % EMOTION_REINFORCE_EVERY === 0 ? prefix : '';
    result.push(`${reinforce}${lines[index]}`);
  }
  return result.join('\n');
};

export const compressToRuns = (
  lines: AudioNovelDialogueLine[],
  resolveVoice: (speaker: string) => string,
): AudioNovelSpeakerRun[] => {
  const runs: AudioNovelSpeakerRun[] = [];
  let current: {
    speaker: string;
    voice: string;
    emotion: AudioNovelEmotion;
    rawLines: string[];
    lineIndices: number[];
  } | null = null;

  const flush = () => {
    if (!current) return;
    const mergedText = buildEmotionText(current.rawLines, current.emotion);
    runs.push({
      runIndex: runs.length,
      speaker: current.speaker,
      voice: current.voice,
      emotion: current.emotion,
      mergedText,
      rawLines: [...current.rawLines],
      lineIndices: [...current.lineIndices],
      firstLine: current.lineIndices[0] ?? 0,
      lastLine: current.lineIndices[current.lineIndices.length - 1] ?? 0,
      charCount: current.rawLines.join('').length,
    });
    current = null;
  };

  for (const line of lines) {
    const voice = resolveVoice(line.speaker);
    const currentChars = current?.rawLines.join('').length ?? 0;
    const sameRun = Boolean(
      current
      && current.speaker === line.speaker
      && current.emotion === line.emotion
      && (currentChars + line.text.length) < MAX_MERGE,
    );

    if (sameRun && current) {
      current.rawLines.push(line.text);
      current.lineIndices.push(line.index);
      continue;
    }

    flush();
    current = {
      speaker: line.speaker,
      voice,
      emotion: line.emotion,
      rawLines: [line.text],
      lineIndices: [line.index],
    };
  }

  flush();
  return runs;
};
