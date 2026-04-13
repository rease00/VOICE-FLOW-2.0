import type { Author, Book, GutendexResponse, LanguageCode } from '../features/library/model/types';

export interface BookDiscoveryOptions {
  sort?: string;
  search?: string;
  topic?: string;
  languages?: LanguageCode;
}

const GUTENDEX_BASE_URL = 'https://gutendex.com/books';
const OPEN_LIBRARY_BASE_URL = 'https://openlibrary.org/search.json';
const OPEN_LIBRARY_FIELDS = [
  'key',
  'title',
  'author_name',
  'cover_i',
  'ia',
  'subject',
  'first_publish_year',
  'language',
  'editions_count',
].join(',');

const REQUEST_TIMEOUT_MS = 15000;

const requestJson = async <T,>(url: string): Promise<T> => {
  const response = await fetch(url, {
    cache: 'no-store',
    headers: {
      Accept: 'application/json',
      'User-Agent': 'V-FLOW-AI-Reader/1.0',
    },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`Request failed (${response.status})`);
  }

  return response.json() as Promise<T>;
};

const toAuthorList = (value: unknown): Author[] => {
  if (!Array.isArray(value) || value.length === 0) {
    return [{ name: 'Unknown', birth_year: null, death_year: null }];
  }

  const authors = value
    .map((entry) => String(entry || '').trim())
    .filter(Boolean)
    .slice(0, 3)
    .map((name) => ({
      name,
      birth_year: null,
      death_year: null,
    }));

  return authors.length > 0
    ? authors
    : [{ name: 'Unknown', birth_year: null, death_year: null }];
};

const mapOpenLibraryDocToBook = (doc: Record<string, unknown>): Book | null => {
  const key = String(doc.key || '').trim();
  const title = String(doc.title || '').trim();
  const internetArchiveIds = Array.isArray(doc.ia)
    ? doc.ia.map((entry) => String(entry || '').trim()).filter(Boolean)
    : [];

  if (!key || !title || internetArchiveIds.length === 0) {
    return null;
  }

  const formats: Record<string, string> = {};
  const coverId = doc.cover_i;
  if (coverId !== undefined && coverId !== null && String(coverId).trim()) {
    formats['image/jpeg'] = `https://covers.openlibrary.org/b/id/${encodeURIComponent(String(coverId))}-L.jpg`;
  }

  const iaId = internetArchiveIds[0]!;
  formats['text/html'] = `https://archive.org/embed/${encodeURIComponent(iaId)}`;
  formats['application/epub+zip'] = `https://archive.org/download/${encodeURIComponent(iaId)}/${encodeURIComponent(iaId)}.epub`;

  return {
    id: key,
    title,
    authors: toAuthorList(doc.author_name),
    translators: [],
    subjects: Array.isArray(doc.subject)
      ? doc.subject.map((entry) => String(entry || '').trim()).filter(Boolean).slice(0, 5)
      : [],
    bookshelves: [],
    languages: Array.isArray(doc.language)
      ? doc.language.map((entry) => String(entry || '').trim()).filter(Boolean)
      : [],
    copyright: false,
    media_type: 'Text',
    formats,
    download_count: Number(doc.editions_count || 0) || 0,
    source: 'openlibrary',
  };
};

const buildGutendexUrl = (options: BookDiscoveryOptions): string => {
  const params = new URLSearchParams();
  if (options.sort) params.set('sort', options.sort);
  if (options.search) params.set('search', options.search);
  if (options.topic && options.topic !== 'all') params.set('topic', options.topic);
  if (options.languages && options.languages !== 'all') {
    params.set('languages', options.languages);
  }
  return `${GUTENDEX_BASE_URL}?${params.toString()}`;
};

const buildOpenLibraryUrl = (options: BookDiscoveryOptions): string => {
  const params = new URLSearchParams();
  const languageMap: Record<string, string> = { en: 'eng' };
  const openLibraryLanguage = options.languages ? languageMap[options.languages] : '';

  if (openLibraryLanguage) {
    params.set('language', openLibraryLanguage);
  }

  const query = options.search?.trim()
    || (options.topic && options.topic !== 'all' ? `subject:${options.topic}` : 'classic literature');

  params.set('q', query);
  params.set('sort', 'editions');
  params.set('fields', OPEN_LIBRARY_FIELDS);
  params.set('limit', '20');

  return `${OPEN_LIBRARY_BASE_URL}?${params.toString()}`;
};

export const fetchGutendexBooks = async (
  options: BookDiscoveryOptions,
): Promise<Book[]> => {
  const url = buildGutendexUrl(options);
  const data = await requestJson<GutendexResponse>(url);

  return (data.results ?? []).map((book) => ({
    ...book,
    source: 'gutenberg',
  }));
};

interface OpenLibrarySearchResponse {
  docs?: Array<Record<string, unknown>>;
}

export const fetchOpenLibraryBooks = async (
  options: BookDiscoveryOptions,
): Promise<Book[]> => {
  const url = buildOpenLibraryUrl(options);
  const data = await requestJson<OpenLibrarySearchResponse>(url);

  return (data.docs ?? [])
    .map(mapOpenLibraryDocToBook)
    .filter((book): book is Book => Boolean(book));
};

export const fetchDiscoveredBooks = async (
  options: BookDiscoveryOptions = {},
): Promise<GutendexResponse> => {
  const [gutendexResult, openLibraryResult] = await Promise.allSettled([
    fetchGutendexBooks(options),
    fetchOpenLibraryBooks(options),
  ]);

  const gutendexBooks = gutendexResult.status === 'fulfilled' ? gutendexResult.value : [];
  const openLibraryBooks = openLibraryResult.status === 'fulfilled' ? openLibraryResult.value : [];

  const combinedResults: Book[] = [];
  const maxLength = Math.max(gutendexBooks.length, openLibraryBooks.length);

  for (let index = 0; index < maxLength; index += 1) {
    if (index < gutendexBooks.length) combinedResults.push(gutendexBooks[index]!);
    if (index < openLibraryBooks.length) combinedResults.push(openLibraryBooks[index]!);
  }

  return {
    count: combinedResults.length,
    next: null,
    previous: null,
    results: combinedResults,
  };
};

const fetchGutendexBookById = async (bookId: string): Promise<Book | null> => {
  const safeBookId = String(bookId || '').trim();
  if (!safeBookId) return null;

  const data = await requestJson<Book>(`${GUTENDEX_BASE_URL}/${encodeURIComponent(safeBookId)}`);
  return {
    ...data,
    source: 'gutenberg',
  };
};

const fetchOpenLibraryBookByKey = async (bookId: string): Promise<Book | null> => {
  const safeBookId = String(bookId || '').trim();
  if (!safeBookId) return null;

  const params = new URLSearchParams();
  params.set('q', `key:${safeBookId}`);
  params.set('fields', OPEN_LIBRARY_FIELDS);
  params.set('limit', '1');

  const data = await requestJson<OpenLibrarySearchResponse>(`${OPEN_LIBRARY_BASE_URL}?${params.toString()}`);
  const directMatch = (data.docs ?? []).find((doc) => String(doc.key || '').trim() === safeBookId);

  return directMatch ? mapOpenLibraryDocToBook(directMatch) : null;
};

export const fetchBookById = async (
  bookId: string,
  source?: Book['source'],
): Promise<Book | null> => {
  if (source === 'openlibrary') {
    return fetchOpenLibraryBookByKey(bookId);
  }

  return fetchGutendexBookById(bookId);
};
