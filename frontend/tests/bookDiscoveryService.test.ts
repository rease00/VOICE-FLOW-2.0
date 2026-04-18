import { afterEach, describe, expect, it, vi } from 'vitest';

import { buildLibraryReadHref, fetchBooks } from '../src/features/library/services/bookDiscoveryService';

describe('bookDiscoveryService', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('requests browse data through the same-origin book api route', async () => {
    const fetchMock = vi.fn(async () => new Response(
      JSON.stringify({
        count: 1,
        next: null,
        previous: null,
        meta: {
          publishedBooksAvailable: false,
          degradedSources: ['publishedBooks'],
        },
        results: [
          {
            id: 84,
            title: 'Frankenstein',
            authors: [{ name: 'Shelley, Mary Wollstonecraft' }],
            translators: [],
            subjects: ['Science fiction'],
            bookshelves: [],
            languages: ['en'],
            copyright: false,
            media_type: 'Text',
            formats: {
              'text/plain; charset=utf-8': 'https://www.gutenberg.org/files/84/84-0.txt',
            },
            download_count: 10,
            source: 'gutenberg',
          },
        ],
      }),
      {
        status: 200,
        headers: {
          'content-type': 'application/json',
        },
      },
    ));

    vi.stubGlobal('fetch', fetchMock as typeof fetch);

    const result = await fetchBooks({ sort: 'popular', languages: 'en' });

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/library/books?discover=1&sort=popular&languages=en',
      expect.objectContaining({
        cache: 'no-store',
      }),
    );
    expect(result.results).toHaveLength(1);
  });

  it('encodes slash-based ids when building reader links', () => {
    expect(buildLibraryReadHref({ id: '/works/OL45804W', source: 'openlibrary' })).toBe(
      '/app/library/%2Fworks%2FOL45804W/read?source=openlibrary',
    );
  });
});
