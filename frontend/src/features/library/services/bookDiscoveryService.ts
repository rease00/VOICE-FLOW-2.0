import type { GutendexResponse, Book, LanguageCode } from '../model/types';
import { API_ROUTES } from '../../../shared/api/routes';

const BOOK_API_ROUTE = API_ROUTES.library.books;
const SELECTED_BOOK_STORAGE_PREFIX = 'vf-library-selected-book:';

interface FetchOptions {
  sort?: string;
  search?: string;
  topic?: string;
  languages?: LanguageCode;
}

const buildDiscoveryParams = (options: FetchOptions): URLSearchParams => {
  const params = new URLSearchParams();
  params.set('discover', '1');
  if (options.sort) params.set('sort', options.sort);
  if (options.search) params.set('search', options.search);
  if (options.topic && options.topic !== 'all') params.set('topic', options.topic);
  if (options.languages && options.languages !== 'all') {
    params.set('languages', options.languages);
  }
  return params;
};

const getSelectedBookStorageKey = (bookId: string | number): string => (
  `${SELECTED_BOOK_STORAGE_PREFIX}${String(bookId)}`
);

export const rememberSelectedLibraryBook = (book: Book): void => {
  if (typeof window === 'undefined') return;

  try {
    window.localStorage.setItem(getSelectedBookStorageKey(book.id), JSON.stringify(book));
  } catch {
    // LocalStorage access is best-effort only.
  }
};

export const readRememberedLibraryBook = (
  bookId: string | number,
): Book | null => {
  if (typeof window === 'undefined') return null;

  try {
    const raw = window.localStorage.getItem(getSelectedBookStorageKey(bookId));
    if (!raw) return null;

    const parsed = JSON.parse(raw) as Book | null;
    if (!parsed || String(parsed.id) !== String(bookId)) {
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
};

export const buildLibraryReadHref = (
  book: Pick<Book, 'id' | 'source'>,
): string => {
  const params = new URLSearchParams();
  if (book.source) {
    params.set('source', book.source);
  }

  const query = params.toString();
  const safeBookId = encodeURIComponent(String(book.id));
  return `/app/library/${safeBookId}/read${query ? `?${query}` : ''}`;
};

export const fetchBooks = async (
  options: FetchOptions = {},
): Promise<GutendexResponse> => {
  try {
    const query = buildDiscoveryParams(options).toString();
    const response = await fetch(`${BOOK_API_ROUTE}?${query}`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw new Error('Failed to fetch books');

    return (await response.json()) as GutendexResponse;
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
      const searchOptions: FetchOptions = {
        search: book.title,
      };
      if (book.languages.includes('en')) {
        searchOptions.languages = 'en';
      }

      const params = buildDiscoveryParams(searchOptions);
      const response = await fetch(`${BOOK_API_ROUTE}?${params.toString()}`, {
        cache: 'no-store',
        signal: AbortSignal.timeout(15000),
      });
      if (!response.ok) return null;

      const data = (await response.json()) as GutendexResponse;
      if (!(data.results ?? []).length) return null;

      const ranked = [...data.results]
        .map((candidate) => ({
          book: candidate,
          score: scoreTitleMatch(book.title, candidate.title),
        }))
        .filter((candidate) => candidate.book.source === 'gutenberg')
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
