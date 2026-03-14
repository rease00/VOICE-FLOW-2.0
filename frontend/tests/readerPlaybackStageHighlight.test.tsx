import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ReaderPlaybackStage } from '../src/features/reader/components/ReaderPlaybackStage';
import type { ReaderSession } from '../src/types';
import type { PlaylistItem } from '../src/features/reader/components/readerTypes';

const buildBaseSession = (contentKind: 'book' | 'comic'): ReaderSession => ({
  id: `session-${contentKind}`,
  title: 'Reader Stage',
  contentKind,
  windows: [],
  panels: [],
  progressPct: 18,
  ttsLanguageMode: 'target',
} as unknown as ReaderSession);

const buildBaseProps = (
  session: ReaderSession,
  activeItem: PlaylistItem | null
): React.ComponentProps<typeof ReaderPlaybackStage> => ({
  session,
  sessionItem: null,
  activeItem,
  onSelectWindow: () => undefined,
  onSelectPanel: () => undefined,
  resolveMediaUrl: (url) => String(url || ''),
  panelRefs: { current: {} },
  pauseAutoSwipe: () => undefined,
  targetLanguageLabel: 'Spanish',
  pageViewModeLabel: 'Translated Page View',
  audioEngineLabel: 'Gemini 2.5 Flash TTS',
  audioEngineStatus: 'active',
});

describe('ReaderPlaybackStage highlight behavior', () => {
  it('renders highlighted active line for book playback', () => {
    const session = buildBaseSession('book');
    session.windows = [
      {
        index: 0,
        startChar: 0,
        endChar: 180,
        charCount: 180,
        displayText: 'Highlighted translated line',
        job: { status: 'completed' },
      } as unknown as ReaderSession['windows'][number],
    ];

    const activeItem: PlaylistItem = {
      key: 'book-0',
      kind: 'window',
      jobId: 'job-1',
      title: 'Window 1',
      text: 'Highlighted translated line',
      url: '/audio/mock.wav',
      startChar: 0,
    };

    const html = renderToStaticMarkup(<ReaderPlaybackStage {...buildBaseProps(session, activeItem)} />);
    expect(html).toContain('vf-reader-player__active-line');
    expect(html).toContain('Highlighted translated line');
    expect(html).toContain('Narrating in Spanish');
  });

  it('renders highlighted active line for comic panel playback', () => {
    const session = buildBaseSession('comic');
    session.panels = [
      {
        panelId: 'panel-1',
        index: 0,
        translatedText: 'Active comic panel text',
        audioJob: { status: 'completed' },
      } as unknown as ReaderSession['panels'][number],
    ];

    const activeItem: PlaylistItem = {
      key: 'panel-0',
      kind: 'panel',
      jobId: 'job-2',
      title: 'Panel 1',
      text: 'Active comic panel text',
      url: '/audio/mock.wav',
      panelIndex: 0,
    };

    const html = renderToStaticMarkup(<ReaderPlaybackStage {...buildBaseProps(session, activeItem)} />);
    expect(html).toContain('vf-reader-player__active-line');
    expect(html).toContain('vf-reader-player__panel--active');
    expect(html).toContain('Active comic panel text');
  });
});

