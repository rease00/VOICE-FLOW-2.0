import { generateTextWithVertex, isVertexTextConfigured } from '../vertexTextService';
import { splitLongLine } from '../audioNovel/input';

const MAX_SCRIPT_INPUT_CHARS = 15_000;
const SUPPORTED_EMOTIONS = [
  'narration',
  'angry',
  'sad',
  'excited',
  'whisper',
  'dramatic',
  'cold',
  'fearful',
  'happy',
  'sarcastic',
  'confused',
  'commanding',
  'gentle',
  'tense',
  'laugh',
] as const;

const SCRIPT_SYSTEM_PROMPT = [
  'You are a narration script director for an audiobook reader.',
  'Convert the chapter into a playback-ready script that stays faithful to the original text.',
  'Return only script lines in this exact format for GEM TTS:',
  '[Speaker|emotion|pace|cue]: dialogue or narration',
  '',
  `Allowed emotions: ${SUPPORTED_EMOTIONS.join(', ')}`,
  'Allowed paces: fast, normal, slow',
  'Allowed cues: none, pause, breath, sigh',
  'Rules:',
  '- Preserve the chapter order and plot details exactly.',
  '- Do not summarize, skip, or add content.',
  '- Use Narrator for prose and unattributed lines.',
  '- Keep quoted dialogue with the most likely speaker only when the source makes that speaker obvious.',
  '- Do not return markdown, bullets, JSON, commentary, or code fences.',
  '- Each line must stay short enough for TTS chunking; split long narration into multiple tagged lines when needed.',
  '- AND USE ONLY THIS FORMAT FOR ALL LINES.',
].join('\n');

export interface GenerateReaderScriptInput {
  text: string;
  chapterTitle?: string | undefined;
  directorNotes?: string | undefined;
}

export interface GenerateReaderScriptResult {
  annotatedText: string;
  source: 'vertex' | 'fallback';
}

const normalizeWhitespace = (value: string): string => (
  String(value || '')
    .replace(/\r/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
);

const stripPresentationNoise = (value: string): string => (
  String(value || '')
    .replace(/^```[\w-]*\s*/i, '')
    .replace(/```$/i, '')
    .replace(/^here(?:'s| is)\s+the\s+script:\s*/i, '')
    .trim()
);

const buildFallbackScript = (text: string): string => {
  const safeText = normalizeWhitespace(text);
  if (!safeText) return '';

  return safeText
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.replace(/\n+/g, ' ').replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .flatMap((paragraph) => splitLongLine(paragraph, 2_600))
    .map((line) => `[Narrator|narration|normal|none]: ${line}`)
    .join('\n');
};

const normalizeGeneratedScript = (generated: string, fallbackText: string): string => {
  const cleaned = normalizeWhitespace(stripPresentationNoise(generated));
  if (!cleaned) {
    return buildFallbackScript(fallbackText);
  }

  const normalizedLines = cleaned
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) => {
      const bracketedWithoutEmotion = line.match(/^\[([^\]|]+)]\s*:\s*(.+)$/);
      if (bracketedWithoutEmotion) {
        const speaker = bracketedWithoutEmotion[1]?.trim() || 'Narrator';
        const content = bracketedWithoutEmotion[2]?.trim() || '';
        return content ? [`[${speaker}|narration|normal|none]: ${content}`] : [];
      }

      if (line.startsWith('[') && line.includes(']:')) {
        return [line];
      }

      if (/^[A-Za-z][A-Za-z0-9_\s]{0,30}:\s+/.test(line)) {
        const separatorIndex = line.indexOf(':');
        const speaker = line.slice(0, separatorIndex).trim() || 'Narrator';
        const content = line.slice(separatorIndex + 1).trim();
        return content ? [`[${speaker}|narration|normal|none]: ${content}`] : [];
      }

      return splitLongLine(line, 2_600).map((chunk) => `[Narrator|narration|normal|none]: ${chunk}`);
    });

  return normalizedLines.length > 0
    ? normalizedLines.join('\n')
    : buildFallbackScript(fallbackText);
};

const buildUserPrompt = (input: GenerateReaderScriptInput): string => {
  const safeText = normalizeWhitespace(input.text).slice(0, MAX_SCRIPT_INPUT_CHARS);
  const safeNotes = normalizeWhitespace(input.directorNotes || '');
  const safeChapterTitle = normalizeWhitespace(input.chapterTitle || '');

  return [
    safeChapterTitle ? `Chapter title: ${safeChapterTitle}` : '',
    safeNotes ? `Director notes: ${safeNotes}` : '',
    'Source text:',
    safeText,
  ].filter(Boolean).join('\n\n');
};

export const generateReaderScript = async (
  input: GenerateReaderScriptInput,
): Promise<GenerateReaderScriptResult> => {
  const safeText = normalizeWhitespace(input.text);
  if (!safeText) {
    throw new Error('text is required.');
  }

  const fallback = buildFallbackScript(safeText);
  if (!isVertexTextConfigured()) {
    return {
      annotatedText: fallback,
      source: 'fallback',
    };
  }

  try {
    const generated = await generateTextWithVertex({
      systemPrompt: SCRIPT_SYSTEM_PROMPT,
      userPrompt: buildUserPrompt(input),
      temperature: 0.35,
    });

    return {
      annotatedText: normalizeGeneratedScript(generated, safeText),
      source: 'vertex',
    };
  } catch {
    return {
      annotatedText: fallback,
      source: 'fallback',
    };
  }
};

export const handleAiScriptRoute = async (request: Request): Promise<Response> => {
  try {
    const body = await request.json().catch(() => null) as GenerateReaderScriptInput | null;
    const text = String(body?.text || '').trim();
    if (!text) {
      return Response.json({ error: 'text is required.' }, { status: 400 });
    }

    const result = await generateReaderScript({
      text,
      chapterTitle: body?.chapterTitle,
      directorNotes: body?.directorNotes,
    });

    return Response.json(result, {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'AI script generation failed.';
    return Response.json({ error: message }, { status: 500 });
  }
};
