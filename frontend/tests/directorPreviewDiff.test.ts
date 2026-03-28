import { describe, expect, it } from 'vitest';
import {
  buildDirectorPreviewDiff,
  normalizeDirectorPreviewComparisonText,
  normalizeDirectorPreviewLines,
} from '../components/studio/directorPreviewDiff';

describe('buildDirectorPreviewDiff', () => {
  it('keeps identical scripts unchanged', () => {
    const diff = buildDirectorPreviewDiff(
      'Host: We got the launch date.\nProducer: We can make this happen.',
      'Host: We got the launch date.\nProducer: We can make this happen.',
    );

    expect(diff.summary).toEqual({
      totalChanged: 0,
      added: 0,
      removed: 0,
      modified: 0,
    });
    expect(diff.rows.map((row) => row.status)).toEqual(['unchanged', 'unchanged']);
  });

  it('marks lines added by the AI Director pass', () => {
    const diff = buildDirectorPreviewDiff(
      'Host: We got the launch date.',
      'Host: We got the launch date.\n(Producer) (Warm): This release matters.',
    );

    expect(diff.summary).toEqual({
      totalChanged: 1,
      added: 1,
      removed: 0,
      modified: 0,
    });
    expect(diff.rows.map((row) => row.status)).toEqual(['unchanged', 'added']);
    expect(diff.rows[1]?.previewText).toContain('(Producer) (Warm)');
  });

  it('marks lines removed from the directed pass', () => {
    const diff = buildDirectorPreviewDiff(
      'Host: We got the launch date.\nProducer: This release matters.',
      'Host: We got the launch date.',
    );

    expect(diff.summary).toEqual({
      totalChanged: 1,
      added: 0,
      removed: 1,
      modified: 0,
    });
    expect(diff.rows.map((row) => row.status)).toEqual(['unchanged', 'removed']);
    expect(diff.rows[1]?.sourceText).toContain('Producer: This release matters.');
  });

  it('collapses a single remove plus add pair into one modified row', () => {
    const diff = buildDirectorPreviewDiff(
      'Can we have everything ready by Monday?',
      '(Host) (Confident): Can we have everything ready by Monday?',
    );

    expect(diff.summary).toEqual({
      totalChanged: 1,
      added: 0,
      removed: 0,
      modified: 1,
    });
    expect(diff.rows).toHaveLength(1);
    expect(diff.rows[0]).toMatchObject({
      status: 'modified',
      sourceText: 'Can we have everything ready by Monday?',
      previewText: '(Host) (Confident): Can we have everything ready by Monday?',
    });
  });

  it('handles multiple changed blocks without over-collapsing them', () => {
    const diff = buildDirectorPreviewDiff(
      'Line A\nLine B\nLine C\nLine D',
      'Line A\nLine B (Directed)\nLine C\nLine C2\nLine D',
    );

    expect(diff.summary).toEqual({
      totalChanged: 2,
      added: 1,
      removed: 0,
      modified: 1,
    });
    expect(diff.rows.map((row) => row.status)).toEqual([
      'unchanged',
      'modified',
      'unchanged',
      'added',
      'unchanged',
    ]);
  });

  it('normalizes newlines and trims boundary blank lines before diffing', () => {
    expect(normalizeDirectorPreviewLines('\r\n\r\nLine 1\r\nLine 2\r\n\r\n')).toEqual(['Line 1', 'Line 2']);
    expect(normalizeDirectorPreviewComparisonText('\r\n\r\nLine 1\r\nLine 2\r\n\r\n')).toBe('Line 1\nLine 2');

    const diff = buildDirectorPreviewDiff(
      '\r\n\r\nLine 1\r\nLine 2\r\n\r\n',
      'Line 1\nLine 2',
    );

    expect(diff.summary.totalChanged).toBe(0);
    expect(diff.rows.map((row) => row.status)).toEqual(['unchanged', 'unchanged']);
  });
});
