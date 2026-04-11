import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GenerationSettings } from '../types';

const { authFetchMock } = vi.hoisted(() => ({
  authFetchMock: vi.fn(),
}));

vi.mock('../services/authHttpClient', () => ({
  authFetch: authFetchMock,
}));

vi.mock('../services/authHttpClient.js', () => ({
  authFetch: authFetchMock,
}));

import { autoFormatScript } from '../services/geminiService';

const settings = {
  mediaBackendUrl: 'http://backend.test',
} as unknown as GenerationSettings;

beforeEach(() => {
  authFetchMock.mockReset();
});

describe('autoFormatScript', () => {
  it('normalizes malformed title headers and keeps the speaker emotion tags returned by Gemini', async () => {
    const source = 'हिंदी मजेदार कहानी\nमोहन (Elderly Gentle): माँ, चलो घर चलते हैं.';
    const modelResponse = {
      cast: [
        { name: 'मोहन', gender: 'Male', age: 'Adult' },
      ],
      script: 'हिंदी मजेदार कहानी (Elderly Gentle): मोहन और उसका मोबाइल\nमोहन (Elderly Gentle, Whispering to self): माँ, चलो घर चलते हैं.',
      mood: 'calm',
    };

    authFetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ text: JSON.stringify(modelResponse) }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    );

    const result = await autoFormatScript(source, settings);

    expect(result.formattedText).toContain('Narrator (Neutral): हिंदी मजेदार कहानी');
    expect(result.formattedText).toContain('मोहन (Elderly Gentle, Whispering to self): माँ, चलो घर चलते हैं.');
    expect(result.cast.map((entry) => entry.name)).toContain('मोहन');
    expect(result.mood).toBe('calm');

    const call = authFetchMock.mock.calls[0];
    const requestBody = JSON.parse(String(call?.[1]?.body || '{}'));
    expect(String(requestBody.systemPrompt || '')).toContain('Titles, chapter headings, scene headings');
    expect(String(requestBody.systemPrompt || '')).toContain('Keep narrator lines only for non-spoken prose, titles, headings, and scene labels.');
  });
});
