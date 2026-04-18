import { NextRequest, NextResponse } from 'next/server';
import { fetchBookById, fetchDiscoveredBooks, type BookDiscoveryOptions } from '../../../src/server/bookDiscovery';
import type { Book } from '../../../src/features/library/model/types';

export const runtime = 'nodejs';

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

  return ALLOWED_HOST_SUFFIXES.some((suffix) => (
    safeHostname === suffix || safeHostname.endsWith(`.${suffix}`)
  ));
};

const normalizeBookSource = (value: string | null): Book['source'] | undefined => {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'openlibrary') return 'openlibrary';
  if (normalized === 'gutenberg') return 'gutenberg';
  if (normalized === 'published') return 'published';
  return undefined;
};

const parseDiscoveryOptions = (request: NextRequest): BookDiscoveryOptions => {
  const searchParams = request.nextUrl.searchParams;
  const languages = searchParams.get('languages');
  const options: BookDiscoveryOptions = {};
  const sort = searchParams.get('sort');
  const search = searchParams.get('search');
  const topic = searchParams.get('topic');

  if (sort) options.sort = sort;
  if (search) options.search = search;
  if (topic) options.topic = topic;
  if (languages === 'en' || languages === 'all') {
    options.languages = languages;
  }

  return options;
};

export async function GET(request: NextRequest) {
  try {
    const rawUrl = String(request.nextUrl.searchParams.get('url') || '').trim();
    if (!rawUrl) {
      const rawBookId = String(request.nextUrl.searchParams.get('bookId') || '').trim();
      if (rawBookId) {
        const source = normalizeBookSource(request.nextUrl.searchParams.get('source'));
        const book = await fetchBookById(rawBookId, source);

        if (!book) {
          return NextResponse.json({ error: 'Book not found.' }, { status: 404 });
        }

        return NextResponse.json(
          { book },
          {
            headers: {
              'Cache-Control': 'no-store',
            },
          },
        );
      }

      const discovery = await fetchDiscoveredBooks(parseDiscoveryOptions(request));
      return NextResponse.json(
        discovery,
        {
          headers: {
            'Cache-Control': 'no-store',
          },
        },
      );
    }

    const parsed = new URL(rawUrl);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return NextResponse.json({ error: 'Only http(s) URLs are allowed.' }, { status: 400 });
    }
    if (!isAllowedHost(parsed.hostname)) {
      return NextResponse.json({ error: 'Book host is not allowed.' }, { status: 403 });
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
      return NextResponse.json(
        { error: `Book request failed (${upstream.status}).` },
        { status: upstream.status },
      );
    }

    const text = await upstream.text();
    return new Response(text, {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Book fetch failed.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
