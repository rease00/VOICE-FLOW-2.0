import { describe, expect, it } from 'vitest';
import { buildReaderDeepLink, isReaderPath, parseReaderDeepLink } from '../src/features/reader/model/route';

describe('reader route model', () => {
  it('parses legacy and canonical path-based deep links', () => {
    const parsedNovel = parseReaderDeepLink('/reader/novel/title-1', '?tab=read&chapter=12');
    expect(parsedNovel).toEqual({
      mode: 'novel',
      titleId: 'title-1',
      tab: 'read',
      chapter: 12,
    });

    const parsedCanonicalNovel = parseReaderDeepLink('/app/reader/novel/title-1', '?tab=read&chapter=12');
    expect(parsedCanonicalNovel).toEqual({
      mode: 'novel',
      titleId: 'title-1',
      tab: 'read',
      chapter: 12,
    });

    const parsedComic = parseReaderDeepLink('/reader/comic/series-4', '?tab=panels&episode=2');
    expect(parsedComic).toEqual({
      mode: 'comic',
      titleId: 'series-4',
      tab: 'panels',
      episode: 2,
    });
  });

  it('parses legacy vf-reader query links as fallback', () => {
    const parsed = parseReaderDeepLink(
      '/app',
      '?vf-reader-mode=comic&vf-reader-item=legacy-22&vf-reader-tab=text&vf-reader-episode=3'
    );
    expect(parsed).toEqual({
      mode: 'comic',
      titleId: 'legacy-22',
      tab: 'scripts',
      episode: 3,
    });
  });

  it('serializes canonical links and includes legacy compatibility keys', () => {
    const href = buildReaderDeepLink(
      {
        mode: 'novel',
        titleId: 'book-7',
        tab: 'settings',
        chapter: 6,
      },
      'https://example.com/app?vf-screen=main&vf-tab=READER'
    );
    expect(href).toContain('/app/reader/novel/book-7');
    expect(href).toContain('tab=settings');
    expect(href).toContain('chapter=6');
    expect(href).toContain('vf-reader-mode=novel');
    expect(href).toContain('vf-reader-item=book-7');
  });

  it('keeps canonical and alias deep links aligned for nested paths with query and hash', () => {
    const canonical = buildReaderDeepLink(
      {
        mode: 'novel',
        titleId: 'book-7',
        tab: 'read',
        chapter: 8,
      },
      'https://example.com/app/reader/novel/book-7?tab=voices#chapter-2'
    );
    const alias = buildReaderDeepLink(
      {
        mode: 'novel',
        titleId: 'book-7',
        tab: 'read',
        chapter: 8,
      },
      'https://example.com/reader/novel/book-7?tab=voices#chapter-2'
    );

    expect(canonical).toBe('/app/reader/novel/book-7?vf-reader-mode=novel&vf-reader-item=book-7&vf-reader-title=book-7&tab=read&vf-reader-tab=read&chapter=8&vf-reader-chapter=8#chapter-2');
    expect(alias).toBe(canonical);
  });

  it('detects reader paths correctly', () => {
    expect(isReaderPath('/reader')).toBe(true);
    expect(isReaderPath('/reader/novel/alpha')).toBe(true);
    expect(isReaderPath('/app/reader')).toBe(true);
    expect(isReaderPath('/app/reader/novel/alpha')).toBe(true);
    expect(isReaderPath('/app')).toBe(false);
  });
});
