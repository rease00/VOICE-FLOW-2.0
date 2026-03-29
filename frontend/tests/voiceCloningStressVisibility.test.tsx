import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const useUserMock = vi.hoisted(() => vi.fn());

vi.mock('../contexts/UserContext', () => ({
  useUser: () => useUserMock(),
}));

import { VoiceCloningTabContent } from '../src/features/voice-cloning/VoiceCloningTabContent';

describe('Voice cloning stress control visibility', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useUserMock.mockReturnValue({ user: null });
  });

  it('hides stress controls for non-admin users', () => {
    useUserMock.mockReturnValue({
      user: { isAdmin: false, adminActor: null },
    });

    const html = renderToStaticMarkup(<VoiceCloningTabContent />);
    expect(html).toContain('Provider');
    expect(html).toContain('Readiness');
    expect(html).not.toContain('Stress Test (L4 + Gemini Flash)');
  });

  it('shows stress controls for admin users', () => {
    useUserMock.mockReturnValue({
      user: { isAdmin: true, adminActor: null },
    });

    const html = renderToStaticMarkup(<VoiceCloningTabContent />);
    expect(html).toContain('Provider');
    expect(html).toContain('Readiness');
    expect(html).toContain('Stress Test (L4 + Gemini Flash)');
  });
});
