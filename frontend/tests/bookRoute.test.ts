import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

import { GET } from '../app/api/book/route';

const jsonResponse = (payload: unknown, status: number = 200): Response => new Response(
  JSON.stringify(payload),
  {
    status,
    headers: {
      'content-type': 'application/json',
    },
  },
);

describe('book api route', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('returns combined discovery results through the same-origin proxy route', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);

      if (url.startsWith('https://gutendex.com/books?')) {
        return jsonResponse({
          count: 1,
          next: null,
          previous: null,
          results: [
            {
              id: 84,
              title: 'Frankenstein',
              authors: [{ name: 'Shelley, Mary Wollstonecraft', birth_year: 1797, death_year: 1851 }],
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
            },
          ],
        });
      }

      if (url.startsWith('https://openlibrary.org/search.json?')) {
        return jsonResponse({
          docs: [
            {
              key: '/works/OL45804W',
              title: 'Fantastic Mr. Fox',
              author_name: ['Roald Dahl'],
              cover_i: 6498519,
              ia: ['fantasticmrfoxpl0000reid'],
              subject: ['Animals', 'Adventure'],
              language: ['eng'],
              editions_count: 12,
            },
          ],
        });
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });

    vi.stubGlobal('fetch', fetchMock as typeof fetch);

    const response = await GET(new NextRequest('https://voiceflow.local/api/book?discover=1&languages=en'));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      count: 2,
      results: [
        expect.objectContaining({ id: 84, source: 'gutenberg' }),
        expect.objectContaining({ id: '/works/OL45804W', source: 'openlibrary' }),
      ],
    });
  });

  it('can load an Open Library book by key for the reader route', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);

      expect(url).toContain('q=key%3A%2Fworks%2FOL45804W');

      return jsonResponse({
        docs: [
          {
            key: '/works/OL45804W',
            title: 'Fantastic Mr. Fox',
            author_name: ['Roald Dahl'],
            cover_i: 6498519,
            ia: ['fantasticmrfoxpl0000reid'],
            subject: ['Animals', 'Adventure'],
            language: ['eng'],
            editions_count: 12,
          },
        ],
      });
    });

    vi.stubGlobal('fetch', fetchMock as typeof fetch);

    const response = await GET(
      new NextRequest('https://voiceflow.local/api/book?bookId=%2Fworks%2FOL45804W&source=openlibrary'),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      book: expect.objectContaining({
        id: '/works/OL45804W',
        source: 'openlibrary',
        title: 'Fantastic Mr. Fox',
      }),
    });
  });
});
