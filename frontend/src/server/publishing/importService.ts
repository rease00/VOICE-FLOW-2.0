import { API_ROUTES } from '../../shared/api/routes';

const MAX_IMPORT_BYTES = 24 * 1024 * 1024;
const PDF_MIN_TEXT_CHARS = 450;
const PDF_LOW_DENSITY_THRESHOLD = 0.6;
const NOVEL_IMPORT_MODEL_CANDIDATES = String(
  process.env.VF_NOVEL_IMPORT_MODEL_CANDIDATES
  || process.env.VF_AI_TEXT_MODEL_CANDIDATES
  || 'gemini-2.5-flash,gemini-2.5-flash-lite'
)
  .split(/[\s,;]+/)
  .map((value) => String(value || '').trim())
  .filter(Boolean);

type SupportedImportHint = 'txt' | 'pdf' | 'image';
type ImportDiagnosticsMode = 'txt' | 'pdf_text' | 'image_ai' | 'pdf_ai_fallback' | 'generic_text' | 'generic_ai';

interface ImportPageStat {
  page: number;
  chars: number;
}

interface ImportChapterPreview {
  title: string;
  text: string;
  startOffset: number;
  endOffset: number;
}

const readTrimmedEnv = (...keys: string[]): string => {
  for (const key of keys) {
    const value = String(process.env[key] || '').trim();
    if (value) return value;
  }
  return '';
};

const getGeminiApiKey = (): string => readTrimmedEnv(
  'VF_GEMINI_API_KEY',
  'GEMINI_API_KEY',
  'GOOGLE_API_KEY',
);

const resolveImportHint = (
  formatHint: string,
  contentType: string,
  filename: string,
): SupportedImportHint | null => {
  const normalizedHint = String(formatHint || '').trim().toLowerCase();
  if (normalizedHint === 'txt' || normalizedHint === 'pdf' || normalizedHint === 'image') {
    return normalizedHint;
  }

  const lowerContentType = String(contentType || '').trim().toLowerCase();
  const lowerFilename = String(filename || '').trim().toLowerCase();
  if (
    lowerContentType.startsWith('text/')
    || lowerFilename.endsWith('.txt')
    || lowerFilename.endsWith('.md')
  ) {
    return 'txt';
  }
  if (lowerContentType === 'application/pdf' || lowerFilename.endsWith('.pdf')) {
    return 'pdf';
  }
  if (
    lowerContentType.startsWith('image/')
    || lowerFilename.endsWith('.png')
    || lowerFilename.endsWith('.jpg')
    || lowerFilename.endsWith('.jpeg')
    || lowerFilename.endsWith('.webp')
    || lowerFilename.endsWith('.gif')
  ) {
    return 'image';
  }
  return null;
};

const normalizeImportText = (raw: string): string => {
  return String(raw || '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
};

const decodeUtf8WithWarnings = (buffer: Buffer): { text: string; warnings: string[] } => {
  const decoder = new TextDecoder('utf-8', { fatal: false });
  const text = decoder.decode(buffer);
  const warnings = text.includes('\uFFFD') ? ['txt_decode_replaced_invalid_bytes'] : [];
  return { text, warnings };
};

const decodePdfLiteral = (value: string): string => {
  return value
    .replace(/\\([\\()])/g, '$1')
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\r')
    .replace(/\\t/g, '\t')
    .replace(/\\([0-7]{1,3})/g, (_match, octal) => String.fromCharCode(Number.parseInt(octal, 8)))
    .replace(/\\f/g, '')
    .replace(/\\b/g, '');
};

const extractPdfPageText = (segment: string): string => {
  const operatorMatches = Array.from(
    segment.matchAll(/\((?:\\.|[^\\()]){1,1200}\)\s*(?:Tj|TJ|'|")/g)
  );
  const source = operatorMatches.length > 0
    ? operatorMatches.map((match) => match[0])
    : Array.from(segment.matchAll(/\((?:\\.|[^\\()]){4,1200}\)/g)).map((match) => match[0]);

  const fragments = source
    .map((token) => {
      const inner = token.replace(/^\(/, '').replace(/\)\s*(?:Tj|TJ|'|")?$/, '');
      return decodePdfLiteral(inner);
    })
    .map((token) => token.replace(/[^\S\n]+/g, ' ').trim())
    .filter((token) => token.length >= 2);

  return normalizeImportText(fragments.join('\n'));
};

const extractPdfTextLayer = (buffer: Buffer): { text: string; pageStats: ImportPageStat[]; likelyScanned: boolean } => {
  const raw = buffer.toString('latin1');
  const pageSegments = raw.split(/\/Type\s*\/Page\b/g).slice(1);
  const segments = pageSegments.length > 0 ? pageSegments : [raw];
  const pageStats: ImportPageStat[] = [];
  const pageTexts: string[] = [];
  let lowDensityPages = 0;

  segments.forEach((segment, index) => {
    const extracted = extractPdfPageText(segment);
    const chars = extracted.length;
    if (chars < 80) {
      lowDensityPages += 1;
    }
    pageStats.push({ page: index + 1, chars });
    if (extracted) {
      pageTexts.push(extracted);
    }
  });

  const merged = normalizeImportText(pageTexts.join('\n\n'));
  const totalChars = merged.length;
  const pageCount = Math.max(1, pageStats.length);
  const lowDensityRatio = lowDensityPages / pageCount;
  return {
    text: merged,
    pageStats,
    likelyScanned: totalChars < PDF_MIN_TEXT_CHARS || lowDensityRatio >= PDF_LOW_DENSITY_THRESHOLD,
  };
};

const extractGeminiText = async (
  payload: Buffer,
  mimeType: string,
  languageHint: string,
  label: string,
): Promise<string> => {
  const apiKey = getGeminiApiKey();
  if (!apiKey) {
    throw new Error('Gemini API key is not configured.');
  }

  const prompt = [
    `Extract all readable text from this ${label}.`,
    'Preserve paragraph breaks, chapter headings, and dialogue formatting when visible.',
    'Do not summarize, explain, or add commentary.',
    languageHint && languageHint !== 'auto'
      ? `Return the extracted text in the source language. The likely language is ${languageHint}.`
      : 'Return the extracted text exactly as written in the source language.',
    'Return only plain text.',
  ].join('\n');

  let lastError: Error | null = null;
  for (const model of NOVEL_IMPORT_MODEL_CANDIDATES) {
    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [
              {
                role: 'user',
                parts: [
                  { text: prompt },
                  {
                    inlineData: {
                      mimeType,
                      data: payload.toString('base64'),
                    },
                  },
                ],
              },
            ],
            generationConfig: {
              temperature: 0.1,
            },
          }),
          cache: 'no-store',
        },
      );

      const json = await response.json().catch(() => null) as {
        candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
        error?: { message?: string };
      } | null;
      if (!response.ok) {
        throw new Error(String(json?.error?.message || `${response.status} ${response.statusText}`));
      }
      const extracted = String(
        json?.candidates?.[0]?.content?.parts
          ?.map((part) => String(part?.text || ''))
          .join('') || '',
      ).trim();
      if (!extracted) {
        throw new Error('Gemini returned empty extracted text.');
      }
      return normalizeImportText(extracted);
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
    }
  }

  throw new Error(lastError?.message || 'Gemini multimodal extraction failed.');
};

const splitTextByHeadings = (rawText: string): ImportChapterPreview[] => {
  const pattern = /^(?:chapter|part)\s+([0-9ivxlcdm]+|one|two|three|four|five|six|seven|eight|nine|ten)?(?:\s*[-:.\u2014]\s*[^\n]{0,100}|[^\n]{0,100})$/gim;
  const matches = Array.from(rawText.matchAll(pattern));
  if (matches.length < 2) {
    return [];
  }

  return matches
    .map((match, index) => {
      const start = match.index ?? 0;
      const end = index + 1 < matches.length ? (matches[index + 1]?.index ?? rawText.length) : rawText.length;
      const text = rawText.slice(start, end).trim();
      if (!text) return null;
      return {
        title: text.split('\n')[0]?.trim().slice(0, 120) || `Chapter ${index + 1}`,
        text,
        startOffset: start,
        endOffset: end,
      } satisfies ImportChapterPreview;
    })
    .filter((chapter): chapter is ImportChapterPreview => Boolean(chapter));
};

const splitTextByLength = (rawText: string): ImportChapterPreview[] => {
  const paragraphPattern = /\S[\s\S]*?(?=\n{2,}|\Z)/g;
  const paragraphMatches = Array.from(rawText.matchAll(paragraphPattern));
  if (paragraphMatches.length === 0) {
    return [];
  }

  const chunks: ImportChapterPreview[] = [];
  let currentParts: string[] = [];
  let currentStart: number | null = null;
  let currentEnd: number | null = null;
  let currentWords = 0;
  const targetWords = 1300;
  const minWords = 700;

  for (const paragraphMatch of paragraphMatches) {
    const paragraph = String(paragraphMatch[0] || '').trim();
    if (!paragraph) continue;
    const paraWords = paragraph.split(/\s+/).filter(Boolean).length;
    const paragraphStart = paragraphMatch.index ?? 0;
    if (currentStart === null) {
      currentStart = paragraphStart;
    }

    const shouldFlush = currentWords >= minWords && (currentWords + paraWords) > targetWords;
    if (shouldFlush && currentParts.length > 0 && currentStart !== null && currentEnd !== null) {
      chunks.push({
        title: `Chapter ${String(chunks.length + 1).padStart(3, '0')}`,
        text: currentParts.join('\n\n').trim(),
        startOffset: currentStart,
        endOffset: currentEnd,
      });
      currentParts = [];
      currentWords = 0;
      currentStart = paragraphStart;
    }

    currentParts.push(paragraph);
    currentWords += paraWords;
    currentEnd = paragraphStart + paragraphMatch[0].length;
  }

  if (currentParts.length > 0 && currentStart !== null && currentEnd !== null) {
    chunks.push({
      title: `Chapter ${String(chunks.length + 1).padStart(3, '0')}`,
      text: currentParts.join('\n\n').trim(),
      startOffset: currentStart,
      endOffset: currentEnd,
    });
  }

  return chunks;
};

export const handlePublishingImportExtractRoute = async (request: Request): Promise<Response> => {
  const form = await request.formData();
  const file = form.get('file');
  const formatHint = String(form.get('format_hint') || 'auto');
  const languageHint = String(form.get('language_hint') || 'auto').trim() || 'auto';

  if (!(file instanceof File)) {
    return Response.json({ error: 'file is required.' }, { status: 400 });
  }

  const hint = resolveImportHint(formatHint, file.type, file.name);
  if (!hint) {
    return Response.json({ error: 'Unsupported file type. Use TXT, PDF, or image.' }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  if (buffer.length === 0) {
    return Response.json({ error: 'Uploaded file is empty.' }, { status: 400 });
  }
  if (buffer.length > MAX_IMPORT_BYTES) {
    return Response.json({ error: 'File is too large. Maximum 24MB.' }, { status: 413 });
  }

  const warnings: string[] = [];
  let pageStats: ImportPageStat[] = [];
  let usedAiFallback = false;
  let mode: ImportDiagnosticsMode = 'txt';
  let rawText = '';

  try {
    if (hint === 'txt') {
      const decoded = decodeUtf8WithWarnings(buffer);
      rawText = decoded.text;
      warnings.push(...decoded.warnings);
      mode = 'txt';
    } else if (hint === 'pdf') {
      mode = 'pdf_text';
      try {
        const extracted = extractPdfTextLayer(buffer);
        rawText = extracted.text;
        pageStats = extracted.pageStats;
        if (extracted.likelyScanned) {
          warnings.push('pdf_text_layer_low_density');
          rawText = await extractGeminiText(buffer, 'application/pdf', languageHint, 'PDF document');
          usedAiFallback = true;
          mode = 'pdf_ai_fallback';
        }
      } catch (error) {
        warnings.push(`pdf_parser_failed:${error instanceof Error ? error.message : String(error)}`);
        rawText = await extractGeminiText(buffer, 'application/pdf', languageHint, 'PDF document');
        usedAiFallback = true;
        mode = 'pdf_ai_fallback';
      }
    } else {
      const mimeType = String(file.type || '').trim() || 'image/png';
      rawText = await extractGeminiText(buffer, mimeType, languageHint, 'image document');
      usedAiFallback = true;
      mode = 'image_ai';
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return Response.json({ error: message || 'Novel import extraction failed.' }, { status: 422 });
  }

  const normalizedText = normalizeImportText(rawText);
  if (!normalizedText) {
    return Response.json({ error: 'No text could be extracted from the uploaded file.' }, { status: 422 });
  }

  return Response.json({
    ok: true,
    rawText: normalizedText,
    diagnostics: {
      mode,
      warnings,
      usedAiFallback,
    },
    pageStats,
  });
};

export const handlePublishingImportSplitRoute = async (request: Request): Promise<Response> => {
  let body: { rawText?: unknown; strategy?: unknown } = {};
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  const rawText = normalizeImportText(String(body.rawText || ''));
  const strategy = String(body.strategy || 'auto').trim().toLowerCase();

  if (!rawText) {
    return Response.json({ error: 'rawText is required.' }, { status: 400 });
  }

  const normalizedStrategy = strategy === 'heading_first' || strategy === 'length_fallback' || strategy === 'auto'
    ? strategy
    : 'auto';

  const warnings: string[] = [];
  let chapters: ImportChapterPreview[] = [];

  if (normalizedStrategy === 'heading_first' || normalizedStrategy === 'auto') {
    chapters = splitTextByHeadings(rawText);
    if (normalizedStrategy === 'heading_first' && chapters.length === 0) {
      warnings.push('heading_split_no_matches');
    }
  }

  if (chapters.length === 0) {
    chapters = splitTextByLength(rawText);
    if (normalizedStrategy === 'auto') {
      warnings.push('used_length_fallback');
    }
  }

  if (chapters.length === 0) {
    chapters = [{
      title: 'Chapter 001',
      text: rawText,
      startOffset: 0,
      endOffset: rawText.length,
    }];
  }

  return Response.json({
    ok: true,
    chapters,
    warnings,
  });
};

export const buildPublishingImportExtractUrl = (baseUrl?: string): string => {
  const safeBase = String(baseUrl || '').trim().replace(/\/+$/, '');
  return safeBase ? `${safeBase}${API_ROUTES.publishing.importExtract}` : API_ROUTES.publishing.importExtract;
};
