import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { VoiceClonePreviewPlayer } from '../src/features/voice-cloning/VoiceClonePreviewPlayer';

describe('VoiceClonePreviewPlayer', () => {
  it('renders a polished source preview shell', () => {
    const markup = renderToStaticMarkup(
      <VoiceClonePreviewPlayer
        label="Reference audio"
        name="reference.wav"
        meta="2.4 MB"
        fallback="Upload a reference clip to preview it here."
        tone="source"
      />
    );

    expect(markup).toContain('vf-voice-clone-player--source');
    expect(markup).toContain('Reference audio');
    expect(markup).toContain('reference.wav');
    expect(markup).toContain('2.4 MB');
    expect(markup).toContain('Upload a reference clip to preview it here.');
    expect(markup).not.toContain('controls');
  });

  it('renders the output preview with a download action', () => {
    const markup = renderToStaticMarkup(
      <VoiceClonePreviewPlayer
        label="Output audio"
        name="voice-clone.wav"
        meta="Status: done"
        previewUrl="blob:output"
        fallback="Output audio is not ready yet."
        tone="output"
        downloadUrl="/downloads/voice-clone.wav"
        downloadFileName="voice-clone.wav"
        downloadLabel="Download output"
      />
    );

    expect(markup).toContain('vf-voice-clone-player--output');
    expect(markup).toContain('Output audio');
    expect(markup).toContain('voice-clone.wav');
    expect(markup).toContain('Status: done');
    expect(markup).toContain('Download output');
    expect(markup).toContain('/downloads/voice-clone.wav');
  });
});
