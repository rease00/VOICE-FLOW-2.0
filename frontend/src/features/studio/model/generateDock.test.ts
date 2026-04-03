import { describe, expect, it } from 'vitest';

import { resolveStudioGenerateDockMetrics } from './generateDock';

describe('resolveStudioGenerateDockMetrics', () => {
  it('anchors phone docks to the editor center and keeps the width inside the editor shell', () => {
    const metrics = resolveStudioGenerateDockMetrics({
      viewportWidth: 390,
      mode: 'phone',
      editorLeft: 12,
      editorWidth: 366,
    });

    expect(metrics.centerX).toBe(195);
    expect(metrics.width).toBe(344);
  });

  it('uses the viewport center as a fallback when editor metrics are unavailable', () => {
    const metrics = resolveStudioGenerateDockMetrics({
      viewportWidth: 1024,
      mode: 'tablet',
    });

    expect(metrics.centerX).toBe(512);
    expect(metrics.width).toBe(410);
  });

  it('keeps narrow desktop docks readable without overshooting the editor width', () => {
    const metrics = resolveStudioGenerateDockMetrics({
      viewportWidth: 1080,
      mode: 'desktop',
      editorLeft: 24,
      editorWidth: 900,
      isNarrowDesktop: true,
    });

    expect(metrics.centerX).toBe(474);
    expect(metrics.width).toBe(342);
  });

  it('lets large desktop docks grow with the editor while staying capped', () => {
    const metrics = resolveStudioGenerateDockMetrics({
      viewportWidth: 1600,
      mode: 'desktop',
      editorLeft: 60,
      editorWidth: 1200,
      isLargeDesktop: true,
    });

    expect(metrics.centerX).toBe(660);
    expect(metrics.width).toBe(408);
  });
});
