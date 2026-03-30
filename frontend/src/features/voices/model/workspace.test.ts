import { describe, expect, it } from 'vitest';

import {
  deriveVoicesInspectorPriority,
  resolveVoicesInspectorPriority,
  resolveVoicesSelectionId,
  resolveVoicesWorkspaceMode,
} from './workspace';

describe('voices workspace model', () => {
  it('normalizes workspace modes with library fallback', () => {
    expect(resolveVoicesWorkspaceMode(undefined)).toBe('library');
    expect(resolveVoicesWorkspaceMode('')).toBe('library');
    expect(resolveVoicesWorkspaceMode('LIBRARY')).toBe('library');
    expect(resolveVoicesWorkspaceMode('clone')).toBe('clone');
    expect(resolveVoicesWorkspaceMode('cast')).toBe('library');
    expect(resolveVoicesWorkspaceMode('unknown')).toBe('library');
  });

  it('normalizes inspector priority with fallback', () => {
    expect(resolveVoicesInspectorPriority(undefined)).toBe('voice');
    expect(resolveVoicesInspectorPriority('voice')).toBe('voice');
    expect(resolveVoicesInspectorPriority('stem-result')).toBe('stem-result');
    expect(resolveVoicesInspectorPriority('unsupported', 'clone-result')).toBe('clone-result');
  });

  it('prefers diagnostics when expanded', () => {
    expect(
      deriveVoicesInspectorPriority({
        mode: 'clone',
        hasSelectedCharacter: false,
        hasSelectedVoice: false,
        hasCloneResult: true,
        hasStemResult: true,
        diagnosticsExpanded: true,
      })
    ).toBe('diagnostics');
  });

  it('chooses clone result priorities for clone mode', () => {
    expect(
      deriveVoicesInspectorPriority({
        mode: 'clone',
        hasSelectedCharacter: false,
        hasSelectedVoice: false,
        hasCloneResult: false,
        hasStemResult: false,
        diagnosticsExpanded: false,
      })
    ).toBe('clone-result');

    expect(
      deriveVoicesInspectorPriority({
        mode: 'clone',
        hasSelectedCharacter: false,
        hasSelectedVoice: false,
        hasCloneResult: true,
        hasStemResult: true,
        diagnosticsExpanded: false,
      })
    ).toBe('stem-result');
  });

  it('selects the first available fallback id when the preferred value is missing', () => {
    expect(resolveVoicesSelectionId('v2', ['v1', 'v2'])).toBe('v2');
    expect(resolveVoicesSelectionId('missing', ['v1', 'v2'])).toBe('v1');
    expect(resolveVoicesSelectionId('', [])).toBe('');
  });
});
