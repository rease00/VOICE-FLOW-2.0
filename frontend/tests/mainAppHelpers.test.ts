import { describe, expect, it } from 'vitest';
import {
  injectDirectorTagsPreservingFormat,
  getEngineSelectorCopy,
  normalizeAllowedEngines,
  normalizeSpeakerHeaderScript,
  resolveEngineToken,
  resolvePrimeAllowedEngines,
} from '../src/app/workspace/mainAppHelpers';
import { getEngineDisplayName } from '../services/engineDisplay';

describe('mainAppHelpers engine token handling', () => {
  it('preserves legacy engine tokens instead of silently mapping them to PRIME', () => {
    expect(resolveEngineToken('prime_v2')).toBe('prime_v2');
    expect(resolveEngineToken('vector')).toBe('VECTOR');
  });

  it('only keeps canonical engines when normalizing allowed engine lists', () => {
    expect(normalizeAllowedEngines(['DUNO', 'legacy', 'prime_v2', 'VECTOR', 'PRIME'])).toEqual([
      'DUNO',
      'VECTOR',
      'PRIME',
    ]);
  });

  it('provides selector-specific copy without changing shared labels', () => {
    expect(getEngineSelectorCopy('DUNO')).toEqual({
      title: getEngineDisplayName('DUNO'),
      description: 'Expressive voice with built-in cloning.',
    });
    expect(getEngineSelectorCopy('VECTOR')).toEqual({
      title: getEngineDisplayName('VECTOR'),
      description: 'Balanced quality with reliable performance.',
    });
    expect(getEngineSelectorCopy('PRIME')).toEqual({
      title: getEngineDisplayName('PRIME'),
      description: 'Premium synthesis for natural, polished output.',
    });
  });

  it('keeps PRIME locked until the account is paid or has paid token balance', () => {
    expect(resolvePrimeAllowedEngines({
      hasUnlimitedAccess: false,
      isPaidBillingPlan: false,
      paidVfBalance: 0,
    })).toEqual(['DUNO', 'VECTOR']);

    expect(resolvePrimeAllowedEngines({
      hasUnlimitedAccess: false,
      isPaidBillingPlan: false,
      paidVfBalance: 125,
    })).toEqual(['DUNO', 'VECTOR', 'PRIME']);

    expect(resolvePrimeAllowedEngines({
      hasUnlimitedAccess: false,
      isPaidBillingPlan: true,
      paidVfBalance: 0,
    })).toEqual(['DUNO', 'VECTOR', 'PRIME']);
  });
});

describe('injectDirectorTagsPreservingFormat', () => {
  it('applies directed emotion and cue tags while preserving source dialogue text', () => {
    const source = 'Riya: We should leave now.';
    const directed = 'Riya (Shouting, Whispering to self): We should leave now.';

    const patched = injectDirectorTagsPreservingFormat(source, directed);

    expect(patched.text).toBe('Riya (Shouting, Whispering to self): We should leave now.');
    expect(patched.patchedLineCount).toBe(1);
  });

  it('adds missing speaker headers when source line is plain text', () => {
    const source = 'The house was quiet.';
    const directed = 'Narrator (Calm): The house was quiet.';

    const patched = injectDirectorTagsPreservingFormat(source, directed);

    expect(patched.text).toBe('Narrator (Calm): The house was quiet.');
    expect(patched.patchedLineCount).toBe(1);
  });

  it('preserves sfx lines and keeps their content unchanged', () => {
    const source = '[SFX: Rain]';
    const directed = 'Narrator (Calm): Rain starts outside.';

    const patched = injectDirectorTagsPreservingFormat(source, directed);

    expect(patched.text).toBe('[SFX: Rain]');
    expect(patched.patchedLineCount).toBe(0);
  });
});

describe('normalizeSpeakerHeaderScript', () => {
  it('preserves dialogue text while normalizing bracketed headers', () => {
    expect(normalizeSpeakerHeaderScript('मोहन: नमस्ते दुनिया')).toBe('[मोहन]: नमस्ते दुनिया');
  });

  it('merges orphan speaker headers with the following plain line', () => {
    const input = '[Narrator]:\nThe story begins now.';
    expect(normalizeSpeakerHeaderScript(input)).toBe('[Narrator]: The story begins now.');
  });
});
