export const ASSISTANT_PROVIDER_UI_LABELS = {
  GEMINI: 'Primary AI',
  PERPLEXITY: 'Perplexity',
  LOCAL: 'Local',
} as const;

const UI_TEXT_REPLACEMENTS: Array<[RegExp, string]> = [
  [/\bgemini runtime\b/gi, 'Cloud runtime'],
  [/\bkokoro runtime\b/gi, 'Basic runtime'],
  [/\bgemini key pool\b/gi, 'Primary AI key pool'],
  [/\bgemini pool\b/gi, 'Primary AI pool'],
  [/\bgemini api key\b/gi, 'Primary AI API key'],
  [/\bpersonal gemini key\b/gi, 'personal API key'],
  [/\bgemini\b/gi, 'Primary AI'],
  [/\bkokoro\b/gi, 'Basic'],
];

export const sanitizeUiText = (input: string): string => {
  let value = String(input || '');
  for (const [pattern, replacement] of UI_TEXT_REPLACEMENTS) {
    value = value.replace(pattern, replacement);
  }
  return value;
};
