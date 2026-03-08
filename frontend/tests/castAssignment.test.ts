import { describe, expect, it } from 'vitest';
import type { VoiceOption } from '../types';
import { autoAssignSpeakerVoices } from '../src/shared/voices/castAssignment';

const TEST_VOICES: VoiceOption[] = [
  {
    id: 'voice_adult_male',
    name: 'George',
    gender: 'Male',
    accent: 'US',
    geminiVoiceName: 'george',
    ageGroup: 'Adult',
  },
  {
    id: 'voice_child_female',
    name: 'Bella Kid',
    gender: 'Female',
    accent: 'US',
    geminiVoiceName: 'bella_kid',
    ageGroup: 'Child',
  },
  {
    id: 'voice_elder_male',
    name: 'Grand George',
    gender: 'Male',
    accent: 'US',
    geminiVoiceName: 'grand_george',
    ageGroup: 'Elderly',
  },
];

describe('cast assignment', () => {
  it('uses AI trait hints to bias the selected voice', () => {
    const result = autoAssignSpeakerVoices({
      speakers: ['Mia', 'Grandpa'],
      script: 'A short sample without strict speaker markup.',
      voices: TEST_VOICES,
      traitHints: {
        Mia: {
          gender: 'Female',
          ageGroup: 'Child',
          tone: 'energetic',
        },
        Grandpa: {
          gender: 'Male',
          ageGroup: 'Elderly',
          tone: 'serious',
        },
      },
    });

    expect(result.mapping.Mia).toBe('voice_child_female');
    expect(result.mapping.Grandpa).toBe('voice_elder_male');
  });
});
