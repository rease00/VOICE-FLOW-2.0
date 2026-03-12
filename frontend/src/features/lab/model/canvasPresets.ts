import type { LabCanvasPreset, LabCanvasPresetId } from '../../../../types';

export const LAB_CANVAS_PRESETS: LabCanvasPreset[] = [
  { id: 'youtube_16_9', label: 'YouTube', width: 1920, height: 1080, aspectLabel: '16:9', audienceLabel: 'YouTube' },
  { id: 'youtube_shorts_9_16', label: 'YouTube Shorts', width: 1080, height: 1920, aspectLabel: '9:16', audienceLabel: 'Shorts' },
  { id: 'tiktok_9_16', label: 'TikTok', width: 1080, height: 1920, aspectLabel: '9:16', audienceLabel: 'TikTok' },
  { id: 'instagram_story_9_16', label: 'Instagram Story & Reels', width: 1080, height: 1920, aspectLabel: '9:16', audienceLabel: 'Instagram' },
  { id: 'instagram_square_1_1', label: 'Instagram Post Square', width: 1080, height: 1080, aspectLabel: '1:1', audienceLabel: 'Instagram' },
  { id: 'instagram_portrait_4_5', label: 'Instagram Portrait', width: 1080, height: 1350, aspectLabel: '4:5', audienceLabel: 'Instagram' },
  { id: 'spotify_canvas_9_16', label: 'Spotify Canvas', width: 720, height: 1280, aspectLabel: '9:16', audienceLabel: 'Spotify' },
  { id: 'facebook_story_9_16', label: 'Facebook Story', width: 1080, height: 1920, aspectLabel: '9:16', audienceLabel: 'Facebook' },
  { id: 'snapchat_story_9_16', label: 'Snapchat Story', width: 1080, height: 1920, aspectLabel: '9:16', audienceLabel: 'Snapchat' },
  { id: 'widescreen_16_9', label: 'Widescreen', width: 1920, height: 1080, aspectLabel: '16:9', audienceLabel: 'Generic' },
  { id: 'full_portrait_9_16', label: 'Full Portrait', width: 1080, height: 1920, aspectLabel: '9:16', audienceLabel: 'Generic' },
  { id: 'square_1_1', label: 'Square', width: 1080, height: 1080, aspectLabel: '1:1', audienceLabel: 'Generic' },
  { id: 'landscape_4_3', label: 'Landscape', width: 1440, height: 1080, aspectLabel: '4:3', audienceLabel: 'Generic' },
  { id: 'portrait_4_5', label: 'Portrait', width: 1080, height: 1350, aspectLabel: '4:5', audienceLabel: 'Generic' },
  { id: 'landscape_post_5_4', label: 'Landscape Post', width: 1350, height: 1080, aspectLabel: '5:4', audienceLabel: 'Generic' },
  { id: 'vertical_2_3', label: 'Vertical', width: 1080, height: 1620, aspectLabel: '2:3', audienceLabel: 'Generic' },
  { id: 'ultrawide_21_9', label: 'Ultrawide', width: 2520, height: 1080, aspectLabel: '21:9', audienceLabel: 'Generic' },
];

export const DEFAULT_LAB_CANVAS_PRESET_ID: LabCanvasPresetId = 'youtube_16_9';
export const LAB_CANVAS_DIMENSION_LIMITS = {
  min: 240,
  max: 4320,
} as const;

const greatestCommonDivisor = (left: number, right: number): number => {
  let a = Math.abs(Math.round(left));
  let b = Math.abs(Math.round(right));
  while (b !== 0) {
    const temp = b;
    b = a % b;
    a = temp;
  }
  return a || 1;
};

export const formatLabAspectLabel = (width: number, height: number): string => {
  const safeWidth = Math.max(1, Math.round(width));
  const safeHeight = Math.max(1, Math.round(height));
  const gcd = greatestCommonDivisor(safeWidth, safeHeight);
  return `${Math.max(1, Math.round(safeWidth / gcd))}:${Math.max(1, Math.round(safeHeight / gcd))}`;
};

export const normalizeLabCanvasDimension = (value: unknown, fallback: number): number => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  const rounded = Math.round(parsed);
  return Math.min(LAB_CANVAS_DIMENSION_LIMITS.max, Math.max(LAB_CANVAS_DIMENSION_LIMITS.min, rounded));
};

export const validateLabCanvasDimensions = (
  width: unknown,
  height: unknown
): { width: number; height: number; valid: boolean } => {
  const safeWidth = normalizeLabCanvasDimension(width, 1080);
  const safeHeight = normalizeLabCanvasDimension(height, 1920);
  const valid =
    Number.isFinite(Number(width))
    && Number.isFinite(Number(height))
    && Number(width) >= LAB_CANVAS_DIMENSION_LIMITS.min
    && Number(height) >= LAB_CANVAS_DIMENSION_LIMITS.min
    && Number(width) <= LAB_CANVAS_DIMENSION_LIMITS.max
    && Number(height) <= LAB_CANVAS_DIMENSION_LIMITS.max;
  return {
    width: safeWidth,
    height: safeHeight,
    valid,
  };
};

export const buildLabCustomCanvasPreset = (
  width: unknown,
  height: unknown,
  label = 'Custom'
): LabCanvasPreset => {
  const normalized = validateLabCanvasDimensions(width, height);
  return {
    id: 'custom',
    label,
    width: normalized.width,
    height: normalized.height,
    aspectLabel: formatLabAspectLabel(normalized.width, normalized.height),
    audienceLabel: 'Custom',
    isCustom: true,
  };
};

export const getLabCanvasPreset = (presetId?: string): LabCanvasPreset => (
  LAB_CANVAS_PRESETS.find((preset) => preset.id === presetId) || LAB_CANVAS_PRESETS[0]!
);
