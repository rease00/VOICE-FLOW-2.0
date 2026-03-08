import { describe, expect, it } from 'vitest';
import { getReaderThemeClassName } from '../src/features/reader/components/readerTheme';

describe('reader theme mapping', () => {
  it('maps light theme to the reader root classes', () => {
    expect(getReaderThemeClassName('light')).toBe('vf-reader vf-reader--light');
  });

  it('maps dark theme to the reader root classes', () => {
    expect(getReaderThemeClassName('dark')).toBe('vf-reader vf-reader--dark');
  });
});
