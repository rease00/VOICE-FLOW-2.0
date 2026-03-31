import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { VoiceCloneTaskProgressCard } from '../src/features/voice-cloning/VoiceCloneTaskProgressCard';

describe('VoiceCloneTaskProgressCard', () => {
  it('renders a polished progress shell with a cancel action', () => {
    const markup = renderToStaticMarkup(
      <VoiceCloneTaskProgressCard
        title="Cloning in progress"
        stage="Submitting root request"
        detail="Waiting on the backend runtime."
        progress={64}
        tone="clone"
        onCancel={() => {}}
      />
    );

    expect(markup).toContain('vf-voice-clone-task--clone');
    expect(markup).toContain('Cloning in progress');
    expect(markup).toContain('Submitting root request');
    expect(markup).toContain('Waiting on the backend runtime.');
    expect(markup).toContain('aria-valuenow="64"');
    expect(markup).toContain('Cancel');
  });
});
