import type { NextRequest } from 'next/server';

import type { Book, GutendexResponse } from '../../features/library/model/types';
import { fetchBookById, fetchDiscoveredBooks, type BookDiscoveryOptions } from '../bookDiscovery';
import { handleLibraryBookChapterAudioRoute } from '../audioNovel/service';
import { readLegacyReaderObject } from './readerObjectAdapter';
import {
  handleLibraryPublishedBookChaptersRoute,
  listPublishedBooksForLibrary,
  mapPublishedBookToLibraryBook,
  readPublishedBookById,
} from '../publishing/service';

const PRIVATE_HOST_RE = /^(localhost|127(?:\.\d{1,3}){3}|0\.0\.0\.0|::1)$/i;
const ALLOWED_HOST_SUFFIXES = [
  'gutenberg.org',
  'gutendex.com',
  'archive.org',
  'openlibrary.org',
];

const isAllowedHost = (hostname: string): boolean => {
  const safeHostname = String(hostname || '').trim().toLowerCase();
  if (!safeHostname || PRIVATE_HOST_RE.test(safeHostname)) {
    return false;
  }
  return ALLOWED_HOST_SUFFIXES.some((suffix) => safeHostname === suffix || safeHostname.endsWith(`.${suffix}`));
};

export const normalizeBookSource = (value: string | null): Book['source'] | undefined => {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'openlibrary') return 'openlibrary';
  if (normalized === 'gutenberg') return 'gutenberg';
  if (normalized === 'published') return 'published';
  return undefined;
};

const parseDiscoveryOptions = (request: NextRequest): BookDiscoveryOptions => {
  const searchParams = request.nextUrl.searchParams;
  const options: BookDiscoveryOptions = {};
  const sort = searchParams.get('sort');
  const search = searchParams.get('search');
  const topic = searchParams.get('topic');
  const languages = searchParams.get('languages');

  if (sort) options.sort = sort;
  if (search) options.search = search;
  if (topic) options.topic = topic;
  if (languages === 'en' || languages === 'all') {
    options.languages = languages;
  }

  return options;
};

export const fetchLibraryBooks = async (options: BookDiscoveryOptions = {}): Promise<GutendexResponse> => {
  const [external, published] = await Promise.all([
    fetchDiscoveredBooks(options),
    listPublishedBooksForLibrary(options),
  ]);
  return {
    ...external,
    count: external.count + published.length,
    results: [...published, ...(external.results || [])],
  };
};

export const fetchLibraryBookById = async (
  bookId: string,
  source?: Book['source'],
): Promise<Book | null> => {
  if (source === 'published') {
    const book = await readPublishedBookById(bookId);
    return book ? mapPublishedBookToLibraryBook(book) : null;
  }
  return fetchBookById(bookId, source);
};

export const handleLibraryBooksRoute = async (request: NextRequest): Promise<Response> => {
  try {
    const rawUrl = String(request.nextUrl.searchParams.get('url') || '').trim();
    if (rawUrl) {
      const parsed = new URL(rawUrl);
      if (!['http:', 'https:'].includes(parsed.protocol)) {
        return Response.json({ error: 'Only http(s) URLs are allowed.' }, { status: 400 });
      }
      if (!isAllowedHost(parsed.hostname)) {
        return Response.json({ error: 'Book host is not allowed.' }, { status: 403 });
      }

      const upstream = await fetch(parsed.toString(), {
        headers: {
          Accept: 'text/plain, text/html;q=0.8, */*;q=0.1',
          'User-Agent': 'V-FLOW-AI-Reader/1.0',
        },
        cache: 'no-store',
        signal: AbortSignal.timeout(15000),
      });

      if (!upstream.ok) {
        return Response.json(
          { error: `Book request failed (${upstream.status}).` },
          { status: upstream.status },
        );
      }

      return new Response(await upstream.text(), {
        headers: {
          'Content-Type': 'text/plain; charset=utf-8',
          'Cache-Control': 'no-store',
        },
      });
    }

    return Response.json(await fetchLibraryBooks(parseDiscoveryOptions(request)), {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Book fetch failed.';
    return Response.json({ error: message }, { status: 500 });
  }
};

export const handleLibraryBookRoute = async (
  request: NextRequest,
  bookId: string,
): Promise<Response> => {
  try {
    const source = normalizeBookSource(request.nextUrl.searchParams.get('source'));
    const book = await fetchLibraryBookById(bookId, source);
    if (!book) {
      return Response.json({ error: 'Book not found.' }, { status: 404 });
    }
    return Response.json({ book }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Book fetch failed.';
    return Response.json({ error: message }, { status: 500 });
  }
};

export const handleLibraryBookChaptersRoute = async (
  request: NextRequest,
  bookId: string,
): Promise<Response> => {
  return handleLibraryPublishedBookChaptersRoute(request, bookId);
};

export const handleLibraryBookChapterAudioGetRoute = async (
  request: NextRequest,
  bookId: string,
  chapterId: string,
): Promise<Response> => {
  return handleLibraryBookChapterAudioRoute(request, bookId, chapterId);
};

export const handleLibraryReaderObjectRoute = async (request: Request): Promise<Response> => {
  const url = new URL(request.url);
  const objectKey = String(url.searchParams.get('key') || '').trim();
  if (!objectKey) {
    return Response.json({ error: 'key is required.' }, { status: 400 });
  }

  const object = await readLegacyReaderObject(objectKey);
  if (!object) {
    return Response.json({ error: 'Reader object not found.' }, { status: 404 });
  }

  return new Response(object.body, {
    headers: {
      'Content-Type': object.contentType,
      'Cache-Control': 'no-store',
    },
  });
};
