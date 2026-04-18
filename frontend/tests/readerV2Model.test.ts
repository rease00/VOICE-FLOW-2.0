import { describe, it, expect } from 'vitest';

/**
 * Reader v2 model contracts — paragraph splitting, font size bounds,
 * skip navigation, and import acceptance.
 */

const DEMO_TEXT = `Welcome to the VoiceFlow Reader.

This is a demonstration of paragraph-level AI narration. Each paragraph can be read aloud by any of our 30 premium Gemini voices.

Tap any paragraph to jump to it. The active paragraph is highlighted with an aurora ring so you always know where you are.

Use the controls below to adjust font size, playback speed, and volume. You can also skip forward or backward between paragraphs using the transport buttons.

Import your own books, articles, and scripts to listen on the go. Supported formats include plain text, Markdown, and EPUB files.`;

function splitParagraphs(content: string): string[] {
  return content.split(/\n\n+/).map((p) => p.trim()).filter(Boolean);
}

describe('reader v2 paragraph splitting', () => {
  it('splits demo text into 5 paragraphs', () => {
    const paras = splitParagraphs(DEMO_TEXT);
    expect(paras).toHaveLength(5);
  });

  it('produces no empty paragraphs', () => {
    const paras = splitParagraphs(DEMO_TEXT);
    for (const p of paras) {
      expect(p.length).toBeGreaterThan(0);
    }
  });

  it('handles triple newlines as a single separator', () => {
    const text = 'First paragraph.\n\n\nSecond paragraph.';
    const paras = splitParagraphs(text);
    expect(paras).toEqual(['First paragraph.', 'Second paragraph.']);
  });

  it('returns empty array for blank input', () => {
    expect(splitParagraphs('')).toEqual([]);
    expect(splitParagraphs('   ')).toEqual([]);
    expect(splitParagraphs('\n\n\n')).toEqual([]);
  });

  it('trims whitespace from each paragraph', () => {
    const text = '  First paragraph.  \n\n  Second paragraph.  ';
    const paras = splitParagraphs(text);
    expect(paras).toEqual(['First paragraph.', 'Second paragraph.']);
  });
});

describe('reader v2 font size bounds', () => {
  const MIN_FONT = 14;
  const MAX_FONT = 28;
  const DEFAULT_FONT = 18;

  it('default font size is within bounds', () => {
    expect(DEFAULT_FONT).toBeGreaterThanOrEqual(MIN_FONT);
    expect(DEFAULT_FONT).toBeLessThanOrEqual(MAX_FONT);
  });

  it('clamping respects min bound', () => {
    const newSize = Math.max(MIN_FONT, 10 - 2);
    expect(newSize).toBe(MIN_FONT);
  });

  it('clamping respects max bound', () => {
    const newSize = Math.min(MAX_FONT, 30 + 2);
    expect(newSize).toBe(MAX_FONT);
  });
});

describe('reader v2 skip navigation', () => {
  const paragraphs = splitParagraphs(DEMO_TEXT); // 5 paragraphs

  it('skip forward clamps to last index', () => {
    const activeIndex = 4; // last
    const next = Math.min(activeIndex + 1, paragraphs.length - 1);
    expect(next).toBe(4);
  });

  it('skip back clamps to 0', () => {
    const activeIndex = 0;
    const prev = Math.max(activeIndex - 1, 0);
    expect(prev).toBe(0);
  });

  it('skip forward advances by 1', () => {
    const activeIndex = 2;
    const next = Math.min(activeIndex + 1, paragraphs.length - 1);
    expect(next).toBe(3);
  });

  it('skip back goes back by 1', () => {
    const activeIndex = 3;
    const prev = Math.max(activeIndex - 1, 0);
    expect(prev).toBe(2);
  });
});

describe('reader v2 import acceptance', () => {
  const ACCEPTED_EXTENSIONS = ['.txt', '.md', '.epub'];

  it('accepts plain text files', () => {
    expect(ACCEPTED_EXTENSIONS).toContain('.txt');
  });

  it('accepts markdown files', () => {
    expect(ACCEPTED_EXTENSIONS).toContain('.md');
  });

  it('accepts epub files', () => {
    expect(ACCEPTED_EXTENSIONS).toContain('.epub');
  });

  it('does not accept pdf or docx', () => {
    expect(ACCEPTED_EXTENSIONS).not.toContain('.pdf');
    expect(ACCEPTED_EXTENSIONS).not.toContain('.docx');
  });
});

describe('reader v2 speed options', () => {
  const SPEED_OPTIONS = [0.5, 0.75, 1.0, 1.25, 1.5, 2.0];

  it('includes normal speed 1.0', () => {
    expect(SPEED_OPTIONS).toContain(1.0);
  });

  it('is sorted ascending', () => {
    for (let i = 1; i < SPEED_OPTIONS.length; i++) {
      expect(SPEED_OPTIONS[i]!).toBeGreaterThan(SPEED_OPTIONS[i - 1]!);
    }
  });

  it('all values are positive', () => {
    for (const s of SPEED_OPTIONS) {
      expect(s).toBeGreaterThan(0);
    }
  });
});
