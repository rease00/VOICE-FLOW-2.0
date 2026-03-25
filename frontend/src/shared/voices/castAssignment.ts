import type { CharacterProfile, VoiceOption } from '../../../types';
import {
  guessAgeGroupFromSpeaker,
  guessGenderFromName,
  parseScriptToSegments,
  normalizeSpeakerMapKey,
  resolveSpeakerMappedVoiceId,
} from '../../../services/geminiService';

export interface AutoAssignedSpeakerVoice {
  speaker: string;
  voice: VoiceOption;
  inferredGender: VoiceOption['gender'];
  inferredAgeGroup: 'Child' | 'Adult' | 'Elderly' | 'Unknown';
  tone: 'calm' | 'energetic' | 'serious';
}

export interface AutoAssignedSpeakerTraitHint {
  gender?: VoiceOption['gender'];
  ageGroup?: 'Child' | 'Adult' | 'Elderly' | 'Unknown';
  tone?: 'calm' | 'energetic' | 'serious';
}

interface AutoAssignSpeakerVoicesOptions {
  speakers: string[];
  script: string;
  voices: VoiceOption[];
  existingMapping?: Record<string, string>;
  characterLibrary?: CharacterProfile[];
  rememberedVoices?: Record<string, string>;
  traitHints?: Record<string, AutoAssignedSpeakerTraitHint>;
}

const narratorSpeakerPattern = /\b(narrator|voice\s*over|storyteller|commentator)\b/i;
const energeticVoicePattern = /\b(nova|shimmer|heart|bella|sarah|aoede|callirrhoe|priya|anjali|sophie|olivia|lyra|kaia|mira|zoya|elara|cora|kavya|isha)\b/i;
const seriousVoicePattern = /\b(onyx|fable|echo|george|david|michael|fenrir|omega|psi|alnilam|iapetus|rian|lucan|soren|darian|alden|osric|aarav|veer)\b/i;

const normalizeVoiceAgeGroup = (voice: VoiceOption): 'Child' | 'Adult' | 'Elderly' | 'Unknown' => {
  const token = `${voice.ageGroup || ''} ${voice.name || ''} ${voice.id || ''}`.trim().toLowerCase();
  if (!token) return 'Unknown';
  if (/\b(child|kid|boy|girl|teen)\b/.test(token)) return 'Child';
  if (/\b(elder|elderly|old|senior|aged|grand)\b/.test(token)) return 'Elderly';
  if (/\badult\b/.test(token)) return 'Adult';
  return 'Unknown';
};

const inferSpeakerGender = (
  speaker: string,
  sample: string,
  characterLibrary: CharacterProfile[],
): VoiceOption['gender'] => {
  const existing = characterLibrary.find((item) => item.name.toLowerCase() === speaker.toLowerCase());
  if (existing?.gender && existing.gender !== 'Unknown') return existing.gender;

  const fromName = guessGenderFromName(speaker);
  if (fromName !== 'Unknown') return fromName;

  const probe = `${speaker} ${sample}`.toLowerCase();
  if (/\b(she|her|hers|mother|mom|queen|princess|girl|woman|madam|didi|behen|aunty)\b/i.test(probe)) return 'Female';
  if (/\b(he|him|his|father|dad|king|prince|boy|man|sir|bhai|bhaiya|uncle)\b/i.test(probe)) return 'Male';
  return 'Unknown';
};

const inferSpeakerAge = (
  speaker: string,
  sample: string,
  characterLibrary: CharacterProfile[],
): 'Child' | 'Adult' | 'Elderly' | 'Unknown' => {
  const existing = characterLibrary.find((item) => item.name.toLowerCase() === speaker.toLowerCase());
  const existingAge = String(existing?.age || '').trim().toLowerCase();
  if (/\b(child|kid|boy|girl|teen)\b/.test(existingAge)) return 'Child';
  if (/\b(elder|elderly|old|senior|aged|grand)\b/.test(existingAge)) return 'Elderly';
  if (/\badult\b/.test(existingAge)) return 'Adult';

  const fromName = guessAgeGroupFromSpeaker(speaker);
  if (fromName !== 'Unknown') return fromName;

  const probe = `${speaker} ${sample}`.toLowerCase();
  if (/\b(child|kid|boy|girl|teen|son|daughter|school|student|bacha|bachi|ladka|ladki)\b/i.test(probe)) {
    return 'Child';
  }
  if (/\b(elder|elderly|old|senior|aged|grandma|grandpa|grandfather|grandmother|dada|dadi|nana|nani|buzurg)\b/i.test(probe)) {
    return 'Elderly';
  }
  return 'Unknown';
};

const inferSpeakerTone = (sample: string): 'calm' | 'energetic' | 'serious' => {
  const textSample = String(sample || '').trim();
  if (!textSample) return 'calm';

  let energeticScore = 0;
  let seriousScore = 0;

  if ((textSample.match(/!/g) || []).length >= 2) energeticScore += 2;
  if (/[A-Z]{4,}/.test(textSample)) energeticScore += 1;
  if (/\b(wow|great|amazing|quick|hurry|run|go|excited|lets|let's|jaldi|wah|chalo)\b/i.test(textSample)) energeticScore += 2;

  if (/\b(danger|warning|battle|war|crime|murder|order|command|urgent|serious|must)\b/i.test(textSample)) seriousScore += 2;
  if ((textSample.match(/[?.]/g) || []).length > 4) seriousScore += 1;
  if (/\b(quietly|slowly|softly|carefully|gently)\b/i.test(textSample)) seriousScore += 1;

  if (energeticScore >= seriousScore + 2) return 'energetic';
  if (seriousScore > energeticScore) return 'serious';
  return 'calm';
};

const hashText = (value: string): number => {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) - hash) + value.charCodeAt(index);
    hash |= 0;
  }
  return Math.abs(hash);
};

export const autoAssignSpeakerVoices = ({
  speakers,
  script,
  voices,
  existingMapping,
  characterLibrary = [],
  rememberedVoices = {},
  traitHints = {},
}: AutoAssignSpeakerVoicesOptions): { mapping: Record<string, string>; assignments: AutoAssignedSpeakerVoice[] } => {
  if (!speakers.length || !voices.length) return { mapping: {}, assignments: [] };

  const speakerLookup = new Map<string, string>();
  speakers.forEach((speaker) => {
    const normalized = String(speaker || '').trim();
    if (!normalized) return;
    speakerLookup.set(normalized.toLowerCase(), normalized);
  });

  const parsedSegments = parseScriptToSegments(script);
  const speakerSamples = new Map<string, string[]>();
  parsedSegments.forEach((segment) => {
    const rawSpeaker = String(segment.speaker || '').trim();
    if (!rawSpeaker || rawSpeaker.toUpperCase() === 'SFX') return;
    const canonicalSpeaker = speakerLookup.get(rawSpeaker.toLowerCase()) || rawSpeaker;
    if (!speakerSamples.has(canonicalSpeaker)) speakerSamples.set(canonicalSpeaker, []);
    const line = String(segment.text || '').trim();
    if (line) speakerSamples.get(canonicalSpeaker)?.push(line);
  });

  const usedVoiceIds = new Set<string>();
  const mapping: Record<string, string> = {};
  const assignments: AutoAssignedSpeakerVoice[] = [];

  speakers.forEach((speaker) => {
    const normalizedSpeaker = String(speaker || '').trim();
    if (!normalizedSpeaker) return;

    const sample = (speakerSamples.get(normalizedSpeaker) || []).slice(0, 3).join(' ');
    const speakerHint =
      traitHints[normalizedSpeaker]
      || traitHints[normalizedSpeaker.toLowerCase()]
      || undefined;
    const inferredGender = speakerHint?.gender && speakerHint.gender !== 'Unknown'
      ? speakerHint.gender
      : inferSpeakerGender(normalizedSpeaker, sample, characterLibrary);
    const inferredAgeGroup = speakerHint?.ageGroup && speakerHint.ageGroup !== 'Unknown'
      ? speakerHint.ageGroup
      : inferSpeakerAge(normalizedSpeaker, sample, characterLibrary);
    const tone = speakerHint?.tone || inferSpeakerTone(sample);
    const rememberedVoiceId = String(
      rememberedVoices[normalizedSpeaker]
      || rememberedVoices[normalizedSpeaker.toLowerCase()]
      || ''
    ).trim();

    const ranked = voices
      .map((voice, index) => {
        const meta = `${voice.name || ''} ${voice.id || ''} ${voice.accent || ''} ${voice.country || ''} ${voice.ageGroup || ''}`.toLowerCase();
        const voiceAgeGroup = normalizeVoiceAgeGroup(voice);
        const isChildVoice = voiceAgeGroup === 'Child';
        const isElderVoice = voiceAgeGroup === 'Elderly';
        const isAdultVoice = voiceAgeGroup === 'Adult' || (!isChildVoice && !isElderVoice);
        let score = 0;

        if (inferredGender !== 'Unknown') {
          if (voice.gender === inferredGender) score += 26;
          else if (voice.gender !== 'Unknown') score -= 8;
        } else if (voice.gender === 'Unknown') {
          score += 3;
        }

        if (inferredAgeGroup === 'Child') {
          if (isChildVoice) score += 30;
          else if (isElderVoice) score -= 18;
          else score -= 6;
        } else if (inferredAgeGroup === 'Elderly') {
          if (isElderVoice) score += 30;
          else if (isChildVoice) score -= 18;
          else score -= 4;
        } else if (inferredAgeGroup === 'Adult') {
          if (isAdultVoice) score += 6;
        } else if (isAdultVoice) {
          score += 2;
        }

        if (rememberedVoiceId && voice.id === rememberedVoiceId) score += 8;
        if (resolveSpeakerMappedVoiceId(existingMapping, normalizedSpeaker) === voice.id) score += 4;

        const isNarrator = narratorSpeakerPattern.test(normalizedSpeaker);
        if (isNarrator && seriousVoicePattern.test(meta)) score += 10;
        if (tone === 'energetic' && energeticVoicePattern.test(meta)) score += 9;
        if (tone === 'serious' && seriousVoicePattern.test(meta)) score += 9;
        if (tone === 'calm' && narratorSpeakerPattern.test(meta)) score += 6;
        if (meta.includes(normalizedSpeaker.toLowerCase())) score += 7;

        if (!usedVoiceIds.has(voice.id)) score += 4;
        score += (hashText(`${normalizedSpeaker}:${voice.id}`) % 7) / 100;
        score -= index * 0.0001;

        return { voice, score };
      })
      .sort((left, right) => right.score - left.score);

    const selectedVoice =
      ranked.find((entry) => !usedVoiceIds.has(entry.voice.id))?.voice
      || ranked[0]?.voice
      || voices[0];

    if (!selectedVoice) return;

    mapping[normalizedSpeaker] = selectedVoice.id;
    assignments.push({
      speaker: normalizedSpeaker,
      voice: selectedVoice,
      inferredGender,
      inferredAgeGroup,
      tone,
    });
    usedVoiceIds.add(selectedVoice.id);
  });

  return { mapping, assignments };
};

const findSpeakerMappingKey = (mapping: Record<string, string> | undefined, speaker: string): string => {
  if (!mapping || typeof mapping !== 'object') return '';
  const rawSpeaker = String(speaker || '');
  if (!rawSpeaker.trim()) return '';
  if (mapping[rawSpeaker]) return rawSpeaker;
  const trimmed = rawSpeaker.trim();
  if (trimmed && mapping[trimmed]) return trimmed;
  const normalizedTarget = normalizeSpeakerMapKey(rawSpeaker);
  if (!normalizedTarget) return '';
  for (const key of Object.keys(mapping)) {
    if (!key) continue;
    if (normalizeSpeakerMapKey(key) === normalizedTarget) return key;
  }
  return '';
};

interface RefreshStudioSpeakerVoicesOptions extends Omit<AutoAssignSpeakerVoicesOptions, 'existingMapping' | 'rememberedVoices'> {
  currentMapping?: Record<string, string>;
}

export const refreshStudioSpeakerVoices = ({
  currentMapping = {},
  ...options
}: RefreshStudioSpeakerVoicesOptions): { mapping: Record<string, string>; assignments: AutoAssignedSpeakerVoice[] } => {
  const currentSpeakerKeys = new Set(
    options.speakers
      .map((speaker) => String(speaker || '').trim().toLowerCase())
      .filter(Boolean)
  );
  const { mapping: freshMapping, assignments } = autoAssignSpeakerVoices({
    ...options,
    characterLibrary: (options.characterLibrary || []).filter(
      (item) => !currentSpeakerKeys.has(String(item.name || '').trim().toLowerCase())
    ),
  });

  const nextMapping = { ...(currentMapping || {}) };
  Object.entries(freshMapping).forEach(([speaker, voiceId]) => {
    const matchedKey = findSpeakerMappingKey(nextMapping, speaker);
    if (matchedKey && matchedKey !== speaker) delete nextMapping[matchedKey];
    nextMapping[speaker] = voiceId;
  });

  return {
    mapping: nextMapping,
    assignments,
  };
};
