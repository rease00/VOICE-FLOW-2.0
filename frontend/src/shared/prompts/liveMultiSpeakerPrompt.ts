export interface LiveMultiSpeakerPromptOptions {
  castNames?: string[];
  sourceText?: string;
  topic?: string;
  pacingStyle?: string;
  language?: string;
  style?: string;
  tone?: string;
  transcriptSummary?: string;
  transcriptTail?: string;
  windowIndex?: number;
  estimatedWindows?: number;
  targetChars?: number;
}

export interface LiveMultiSpeakerPromptBundle {
  systemPrompt: string;
  userPrompt: string;
}

const STUDIO_SOURCE_TEXT_CHAR_CAP = 2000;

const normalizeWhitespace = (value: string): string => String(value || '').replace(/\s+/g, ' ').trim();

const normalizeNames = (names: string[] | undefined, fallback: string[]): string[] => {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const rawName of [...(names || []), ...fallback]) {
    const name = normalizeWhitespace(rawName);
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out;
};

const buildCastBlock = (castNames: string[] | undefined, fallback: string[]): string => {
  const names = normalizeNames(castNames, fallback);
  if (names.length === 0) return 'Allowed cast: (none provided)';
  return [
    'Allowed cast:',
    ...names.map((name, index) => `${index + 1}. ${name}`),
  ].join('\n');
};

const buildSharedRules = (): string => [
  'Shared live dialogue rules:',
  '1. Always use the canonical speaker header format "(Speaker Name) :".',
  '2. If delivery metadata helps, use "(Speaker Name) (Emotion) :".',
  '3. Keep speaker names stable and do not invent new speakers.',
  '4. Do not use bare "Speaker:" headers or markdown bullets/headings.',
  '5. Keep handoffs concise and natural for live TTS.',
  '6. Preserve the source language/script exactly as written.',
].join('\n');

export const buildStudioLiveMultiSpeakerPrompt = (options: LiveMultiSpeakerPromptOptions): LiveMultiSpeakerPromptBundle => {
  const castBlock = buildCastBlock(options.castNames, ['Narrator', 'Speaker 1']);
  const systemPrompt = [
    'You are a Studio AI Director for Vector native-audio rendering.',
    'Return only a strict render-ready JSON response.',
    buildSharedRules(),
    '',
    castBlock,
    '',
    `Preferred style: ${normalizeWhitespace(options.style || 'natural') || 'natural'}`,
    `Preferred tone: ${normalizeWhitespace(options.tone || 'neutral') || 'neutral'}`,
    '',
    'Native-audio render contract (Studio only):',
    'A. Speak the supplied text only. Do not continue, expand, or invent dialogue.',
    'B. Keep the supplied speaker headers and speaker names exactly as given.',
    'C. Preserve the original wording, punctuation, order, and line breaks.',
    'D. Add at most one emotion tag per spoken line, and only when the source already makes that emotion explicit.',
    'E. Preserve existing bracketed stage directions only if they already exist in the source. Do not add new cue tags.',
    '',
    'Rules:',
    '1. Preserve the source text wording, punctuation, order, and line breaks exactly.',
    '2. Do not paraphrase, summarize, translate, reorder, reformat, merge, or split lines.',
    '3. Use only parenthesized speaker headers such as "(Speaker Name) :" and keep speaker identities unchanged.',
    '4. Do not add crew tags, extra performance cues, helper narration, markdown, bullets, or meta commentary.',
    '5. Infer cast metadata from the supplied text only and never invent extra speaking turns.',
    '6. Output only valid JSON.',
    '',
    'Output JSON schema:',
    '{',
    '  "cast": [',
    '    { "name": "string", "gender": "Male|Female|Unknown", "age": "Child|Young Adult|Adult|Elderly|undefined" }',
    '  ],',
    '  "script": "string",',
    '  "mood": "string"',
    '}',
  ].join('\n');

  const userPrompt = [
    'Source text to direct:',
    `"${normalizeWhitespace(options.sourceText || '').slice(0, STUDIO_SOURCE_TEXT_CHAR_CAP)}"`,
  ].join('\n');

  return { systemPrompt, userPrompt };
};
