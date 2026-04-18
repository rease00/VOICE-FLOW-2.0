import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const fetchDiscoveredBooksMock = vi.hoisted(() => vi.fn());
const listPublishedBooksForLibraryMock = vi.hoisted(() => vi.fn());

vi.mock('../src/server/bookDiscovery', () => ({
  fetchBookById: vi.fn(),
  fetchDiscoveredBooks: (...args: unknown[]) => fetchDiscoveredBooksMock(...args),
}));

vi.mock('../src/server/publishing/service', () => ({
  handleLibraryPublishedBookChaptersRoute: vi.fn(),
  listPublishedBooksForLibrary: (...args: unknown[]) => listPublishedBooksForLibraryMock(...args),
  mapPublishedBookToLibraryBook: vi.fn(),
  readPublishedBookById: vi.fn(),
}));

import { fetchLibraryBooks, handleLibraryBooksRoute } from '../src/server/library/service';

describe('library service discovery aggregation', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('returns merged external and published discovery results when both succeed', async () => {
    fetchDiscoveredBooksMock.mockResolvedValue({
      count: 1,
      next: null,
      previous: null,
      results: [
        { id: 84, title: 'Frankenstein', source: 'gutenberg' },
      ],
    });
    listPublishedBooksForLibraryMock.mockResolvedValue([
      { id: 'pub-1', title: 'Published Novel', source: 'published' },
    ]);

    await expect(fetchLibraryBooks({ languages: 'en' })).resolves.toMatchObject({
      count: 2,
      results: [
        expect.objectContaining({ id: 'pub-1', source: 'published' }),
        expect.objectContaining({ id: 84, source: 'gutenberg' }),
      ],
    });
  });

  it('degrades gracefully when published book discovery fails', async () => {
    fetchDiscoveredBooksMock.mockResolvedValue({
      count: 1,
      next: null,
      previous: null,
      results: [
        { id: 84, title: 'Frankenstein', source: 'gutenberg' },
      ],
    });
    listPublishedBooksForLibraryMock.mockRejectedValue(new Error('missing-index'));
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    await expect(fetchLibraryBooks({ languages: 'en' })).resolves.toMatchObject({
      count: 1,
      results: [
        expect.objectContaining({ id: 84, source: 'gutenberg' }),
      ],
      meta: {
        publishedBooksAvailable: false,
        degradedSources: ['publishedBooks'],
      },
    });
    expect(warnSpy).toHaveBeenCalledWith(
      '[library] Published book discovery degraded; continuing with external catalog only.',
      expect.objectContaining({
        error: 'missing-index',
      }),
    );
  });

  it('keeps the library route at 200 when published book discovery degrades', async () => {
    fetchDiscoveredBooksMock.mockResolvedValue({
      count: 1,
      next: null,
      previous: null,
      results: [
        { id: 84, title: 'Frankenstein', source: 'gutenberg' },
      ],
    });
    listPublishedBooksForLibraryMock.mockRejectedValue(new Error('missing-index'));
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const response = await handleLibraryBooksRoute(
      new NextRequest('https://voiceflow.local/api/v1/library/books?discover=1&sort=popular&languages=en'),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      count: 1,
      results: [
        expect.objectContaining({ id: 84, source: 'gutenberg' }),
      ],
      meta: {
        publishedBooksAvailable: false,
        degradedSources: ['publishedBooks'],
      },
    });
  });
});
