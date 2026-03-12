import { describe, expect, it } from 'vitest';
import {
  LAB_CANVAS_DIMENSION_LIMITS,
  buildLabCustomCanvasPreset,
  formatLabAspectLabel,
  normalizeLabCanvasDimension,
  validateLabCanvasDimensions,
} from '../src/features/lab/model/canvasPresets';

describe('lab canvas preset model', () => {
  it('normalizes dimensions within configured bounds', () => {
    expect(normalizeLabCanvasDimension(undefined, 1080)).toBe(1080);
    expect(normalizeLabCanvasDimension(LAB_CANVAS_DIMENSION_LIMITS.min - 1, 1080)).toBe(LAB_CANVAS_DIMENSION_LIMITS.min);
    expect(normalizeLabCanvasDimension(LAB_CANVAS_DIMENSION_LIMITS.max + 1, 1080)).toBe(LAB_CANVAS_DIMENSION_LIMITS.max);
  });

  it('formats aspect labels using reduced ratios', () => {
    expect(formatLabAspectLabel(1920, 1080)).toBe('16:9');
    expect(formatLabAspectLabel(1080, 1920)).toBe('9:16');
    expect(formatLabAspectLabel(1000, 1000)).toBe('1:1');
  });

  it('validates custom dimensions and reports invalid raw input', () => {
    const invalid = validateLabCanvasDimensions(120, 99999);
    expect(invalid.valid).toBe(false);
    expect(invalid.width).toBe(LAB_CANVAS_DIMENSION_LIMITS.min);
    expect(invalid.height).toBe(LAB_CANVAS_DIMENSION_LIMITS.max);

    const valid = validateLabCanvasDimensions(1280, 720);
    expect(valid.valid).toBe(true);
    expect(valid.width).toBe(1280);
    expect(valid.height).toBe(720);
  });

  it('builds custom presets with explicit metadata', () => {
    const preset = buildLabCustomCanvasPreset(1440, 1080, 'Creator Custom');
    expect(preset.id).toBe('custom');
    expect(preset.label).toBe('Creator Custom');
    expect(preset.width).toBe(1440);
    expect(preset.height).toBe(1080);
    expect(preset.aspectLabel).toBe('4:3');
    expect(preset.isCustom).toBe(true);
  });
});

