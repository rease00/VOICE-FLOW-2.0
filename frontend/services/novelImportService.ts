import { NovelImportChapterPreview, NovelImportExtractDiagnostics, NovelImportPageStat } from '../types';
import { authFetch } from './authHttpClient';

const toBaseUrl = (input?: string): string => {
  const raw = String(input || 'http://127.0.0.1:7800').trim();
  return raw.replace(/\/+$/, '');
};

const parseBackendError = async (response: Response): Promise<string> => {
  try {
    const payload = await response.json();
    return String(payload?.detail || payload?.error || `${response.status} ${response.statusText}`);
  } catch {
    return `${response.status} ${response.statusText}`;
  }
};

const detectFormatHint = (file: File): 'txt' | 'pdf' | 'image' | 'unknown' => {
  const mime = String(file.type || '').toLowerCase();
  const lowerName = file.name.toLowerCase();
  if (mime.startsWith('text/') || lowerName.endsWith('.txt')) return 'txt';
  if (mime === 'application/pdf' || lowerName.endsWith('.pdf')) return 'pdf';
  if (
    mime.startsWith('image/') ||
    lowerName.endsWith('.png') ||
    lowerName.endsWith('.jpg') ||
    lowerName.endsWith('.jpeg') ||
    lowerName.endsWith('.webp')
  ) {
    return 'image';
  }
  return 'unknown';
};

export interface NovelImportExtractResponse {
  rawText: string;
  diagnostics: NovelImportExtractDiagnostics;
  pageStats: NovelImportPageStat[];
}

export const extractNovelTextFromFile = async (
  backendBaseUrl: string,
  file: File,
  languageHint = 'auto'
): Promise<NovelImportExtractResponse> => {
  const form = new FormData();
  form.append('file', file);
  form.append('format_hint', detectFormatHint(file));
  form.append('language_hint', languageHint || 'auto');

  const response = await authFetch(`${toBaseUrl(backendBaseUrl)}/novel/import/extract`, {
    method: 'POST',
    body: form,
  });
  if (!response.ok) throw new Error(await parseBackendError(response));

  const payload = await response.json();
  const mode = payload?.diagnostics?.mode;
  const normalizedMode: NovelImportExtractDiagnostics['mode'] =
    mode === 'txt' || mode === 'pdf_text' || mode === 'image_ai' || mode === 'pdf_ai_fallback'
      ? mode
      : 'txt';

  return {
    rawText: String(payload?.rawText || ''),
    diagnostics: {
      mode: normalizedMode,
      warnings: Array.isArray(payload?.diagnostics?.warnings)
        ? payload.diagnostics.warnings.map((item: unknown) => String(item)).filter(Boolean)
        : [],
      usedAiFallback: Boolean(payload?.diagnostics?.usedAiFallback),
    },
    pageStats: Array.isArray(payload?.pageStats)
      ? payload.pageStats
          .map((item: any) => ({
            page: Number(item?.page || 0),
            chars: Number(item?.chars || 0),
          }))
          .filter((item: NovelImportPageStat) => Number.isFinite(item.page) && item.page > 0)
      : [],
  };
};

export const splitImportedTextToChapters = async (
  backendBaseUrl: string,
  rawText: string,
  strategy: 'auto' | 'heading_first' | 'length_fallback' = 'auto'
): Promise<{ chapters: NovelImportChapterPreview[]; warnings: string[] }> => {
  const response = await authFetch(`${toBaseUrl(backendBaseUrl)}/novel/import/split`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rawText, strategy }),
  });
  if (!response.ok) throw new Error(await parseBackendError(response));

  const payload = await response.json();
  const chapters: NovelImportChapterPreview[] = Array.isArray(payload?.chapters)
    ? payload.chapters
        .map((item: any) => ({
          title: String(item?.title || '').trim() || 'Untitled Chapter',
          text: String(item?.text || ''),
          startOffset: Number(item?.startOffset || 0),
          endOffset: Number(item?.endOffset || 0),
        }))
        .filter((item: NovelImportChapterPreview) => item.text.trim().length > 0)
    : [];

  return {
    chapters,
    warnings: Array.isArray(payload?.warnings)
      ? payload.warnings.map((item: unknown) => String(item)).filter(Boolean)
      : [],
  };
};
