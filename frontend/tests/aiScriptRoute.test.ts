import { afterEach, describe, expect, it, vi } from 'vitest';

const generateTextWithVertexMock = vi.hoisted(() => vi.fn());
const isVertexTextConfiguredMock = vi.hoisted(() => vi.fn());

vi.mock('../src/server/vertexTextService', () => ({
  generateTextWithVertex: (...args: unknown[]) => generateTextWithVertexMock(...args),
  isVertexTextConfigured: (...args: unknown[]) => isVertexTextConfiguredMock(...args),
}));

describe('AI script route', () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it('returns normalized tagged output from Vertex when available', async () => {
    isVertexTextConfiguredMock.mockReturnValue(true);
    generateTextWithVertexMock.mockResolvedValue('Narrator: The sea was calm.\nArjun: Hold the line.');

    const { handleAiScriptRoute } = await import('../src/server/ai/scriptService');
    const response = await handleAiScriptRoute(new Request('http://localhost/api/ai-script', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        text: 'The sea was calm. "Hold the line," Arjun said.',
        chapterTitle: 'Chapter 1',
      }),
    }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      source: 'vertex',
      annotatedText: '[Narrator|narration|normal|none]: The sea was calm.\n[Arjun|narration|normal|none]: Hold the line.',
    });
  });

  it('falls back to narrator-tagged raw script when Vertex is unavailable', async () => {
    isVertexTextConfiguredMock.mockReturnValue(false);

    const { handleAiScriptRoute } = await import('../src/server/ai/scriptService');
    const response = await handleAiScriptRoute(new Request('http://localhost/api/ai-script', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        text: 'A storm gathered over the harbor.',
      }),
    }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      source: 'fallback',
      annotatedText: '[Narrator|narration|normal|none]: A storm gathered over the harbor.',
    });
  });

  it('normalizes bracketed speaker tags that are missing an emotion', async () => {
    isVertexTextConfiguredMock.mockReturnValue(true);
    generateTextWithVertexMock.mockResolvedValue('[Narrator]: A storm gathered.\n[Elizabeth]: We should go.');

    const { handleAiScriptRoute } = await import('../src/server/ai/scriptService');
    const response = await handleAiScriptRoute(new Request('http://localhost/api/ai-script', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        text: 'A storm gathered. "We should go," Elizabeth said.',
      }),
    }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      source: 'vertex',
      annotatedText: '[Narrator|narration|normal|none]: A storm gathered.\n[Elizabeth|narration|normal|none]: We should go.',
    });
  });
});
