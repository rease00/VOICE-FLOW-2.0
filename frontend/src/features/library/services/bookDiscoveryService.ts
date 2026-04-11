import type { GutendexResponse, Book, LanguageCode, Author } from '../model/types';

const GUTENDEX_BASE_URL = 'https://gutendex.com/books';
const OPENLIB_BASE_URL = 'https://openlibrary.org/search.json';

interface FetchOptions {
  sort?: string;
  search?: string;
  topic?: string;
  languages?: LanguageCode;
}

const fetchGutendexBooks = async (options: FetchOptions): Promise<Book[]> => {
  const params = new URLSearchParams();
  if (options.sort) params.append('sort', options.sort);
  if (options.search) params.append('search', options.search);
  if (options.topic && options.topic !== 'all') params.append('topic', options.topic);
  if (options.languages && options.languages !== 'all') {
    params.append('languages', options.languages);
  }

  try {
    const url = `${GUTENDEX_BASE_URL}?${params.toString()}`;
    const response = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new Error('Failed to fetch from Gutendex');
    const data = await response.json();

    return (data.results ?? []).map((b: Record<string, unknown>) => ({
      ...b,
      source: 'gutenberg' as const,
    }));
  } catch (e) {
    console.warn('Gutendex fetch failed', e);
    return [];
  }
};

const fetchOpenLibraryBooks = async (options: FetchOptions): Promise<Book[]> => {
  const params = new URLSearchParams();
  const langMap: Record<string, string> = { en: 'eng' };
  const olLang = options.languages ? langMap[options.languages] : null;

  const queryParts: string[] = [];

  if (options.search) {
    queryParts.push(options.search);
  } else if (options.topic && options.topic !== 'all') {
    queryParts.push(`subject:${options.topic}`);
  } else {
    queryParts.push('language:eng');
  }

  if (olLang) {
    params.append('language', olLang);
  }

  if (queryParts.length === 0) {
    queryParts.push('classic');
  }

  params.append('q', queryParts.join(' '));
  params.append('sort', 'editions');
  params.append(
    'fields',
    'key,title,author_name,cover_i,ia,subject,first_publish_year,language,editions_count',
  );
  params.append('limit', '20');

  try {
    const url = `${OPENLIB_BASE_URL}?${params.toString()}`;
    const response = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new Error('Failed to fetch from Open Library');
    const data = await response.json();

    return (data.docs ?? [])
      .filter(
        (doc: Record<string, unknown>) =>
          doc.cover_i && Array.isArray(doc.ia) && (doc.ia as string[]).length > 0,
      )
      .map((doc: Record<string, unknown>) => {
        const authorNames = (doc.author_name ?? []) as string[];
        const authors: Author[] = authorNames.slice(0, 3).map((name: string) => ({
          name,
          birth_year: null,
          death_year: null,
        }));

        const formats: Record<string, string> = {};
        const media_type = 'Text';

        if (doc.cover_i) {
          formats['image/jpeg'] = `https://covers.openlibrary.org/b/id/${doc.cover_i}-L.jpg`;
        }

        const iaId = (doc.ia as string[])[0];
        formats['text/html'] = `https://archive.org/embed/${iaId}`;
        formats['application/epub+zip'] = `https://archive.org/download/${iaId}/${iaId}.epub`;

        return {
          id: doc.key as string,
          title: doc.title as string,
          authors: authors.length
            ? authors
            : [{ name: 'Unknown', birth_year: null, death_year: null }],
          translators: [],
          subjects: ((doc.subject ?? []) as string[]).slice(0, 5),
          bookshelves: [],
          languages: (doc.language ?? []) as string[],
          copyright: false,
          media_type,
          formats,
          download_count: (doc.editions_count as number) || 0,
          source: 'openlibrary' as const,
        };
      });
  } catch (e) {
    console.warn('OpenLibrary fetch failed', e);
    return [];
  }
};

export const fetchBooks = async (
  options: FetchOptions = {},
): Promise<GutendexResponse> => {
  try {
    const [gutendexBooks, olBooks] = await Promise.all([
      fetchGutendexBooks(options),
      fetchOpenLibraryBooks(options),
    ]);

    const combinedResults: Book[] = [];
    const maxLength = Math.max(gutendexBooks.length, olBooks.length);

    for (let i = 0; i < maxLength; i++) {
      if (i < gutendexBooks.length) combinedResults.push(gutendexBooks[i]!);
      if (i < olBooks.length) combinedResults.push(olBooks[i]!);
    }

    return {
      count: combinedResults.length,
      next: null,
      previous: null,
      results: combinedResults,
    };
  } catch (error) {
    console.error('Error fetching books:', error);
    return { count: 0, next: null, previous: null, results: [] };
  }
};

export const getBookCover = (book: Book): string => {
  return book.formats['image/jpeg'] || 'https://picsum.photos/200/300';
};

export const getBookDownloadLink = (
  book: Book,
  format: 'epub' | 'html' | 'txt',
): string | null => {
  const formats = book.formats;
  if (format === 'epub') return formats['application/epub+zip'] || null;
  if (format === 'html') return formats['text/html'] || null;
  if (format === 'txt')
    return formats['text/plain'] || formats['text/plain; charset=utf-8'] || null;
  return null;
};

const normalizeTitle = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const scoreTitleMatch = (queryTitle: string, candidateTitle: string) => {
  const q = normalizeTitle(queryTitle);
  const c = normalizeTitle(candidateTitle);
  if (q === c) return 3;
  if (c.startsWith(q) || q.startsWith(c)) return 2;
  if (c.includes(q) || q.includes(c)) return 1;
  return 0;
};

export const resolveBookTextLink = async (book: Book): Promise<string | null> => {
  const directTxt = getBookDownloadLink(book, 'txt');
  if (directTxt) return directTxt;

  if (book.source === 'openlibrary') {
    try {
      const url = `${GUTENDEX_BASE_URL}?search=${encodeURIComponent(book.title)}`;
      const response = await fetch(url, { signal: AbortSignal.timeout(10000) });
      if (!response.ok) return null;

      const data = (await response.json()) as GutendexResponse;
      if (!(data.results ?? []).length) return null;

      const ranked = [...data.results]
        .map((candidate) => ({
          book: candidate,
          score: scoreTitleMatch(book.title, candidate.title),
        }))
        .sort((a, b) => b.score - a.score);

      for (const item of ranked) {
        const txt = getBookDownloadLink(item.book, 'txt');
        if (txt) return txt;
      }
    } catch (error) {
      console.warn('Failed to resolve fallback text link via Gutendex', error);
    }
  }

  return null;
};
