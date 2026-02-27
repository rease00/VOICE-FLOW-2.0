import { GenerationSettings, NovelIdeaCard, NovelIdeaSource } from '../types';
import { generateTextContent } from './geminiService';
import { authFetch } from './authHttpClient';

export interface NovelIdeaMetadata {
  ok: boolean;
  source: NovelIdeaSource;
  url: string;
  title: string;
  synopsis: string;
  tags: string[];
  warnings: string[];
}

const toBaseUrl = (input?: string): string => {
  const raw = (input || 'http://127.0.0.1:7800').trim();
  return raw.replace(/\/+$/, '');
};

const parseBackendError = async (response: Response): Promise<string> => {
  try {
    const payload = await response.json();
    return payload?.detail || payload?.error || `${response.status} ${response.statusText}`;
  } catch {
    return `${response.status} ${response.statusText}`;
  }
};

const extractJson = (text: string): any | null => {
  if (!text) return null;
  const stripped = text.replace(/```json/gi, '').replace(/```/g, '').trim();
  const first = stripped.indexOf('{');
  const last = stripped.lastIndexOf('}');
  if (first < 0 || last < 0 || last <= first) return null;
  try {
    return JSON.parse(stripped.slice(first, last + 1));
  } catch {
    return null;
  }
};

const normalizeCards = (input: any[]): NovelIdeaCard[] => {
  const cards: NovelIdeaCard[] = [];
  input.forEach((card, idx) => {
    if (!card || typeof card !== 'object') return;
    const title = String(card.title || '').trim();
    const premise = String(card.premise || '').trim();
    const hook = String(card.hook || '').trim();
    const conflict = String(card.conflict || '').trim();
    const twist = String(card.twist || '').trim();
    if (!title || !premise) return;
    cards.push({
      id: `idea_${Date.now()}_${idx}`,
      title,
      premise,
      hook,
      conflict,
      twist,
      tone: String(card.tone || '').trim() || undefined,
      openingLine: String(card.openingLine || '').trim() || undefined,
    });
  });
  return cards.slice(0, 6);
};

export const extractNovelIdeaMetadata = async (
  backendBaseUrl: string,
  source: NovelIdeaSource,
  url: string
): Promise<NovelIdeaMetadata> => {
  const baseUrl = toBaseUrl(backendBaseUrl);
  const response = await authFetch(`${baseUrl}/novel/ideas/extract`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ source, url }),
  });

  if (!response.ok) {
    throw new Error(await parseBackendError(response));
  }

  const payload = await response.json();
  return {
    ok: Boolean(payload?.ok),
    source: payload?.source === 'pocketnovel' ? 'pocketnovel' : 'webnovel',
    url: String(payload?.url || url),
    title: String(payload?.title || '').trim(),
    synopsis: String(payload?.synopsis || '').trim(),
    tags: Array.isArray(payload?.tags) ? payload.tags.map((tag: any) => String(tag).trim()).filter(Boolean) : [],
    warnings: Array.isArray(payload?.warnings)
      ? payload.warnings.map((warning: any) => String(warning).trim()).filter(Boolean)
      : [],
  };
};

export const generateNovelIdeaCards = async (
  metadata: NovelIdeaMetadata,
  settings: GenerationSettings
): Promise<NovelIdeaCard[]> => {
  const prompt = `
Generate 4 original story idea cards inspired by the metadata below.

SOURCE: ${metadata.source}
TITLE: ${metadata.title}
SYNOPSIS: ${metadata.synopsis}
TAGS: ${metadata.tags.join(', ') || 'none'}
WARNINGS: ${metadata.warnings.join(', ') || 'none'}

Rules:
1. Ideas must be original and not copied from the source text.
2. Keep each idea concise and production-ready.
3. Return STRICT JSON with this schema:
{
  "cards": [
    {
      "title": "string",
      "premise": "string",
      "hook": "string",
      "conflict": "string",
      "twist": "string",
      "tone": "string",
      "openingLine": "string"
    }
  ]
}
Do not include markdown, explanations, or code fences.
`.trim();

  const raw = await generateTextContent(prompt, undefined, settings);
  const parsed = extractJson(raw);
  const cards = normalizeCards(Array.isArray(parsed?.cards) ? parsed.cards : []);
  if (cards.length > 0) return cards;
  throw new Error('AI returned invalid idea-card JSON. Try again with a configured provider/API key.');
};
