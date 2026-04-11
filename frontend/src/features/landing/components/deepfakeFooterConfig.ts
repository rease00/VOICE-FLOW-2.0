export const WATERMARK_CHECK_PROXY_PATH = '/api/backend/v2/extract-watermark';
export const WATERMARK_CHECK_FORM_FIELD = 'file';
export const WATERMARK_FILE_ACCEPT = '.wav,audio/wav,audio/x-wav,audio/wave';

const SUPPORTED_WAVE_MIME_TYPES = new Set([
  'audio/wav',
  'audio/x-wav',
  'audio/wave',
  'audio/vnd.wave',
]);

export const isSupportedWatermarkFile = (file: { name?: string | null; type?: string | null }): boolean => {
  const fileName = String(file?.name || '').trim().toLowerCase();
  const fileType = String(file?.type || '').trim().toLowerCase();
  return fileName.endsWith('.wav') || SUPPORTED_WAVE_MIME_TYPES.has(fileType);
};
