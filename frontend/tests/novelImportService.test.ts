import { beforeEach, describe, expect, it, vi } from 'vitest';

const authFetchMock = vi.fn();

vi.mock('../services/authHttpClient', () => ({
  authFetch: authFetchMock,
}));

describe('novelImportService canonical routes', () => {
  beforeEach(() => {
    authFetchMock.mockReset();
  });

  it('uses canonical extract route without requiring mediaBackendUrl', async () => {
    authFetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        rawText: 'hello',
        diagnostics: { mode: 'txt', warnings: [], usedAiFallback: false },
        pageStats: [],
      }),
    });

    const { extractNovelTextFromFile } = await import('../services/novelImportService');
    const file = new File(['hello'], 'chapter.txt', { type: 'text/plain' });
    const result = await extractNovelTextFromFile(file);

    expect(result.rawText).toBe('hello');
    expect(authFetchMock).toHaveBeenCalledTimes(1);
    expect(authFetchMock.mock.calls[0]?.[0]).toBe('/api/v1/publishing/import/extract');
  });

  it('uses canonical split route and supports optional base overrides for tests', async () => {
    authFetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        chapters: [{ title: 'Chapter 1', text: 'Body', startOffset: 0, endOffset: 4 }],
        warnings: [],
      }),
    });

    const { splitImportedTextToChapters } = await import('../services/novelImportService');
    const result = await splitImportedTextToChapters('Body', 'auto', 'https://example.test');

    expect(result.chapters).toHaveLength(1);
    expect(authFetchMock.mock.calls[0]?.[0]).toBe('https://example.test/api/v1/publishing/import/split');
  });
});
