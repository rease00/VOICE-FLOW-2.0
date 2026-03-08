export type DubbingProcessingProfile = 'cpu_quality' | 'cpu_balanced' | 'cpu_fast';
export type DubbingSourceLanguageMode = 'auto_per_segment' | 'detected_global';

interface ProcessingProfileInput {
  durationSec?: number;
  segmentCount?: number;
  totalChars?: number;
  speakerCount?: number;
}

interface SourceLanguageModeInput {
  detectedLanguage?: string | undefined;
  texts: string[];
}

const detectScriptFamily = (text: string): string => {
  const token = String(text || '');
  if (!token.trim()) return 'none';
  if (/[\u0900-\u097F]/.test(token)) return 'devanagari';
  if (/[\u0980-\u09FF]/.test(token)) return 'bengali';
  if (/[\u0600-\u06FF]/.test(token)) return 'arabic';
  if (/[\u0400-\u04FF]/.test(token)) return 'cyrillic';
  if (/[\u3040-\u30FF]/.test(token)) return 'kana';
  if (/[\u4E00-\u9FFF]/.test(token)) return 'cjk';
  if (/[\uAC00-\uD7AF]/.test(token)) return 'hangul';
  if (/[A-Za-z]/.test(token)) return 'latin';
  return 'other';
};

export const resolveDubbingProcessingProfile = ({
  durationSec = 0,
  segmentCount = 0,
  totalChars = 0,
  speakerCount = 1,
}: ProcessingProfileInput): DubbingProcessingProfile => {
  if (durationSec >= 9 * 60 || segmentCount >= 90 || totalChars >= 9000) {
    return 'cpu_fast';
  }
  if (durationSec >= 150 || segmentCount >= 36 || totalChars >= 3600 || speakerCount >= 4) {
    return 'cpu_balanced';
  }
  return 'cpu_quality';
};

export const resolveDubbingSourceLanguageMode = ({
  detectedLanguage,
  texts,
}: SourceLanguageModeInput): DubbingSourceLanguageMode => {
  const normalizedLanguage = String(detectedLanguage || '').trim().toLowerCase();
  if (!normalizedLanguage || normalizedLanguage === 'auto' || normalizedLanguage === 'unknown') {
    return 'auto_per_segment';
  }

  const families = new Set(
    texts
      .map((text) => detectScriptFamily(text))
      .filter((family) => family !== 'none'),
  );
  if (families.size <= 1) {
    return 'detected_global';
  }
  if (families.size === 2 && families.has('latin') && (families.has('devanagari') || families.has('bengali'))) {
    return 'auto_per_segment';
  }
  if (families.size > 1) {
    return 'auto_per_segment';
  }
  return 'detected_global';
};
