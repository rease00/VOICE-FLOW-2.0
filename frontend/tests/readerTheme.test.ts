import { describe, expect, it } from 'vitest';
import { getReaderThemeClassName } from '../src/features/reader/components/readerTheme';

describe('reader theme mapping', () => {
  it('maps light and dark themes', () => {
    expect(getReaderThemeClassName('light')).toBe('vf-reader-v2 vf-reader-v2--light');
    expect(getReaderThemeClassName('dark')).toBe('vf-reader-v2 vf-reader-v2--dark');
  });
});
