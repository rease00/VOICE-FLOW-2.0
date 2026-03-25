import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ReaderStickyDock } from '../src/features/reader/components/ReaderStickyDock';

describe('reader sticky dock', () => {
  it('keeps transport and playback controls only', () => {
    const html = renderToStaticMarkup(
      <ReaderStickyDock
        title="Demo"
        unitLabel="Chapter 1"
        progressPct={42}
        statusLabel="Ready"
        isPlaying={false}
        miniMode={false}
        ambiencePreset="none"
        stylePreset="default"
        onTogglePlay={vi.fn()}
        onPrev={vi.fn()}
        onNext={vi.fn()}
        onRefresh={vi.fn()}
        onExport={vi.fn()}
        onClose={vi.fn()}
        onToggleMiniMode={vi.fn()}
        onAmbiencePresetChange={vi.fn()}
        onStylePresetChange={vi.fn()}
      />
    );
    expect(html).toContain('Sticky Player');
    expect(html).toContain('Ambience');
    expect(html).toContain('Voice Style');
    expect(html).not.toContain('Cast');
    expect(html).not.toContain('Translate');
    expect(html).not.toContain('Text');
  });
});
