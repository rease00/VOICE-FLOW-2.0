import { afterEach, describe, expect, it, vi } from 'vitest';

const generateTextWithVertexMock = vi.hoisted(() => vi.fn());
const isVertexTextConfiguredMock = vi.hoisted(() => vi.fn());
const verifyFirebaseRequestMock = vi.hoisted(() => vi.fn(async () => ({ uid: 'user-1' })));

vi.mock('../src/server/vertexTextService', () => ({
  generateTextWithVertex: (...args: unknown[]) => generateTextWithVertexMock(...args),
  isVertexTextConfigured: (...args: unknown[]) => isVertexTextConfiguredMock(...args),
}));

vi.mock('../src/server/auth/requestAuth.ts', () => ({
  verifyFirebaseRequest: (...args: unknown[]) => verifyFirebaseRequestMock(...args),
}));

describe('AI generate text route', () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    verifyFirebaseRequestMock.mockResolvedValue({ uid: 'user-1' });
  });

  it('requires server-side auth before calling Vertex', async () => {
    isVertexTextConfiguredMock.mockReturnValue(true);
    verifyFirebaseRequestMock.mockRejectedValueOnce(new Error('Missing authorization'));

    const { handleAiGenerateTextRoute } = await import('../src/server/ai/service');
    const response = await handleAiGenerateTextRoute(new Request('http://localhost/api/v1/ai/generate-text', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ userPrompt: 'Hello' }),
    }));

    expect(response.status).toBe(401);
    expect(generateTextWithVertexMock).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({
      detail: 'Missing authorization',
    });
  });

  it('returns generated text for authenticated requests', async () => {
    isVertexTextConfiguredMock.mockReturnValue(true);
    generateTextWithVertexMock.mockResolvedValueOnce('Result text');

    const { handleAiGenerateTextRoute } = await import('../src/server/ai/service');
    const response = await handleAiGenerateTextRoute(new Request('http://localhost/api/v1/ai/generate-text', {
      method: 'POST',
      headers: {
        authorization: 'Bearer token-123',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ userPrompt: 'Hello' }),
    }));

    expect(response.status).toBe(200);
    expect(verifyFirebaseRequestMock).toHaveBeenCalledTimes(1);
    expect(generateTextWithVertexMock).toHaveBeenCalledWith({
      systemPrompt: '',
      userPrompt: 'Hello',
      jsonMode: false,
      temperature: 0.2,
    });
    await expect(response.json()).resolves.toMatchObject({ text: 'Result text' });
  });
});
