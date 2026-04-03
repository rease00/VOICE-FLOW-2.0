import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ReaderPlaybackStage } from './ReaderPlaybackStage';

describe('ReaderPlaybackStage', () => {
  it('renders the live ticker and VF estimate surface', () => {
    const markup = renderToStaticMarkup(
      <ReaderPlaybackStage
        mode="novel"
        title="Reader"
        summary="Summary"
        progressPct={42}
        activeUnitIndex={0}
        savedUnitIds={['unit-1']}
        units={[{
          id: 'unit-1',
          title: 'Chapter 1',
          body: 'This is the active line of text.',
          jobId: '',
          status: 'ready',
          mode: 'novel',
          index: 0,
          confidenceLow: false,
          charCount: 32,
        }]}
        coverUrl=""
        statusLabel="Ready"
        liveTickerText="This is the active line of text."
        vfEstimateLabel="VF est 1 / 2"
        vfEstimateDetail="32 chars tracked"
        contentScrollRef={React.createRef<HTMLDivElement>()}
        onSelectUnit={() => undefined}
      />
    );

    expect(markup).toContain('data-testid="reader-live-ticker"');
    expect(markup).toContain('data-testid="reader-vf-estimate"');
    expect(markup).toContain('data-saved="true"');
    expect(markup).toContain('Saved');
    expect(markup).toContain('VF est 1 / 2');
    expect(markup).toContain('This is the active line of text.');
  });
});
