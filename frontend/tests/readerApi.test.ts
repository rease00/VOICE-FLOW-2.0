import { describe, expect, it, vi } from 'vitest';
import type { ReaderCatalogItem, ReaderDashboardPayload, ReaderLibrary, ReaderSession } from '../types';

const { authFetchMock } = vi.hoisted(() => ({
  authFetchMock: vi.fn(),
}));

vi.mock('../services/authHttpClient', () => ({
  authFetch: authFetchMock,
}));

import { getReaderDashboard, primeReaderQueue, resolveReaderQueuePrimeMode } from '../src/features/reader/api/readerApi';
import { buildReaderDashboardPayloadFromLibrary } from '../src/features/reader/model/dashboard';

const makeItem = (overrides: Partial<ReaderCatalogItem>): ReaderCatalogItem => ({
  id: overrides.id || 'item-1',
  title: overrides.title || 'Reader Item',
  author: overrides.author || 'Reader Author',
  regionId: overrides.regionId || 'english',
  contentKind: overrides.contentKind || 'book',
  surface: overrides.surface || 'books',
  provider: overrides.provider || 'catalog',
  license: overrides.license || 'public-domain',
  ...overrides,
});

const makeLibrary = (items: ReaderCatalogItem[]): ReaderLibrary => ({
  surface: 'all',
  regionId: 'english',
  regions: [{ id: 'english', label: 'English' }],
  items,
  activeSession: null,
  activeSessions: [],
  counts: {
    all: items.length,
    visible: items.length,
    books: items.filter((item) => item.contentKind === 'book').length,
    comics: items.filter((item) => item.contentKind === 'comic').length,
    uploads: items.filter((item) => item.surface === 'uploads').length,
    resumable: items.filter((item) => Boolean(item.sessionId || item.resume?.hasProgress)).length,
  },
  facets: { providers: [], collections: [], progressStates: [] },
  shelves: {
    continueReading: items.slice(0, 1),
    trending: items.slice(0, 1),
    newArrivals: items.slice(0, 1),
    recentlyImported: items.filter((item) => item.surface === 'uploads'),
  },
});

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

describe('reader api dashboard fallback', () => {
  it('returns the normalized dashboard payload when the dashboard contract is available', async () => {
    authFetchMock.mockReset();
    authFetchMock.mockResolvedValueOnce(
      jsonResponse({
        ok: true,
        dashboard: {
          library: makeLibrary([
            makeItem({ id: 'resume-1', title: 'Resume One' }),
          ]),
          mission: {
            title: 'Play any novel, manga, or comic with AI TTS',
            subtitle: 'Jump back into active sessions.',
            ctaText: 'Open your library and press Play',
          },
          highlights: {
            library: 1,
            resumable: 1,
            uploads: 0,
            comics: 0,
            books: 1,
          },
          spotlight: makeItem({ id: 'resume-1', title: 'Resume One' }),
          shelves: {
            continueReading: [makeItem({ id: 'resume-1', title: 'Resume One' })],
            trending: [],
            newArrivals: [],
            recentlyImported: [],
          },
          activeSessionSummary: null,
          blockedProviders: ['blocked-source'],
        },
      })
    );

    const dashboard = await getReaderDashboard('http://backend.test', { surface: 'all' });

    expect(dashboard.library.items).toHaveLength(1);
    expect(dashboard.spotlight?.id).toBe('resume-1');
    expect(dashboard.shelves.continueReading).toHaveLength(1);
    expect(dashboard.blockedProviders).toEqual(['blocked-source']);
    expect(authFetchMock).toHaveBeenCalledTimes(1);
    expect(String(authFetchMock.mock.calls[0]?.[0] || '')).toContain('/reader/dashboard');
  });

  it.each([404, 501])('falls back to the legacy library contract when dashboard is unavailable (%s)', async (status) => {
    authFetchMock.mockReset();
    authFetchMock.mockResolvedValueOnce(jsonResponse({ detail: 'Not found' }, status));
    authFetchMock.mockResolvedValueOnce(
      jsonResponse({
        ok: true,
        library: makeLibrary([
          makeItem({ id: 'comic-1', title: 'Comic One', contentKind: 'comic', surface: 'comics' }),
        ]),
      })
    );

    const params = { surface: 'books' as const, regionId: 'english', search: 'resume' };
    const dashboard = await getReaderDashboard('http://backend.test', params);

    expect(dashboard.library.items).toHaveLength(1);
    expect(dashboard.library.items[0]?.id).toBe('comic-1');
    expect(dashboard.mission.title).toBeTruthy();
    expect(authFetchMock).toHaveBeenCalledTimes(2);
    expect(String(authFetchMock.mock.calls[0]?.[0] || '')).toContain('/reader/dashboard?surface=books&regionId=english&search=resume');
    expect(String(authFetchMock.mock.calls[1]?.[0] || '')).toContain('/reader/library?surface=books&regionId=english&search=resume');
  });

  it('surfaces dashboard errors that are not unavailable responses', async () => {
    authFetchMock.mockReset();
    authFetchMock.mockResolvedValueOnce(jsonResponse({ detail: 'Server exploded' }, 500));

    await expect(getReaderDashboard('http://backend.test', { surface: 'all' })).rejects.toMatchObject({
      status: 500,
      message: 'Server exploded',
    });

    expect(authFetchMock).toHaveBeenCalledTimes(1);
    expect(String(authFetchMock.mock.calls[0]?.[0] || '')).toContain('/reader/dashboard');
  });

  it('builds a dashboard fallback from a legacy library payload', () => {
    const library = makeLibrary([makeItem({ id: 'fallback-1', title: 'Fallback One' })]);
    const dashboard = buildReaderDashboardPayloadFromLibrary(library);

    expect((dashboard as ReaderDashboardPayload).library.items[0]?.id).toBe('fallback-1');
    expect(dashboard.spotlight?.id).toBe('fallback-1');
    expect(dashboard.shelves.continueReading).toEqual(library.shelves.continueReading);
  });
});

describe('reader queue priming', () => {
  it('maps novel and comic playback to the correct backend queue mode', () => {
    expect(resolveReaderQueuePrimeMode('novel')).toBe('book_paragraph');
    expect(resolveReaderQueuePrimeMode('comic')).toBe('comic_panel');
  });

  it('posts queue prime payloads and returns the refreshed session', async () => {
    authFetchMock.mockReset();
    authFetchMock.mockResolvedValueOnce(
      jsonResponse({
        session: {
          id: 'reader-session-1',
          title: 'Reader Session',
        } as ReaderSession,
      })
    );

    const session = await primeReaderQueue('http://backend.test', {
      sessionId: 'reader-session-1',
      mode: 'book_paragraph',
      lookaheadUnits: 4,
      fromActiveIndex: 2,
    });

    expect(session?.id).toBe('reader-session-1');
    expect(authFetchMock).toHaveBeenCalledTimes(1);
    const [url, init, options] = authFetchMock.mock.calls[0] as [string, RequestInit, { timeoutMs?: number }];
    expect(url).toContain('/reader/sessions/reader-session-1/queue/prime');
    expect(init).toMatchObject({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    expect(init.body).toBe(JSON.stringify({
      mode: 'book_paragraph',
      lookaheadUnits: 4,
      fromActiveIndex: 2,
    }));
    expect(options).toMatchObject({ timeoutMs: expect.any(Number) });
  });

  it('clamps negative queue prime inputs before posting', async () => {
    authFetchMock.mockReset();
    authFetchMock.mockResolvedValueOnce(
      jsonResponse({
        session: {
          id: 'reader-session-2',
          title: 'Reader Session 2',
        } as ReaderSession,
      })
    );

    const session = await primeReaderQueue('http://backend.test', {
      sessionId: 'reader-session-2',
      mode: 'comic_panel',
      lookaheadUnits: -8,
      fromActiveIndex: -3,
    });

    expect(session?.id).toBe('reader-session-2');
    expect(authFetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = authFetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/reader/sessions/reader-session-2/queue/prime');
    expect(init.body).toBe(JSON.stringify({
      mode: 'comic_panel',
      lookaheadUnits: 0,
      fromActiveIndex: 0,
    }));
  });

  it('fails soft when queue priming is unavailable', async () => {
    authFetchMock.mockReset();
    authFetchMock.mockResolvedValueOnce(jsonResponse({ detail: 'Not found' }, 404));

    await expect(primeReaderQueue('http://backend.test', {
      sessionId: 'reader-session-1',
      mode: 'comic_panel',
      lookaheadUnits: 4,
      fromActiveIndex: 0,
    })).resolves.toBeNull();

    expect(authFetchMock).toHaveBeenCalledTimes(1);
  });
});
