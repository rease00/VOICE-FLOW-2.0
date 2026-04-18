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
    expect(html).not.toContain('Stress Test (Seed VC)');
  });

  it('shows stress controls for admin users', () => {
    useUserMock.mockReturnValue({
      user: { isAdmin: true, adminActor: null },
    });

    const html = renderToStaticMarkup(<VoiceCloningTabContent />);
    expect(html).toContain('Stress Test (Seed VC)');
  });

  it('emits workspace layout marker when requested', () => {
    useUserMock.mockReturnValue({
      user: { isAdmin: false, adminActor: null },
    });

    const html = renderToStaticMarkup(<VoiceCloningTabContent layout="workspace" />);
    expect(html).toContain('data-voice-clone-layout=\"workspace\"');
  });

  it('can hide the workspace rail when the parent workspace does not need a third panel', () => {
    useUserMock.mockReturnValue({
      user: { isAdmin: false, adminActor: null },
    });

    const html = renderToStaticMarkup(<VoiceCloningTabContent layout="workspace" showRail={false} />);
    expect(html).toContain('data-voice-clone-layout=\"workspace\"');
    expect(html).not.toContain('Session status');
  });

  it('shows Seed VC v2 and removes the legacy extraction tab from the primary nav', () => {
    useUserMock.mockReturnValue({
      user: { isAdmin: false, adminActor: null },
    });

    const html = renderToStaticMarkup(<VoiceCloningTabContent />);
    expect(html).toContain('Seed VC v2');
    expect(html).not.toContain('Extract Voice + BG</span>');
  });
});
