import { VECTOR_MULTI_SPEAKER_DEMO_ENTRIES } from './vectorMultiSpeakerDemoManifest';

export type LandingVoiceGender = 'Male' | 'Female';

export interface VerifiedMultiSpeakerCastMember {
  role: string;
  displayName: string;
  voiceId: string;
  voiceGender: LandingVoiceGender;
  lineCount: number;
}

export interface VerifiedMultiSpeakerLine {
  lineIndex: number;
  speaker: string;
  role: string;
  displayName: string;
  voiceId: string;
  voiceGender: LandingVoiceGender;
  text: string;
}

export interface VerifiedMultiSpeakerProof {
  id: string;
  label: string;
  title: string;
  description: string;
  language: string;
  market: string;
  audioSrc: string;
  cast: VerifiedMultiSpeakerCastMember[];
  lines: VerifiedMultiSpeakerLine[];
  rtl?: boolean;
}

const proofEntry =
  VECTOR_MULTI_SPEAKER_DEMO_ENTRIES.find((entry) => entry.id === 'en-roundtable')
  || VECTOR_MULTI_SPEAKER_DEMO_ENTRIES.find((entry) => entry.id === 'hi-audiobook')
  || VECTOR_MULTI_SPEAKER_DEMO_ENTRIES[0];

if (!proofEntry) {
  throw new Error('Verified multi-speaker proof requires at least one generated demo entry.');
}

export const VERIFIED_MULTI_SPEAKER_PROOF: VerifiedMultiSpeakerProof = {
  id: proofEntry.id,
  label: 'Live product proof',
  title: 'Cast-aware voice direction buyers can hear in seconds.',
  description:
    'A clean three-speaker roundtable with explicit role mapping, built to prove cast separation and clearer handoffs before export.',
  language: proofEntry.language,
  market: proofEntry.market,
  audioSrc: proofEntry.audioSrc,
  cast: proofEntry.cast.map((member) => ({
    role: member.role,
    displayName: member.displayName,
    voiceId: member.voiceId,
    voiceGender: member.voiceGender as LandingVoiceGender,
    lineCount: member.lineCount,
  })),
  lines: proofEntry.lines.map((line) => ({
    lineIndex: line.lineIndex,
    speaker: line.speaker,
    role: line.role,
    displayName: line.displayName,
    voiceId: line.voiceId,
    voiceGender: line.voiceGender as LandingVoiceGender,
    text: line.text,
  })),
  ...(proofEntry.rtl ? { rtl: true } : {}),
};
