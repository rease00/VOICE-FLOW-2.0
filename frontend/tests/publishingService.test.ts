import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockSessionState = vi.hoisted(() => ({ token: '', uid: '' }));

vi.mock('../services/authSessionService', () => ({
  readStoredAuthSessionState: () => {
    const t = mockSessionState.token;
    const u = mockSessionState.uid;
    return t || u ? { token: t, uid: u } : null;
  },
}));

describe('publishingService canonical payload unwrapping', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mockSessionState.token = 'd1-session-token';
    mockSessionState.uid = 'publisher-uid';
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('unwraps book and books payloads from native publishing routes', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        book: {
          id: 'book-1',
          title: 'Book One',
        },
      }), {
        status: 201,
        headers: { 'content-type': 'application/json' },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        books: [
          { id: 'book-1', title: 'Book One' },
          { id: 'book-2', title: 'Book Two' },
        ],
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }));

    vi.stubGlobal('fetch', fetchMock as typeof fetch);

    const { publishBook, getMyPublishedBooks } = await import('../src/features/publishing/services/publishingService');

    const created = await publishBook({
      novelProjectId: 'novel-1',
      title: 'Book One',
      description: 'Desc',
      genre: 'Fantasy',
      language: 'English',
      chapterPrice: 5,
      tags: [],
    });
    const books = await getMyPublishedBooks();

    expect(created).toMatchObject({ id: 'book-1', title: 'Book One' });
    expect(books).toHaveLength(2);
    expect(Array.isArray(books)).toBe(true);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/v1/publishing/books');
    expect(fetchMock.mock.calls[1]?.[0]).toBe('/api/v1/publishing/books');
  });

  it('unwraps chapter payloads from the native publishing chapter route', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      chapters: [
        { id: 'ch-1', title: 'Chapter 1', index: 0 },
      ],
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }));

    vi.stubGlobal('fetch', fetchMock as typeof fetch);

    const { getPublishedBookChapters } = await import('../src/features/publishing/services/publishingService');
    const chapters = await getPublishedBookChapters('book-1');

    expect(chapters).toHaveLength(1);
    expect(chapters[0]).toMatchObject({ id: 'ch-1', title: 'Chapter 1' });
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/v1/publishing/books/book-1/chapters');
  });
});
