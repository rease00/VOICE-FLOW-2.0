import { describe, expect, it } from 'vitest';
import { resolveLegacyReaderRedirect } from '../src/app/legacyReaderRedirect';

describe('resolveLegacyReaderRedirect', () => {
  it('falls back to the library home when no reader context is present', () => {
    expect(resolveLegacyReaderRedirect(undefined, undefined)).toBe('/app/library');
  });

  it('maps legacy mode and title slugs onto the new library read route', () => {
    expect(resolveLegacyReaderRedirect(['novel', '1342'], {
      chapter: '7',
      'vf-reader-mode': 'novel',
      'vf-reader-item': '1342',
    })).toBe('/app/library/1342/read?chapter=7');
  });

  it('uses legacy reader query state when the book id only exists in search params', () => {
    expect(resolveLegacyReaderRedirect(undefined, {
      'vf-reader-item': 'OL12345W',
      'vf-reader-title': 'Pride and Prejudice',
      tab: 'notes',
    })).toBe('/app/library/OL12345W/read?tab=notes');
  });

  it('supports single-segment reader slugs during the migration window', () => {
    expect(resolveLegacyReaderRedirect(['local-book-42'], { chapter: '2' })).toBe(
      '/app/library/local-book-42/read?chapter=2',
    );
  });
});
