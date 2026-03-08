import { describe, expect, it } from 'vitest';

import {
  resolveDubbingProcessingProfile,
  resolveDubbingSourceLanguageMode,
} from '../src/features/dubbing/model/pipelineDefaults';

describe('dubbing pipeline defaults', () => {
  it('keeps short single-speaker jobs on cpu_quality', () => {
    expect(resolveDubbingProcessingProfile({
      durationSec: 48,
      segmentCount: 10,
      totalChars: 900,
      speakerCount: 1,
    })).toBe('cpu_quality');
  });

  it('moves longer jobs to cpu_balanced or cpu_fast', () => {
    expect(resolveDubbingProcessingProfile({
      durationSec: 220,
      segmentCount: 44,
      totalChars: 4100,
      speakerCount: 3,
    })).toBe('cpu_balanced');

    expect(resolveDubbingProcessingProfile({
      durationSec: 720,
      segmentCount: 120,
      totalChars: 12000,
      speakerCount: 4,
    })).toBe('cpu_fast');
  });

  it('uses detected_global when transcript scripts are consistent', () => {
    expect(resolveDubbingSourceLanguageMode({
      detectedLanguage: 'en',
      texts: ['Hello there', 'How are you today?'],
    })).toBe('detected_global');
  });

  it('uses auto_per_segment when transcript scripts look mixed', () => {
    expect(resolveDubbingSourceLanguageMode({
      detectedLanguage: 'hi',
      texts: ['hello dost', 'नमस्ते दुनिया'],
    })).toBe('auto_per_segment');
  });
});
