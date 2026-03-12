import { sanitizeTtsEngineText } from '../../../services/engineDisplay';

export const ASSISTANT_PROVIDER_UI_LABELS = {
  GEMINI: 'Primary AI',
  PERPLEXITY: 'Perplexity',
  LOCAL: 'Local',
} as const;

const UI_TEXT_REPLACEMENTS: Array<[RegExp, string]> = [
  [/\bgemini key pool\b/gi, 'Primary AI key pool'],
  [/\bgemini pool\b/gi, 'Primary AI pool'],
  [/\bgemini api key\b/gi, 'Primary AI API key'],
  [/\bpersonal gemini key\b/gi, 'personal API key'],
  [/\bgemini\b/gi, 'Primary AI'],
];

export const sanitizeUiText = (input: string): string => {
  let value = sanitizeTtsEngineText(String(input || ''));
  for (const [pattern, replacement] of UI_TEXT_REPLACEMENTS) {
    value = value.replace(pattern, replacement);
  }
  return value;
};

export const joinUiFragments = (
  fragments: Array<string | number | null | undefined | false>,
  separator = ' | '
): string =>
  fragments
    .map((fragment) => (typeof fragment === 'string' ? sanitizeUiText(fragment) : fragment))
    .filter((fragment): fragment is string | number => fragment !== null && fragment !== undefined && fragment !== false && String(fragment).trim() !== '')
    .map((fragment) => String(fragment).trim())
    .join(separator);
