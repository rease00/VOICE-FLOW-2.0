import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ReaderStickyDock } from '../src/features/reader/components/ReaderStickyDock';

describe('reader sticky dock', () => {
  it('renders the full dock copy with quick tools and disabled transport controls', () => {
    const html = renderToStaticMarkup(
      <ReaderStickyDock
        title=""
        unitLabel="Read"
        readyChunkCount={0}
        pendingChunkCount={3}
        queueFillPct={33}
        statusLabel="Idle"
        isPlaying={false}
        miniMode={false}
        transportDisabled
        onTogglePlay={vi.fn()}
        onPrev={vi.fn()}
        onNext={vi.fn()}
        onToggleMiniMode={vi.fn()}
        importAccept=".txt,.pdf"
        onImportFiles={vi.fn()}
        onOpenSettings={vi.fn()}
        ambienceOptions={[
          { value: 'm_none', label: 'None' },
          { value: 'm_lofi', label: 'Lo-Fi' },
        ]}
        ambienceValue="m_none"
        onAmbienceChange={vi.fn()}
        speakerOptions={[
          { value: 'v1', label: 'Narrator' },
          { value: 'v2', label: 'Guest' },
        ]}
        speakerValue="v1"
        onSpeakerChange={vi.fn()}
      />
    );
    expect(html).toContain('Reader');
    expect(html).toContain('Sticky Player');
    expect(html).toContain('Read - Idle');
    expect(html).toContain('0 ready chunks');
    expect(html).toContain('3 pending');
    expect(html).toContain('queue 33%');
    expect(html).toContain('Previous chunk');
    expect(html).toContain('Next chunk');
    expect(html).toContain('disabled=""');
    expect(html).toContain('aria-label="Import content"');
    expect(html).toContain('aria-label="Ambience preset"');
    expect(html).toContain('aria-label="Narrator voice"');
    expect(html).toContain('aria-label="Open settings"');
    expect(html).toContain('None');
    expect(html).toContain('Guest');
    expect(html).toContain('accept=".txt,.pdf"');
    expect(html).toContain('Collapse dock to compact circle');
  });

  it('shows ready-state queue stats in full mode', () => {
    const html = renderToStaticMarkup(
      <ReaderStickyDock
        title="Demo"
        unitLabel="Chapter 1"
        readyChunkCount={4}
        pendingChunkCount={2}
        queueFillPct={66}
        statusLabel="Ready"
        isPlaying={false}
        miniMode={false}
        transportDisabled={false}
        onTogglePlay={vi.fn()}
        onPrev={vi.fn()}
        onNext={vi.fn()}
        onToggleMiniMode={vi.fn()}
        onImportFiles={vi.fn()}
        onOpenSettings={vi.fn()}
      />
    );

    expect(html).toContain('Demo');
    expect(html).toContain('Chapter 1 - Ready');
    expect(html).toContain('4 ready chunks');
    expect(html).toContain('2 pending');
    expect(html).toContain('queue 66%');
    expect(html).toContain('Collapse dock to compact circle');
  });

  it('collapses into a compact circle in mini mode', () => {
    const html = renderToStaticMarkup(
      <ReaderStickyDock
        title="Demo"
        unitLabel="Chapter 1"
        readyChunkCount={1}
        pendingChunkCount={0}
        queueFillPct={20}
        statusLabel="Idle"
        isPlaying={false}
        miniMode
        transportDisabled={false}
        onTogglePlay={vi.fn()}
        onPrev={vi.fn()}
        onNext={vi.fn()}
        onToggleMiniMode={vi.fn()}
        onImportFiles={vi.fn()}
        onOpenSettings={vi.fn()}
      />
    );

    expect(html).toContain('aria-label="Expand reader dock"');
    expect(html).toContain('1 ready chunks, 0 pending, queue 20%');
  });
});
