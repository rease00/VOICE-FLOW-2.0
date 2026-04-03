import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { VOICES } from '../constants';

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const WORKSPACE_ROOT = path.resolve(TEST_DIR, '..', '..');

const readJsonFile = (relativePath: string): any =>
  JSON.parse(
    fs
      .readFileSync(path.join(WORKSPACE_ROOT, relativePath), 'utf8')
      .replace(/^\uFEFF/, '')
  );

describe('PRIME speaker catalog parity', () => {
  const voiceMap = readJsonFile('backend/config/voice_id_map.v1.json');
  const profileBank = readJsonFile('backend/config/voice_profile_bank.v1.json');
  const vectorMultiManifest = readJsonFile('frontend/public/audio/vector-multi-demo/manifest.json');

  const runtimeVoices = Array.isArray(voiceMap?.engines?.PRIME?.runtimeVoices)
    ? voiceMap.engines.PRIME.runtimeVoices
    : [];
  const voiceToProfile = (voiceMap?.engines?.PRIME?.voiceToProfile || {}) as Record<string, string>;
  const voiceByGeminiName = new Map(
    VOICES.map((voice) => [String(voice.geminiVoiceName || '').trim().toLowerCase(), voice])
  );
  const profileById = new Map(
    (Array.isArray(profileBank?.profiles) ? profileBank.profiles : [])
      .filter((profile: any) => profile && typeof profile === 'object')
      .map((profile: any) => [String(profile.profileId || '').trim(), profile])
  );

  it('keeps frontend genders aligned with backend PRIME runtime voices', () => {
    const runtimeByVoice = new Map(
      runtimeVoices
        .filter((row: any) => row && typeof row === 'object')
        .map((row: any) => [String(row.voice || '').trim().toLowerCase(), row])
    );

    for (const voice of VOICES) {
      const runtimeRow = runtimeByVoice.get(String(voice.geminiVoiceName || '').trim().toLowerCase());
      expect(
        runtimeRow,
        `Missing PRIME runtime voice for frontend entry ${voice.id} (${voice.geminiVoiceName})`
      ).toBeTruthy();
      expect(String(runtimeRow?.gender || '').trim().toLowerCase()).toBe(
        String(voice.gender || '').trim().toLowerCase()
      );
    }
  });

  it('keeps frontend genders aligned with mapped voice profiles', () => {
    const mismatches: string[] = [];

    for (const voice of VOICES) {
      const profileId = String(
        voiceToProfile[String(voice.geminiVoiceName || '').trim()]
        || voiceToProfile[String(voice.id || '').trim()]
        || ''
      ).trim();
      const profile = profileById.get(profileId);
      if (!profileId || !profile) {
        mismatches.push(`${voice.id}:${voice.geminiVoiceName}:missing-profile`);
        continue;
      }

      const frontendGender = String(voice.gender || '').trim().toLowerCase();
      const profileGender = String(profile.gender || '').trim().toLowerCase();
      if (!frontendGender || !profileGender || frontendGender !== profileGender) {
        mismatches.push(`${voice.id}:${voice.geminiVoiceName}:${frontendGender}->${profileGender}`);
      }
    }

    expect(mismatches).toEqual([]);
  });

  it('keeps the vector multi demo manifest aligned with the canonical voice catalog', () => {
    const mismatches: string[] = [];
    const demos = Array.isArray(vectorMultiManifest?.demos) ? vectorMultiManifest.demos : [];

    for (const demo of demos) {
      if (!demo || typeof demo !== 'object') continue;
      const demoId = String((demo as { id?: unknown }).id || '').trim() || 'unknown-demo';
      const entries = [
        ...((Array.isArray((demo as { cast?: unknown }).cast) ? (demo as { cast: unknown[] }).cast : []) || []),
        ...((Array.isArray((demo as { lines?: unknown }).lines) ? (demo as { lines: unknown[] }).lines : []) || []),
      ];

      for (const entry of entries) {
        if (!entry || typeof entry !== 'object') continue;
        const voiceId = String((entry as { voiceId?: unknown }).voiceId || '').trim().toLowerCase();
        const displayName = String((entry as { displayName?: unknown }).displayName || '').trim();
        const voiceGender = String((entry as { voiceGender?: unknown }).voiceGender || '').trim().toLowerCase();
        const voice = voiceByGeminiName.get(voiceId);

        if (!voice) {
          mismatches.push(`${demoId}:${voiceId}:missing-voice`);
          continue;
        }

        const expectedGender = String(voice.gender || '').trim().toLowerCase();
        if (!voiceGender || voiceGender !== expectedGender) {
          mismatches.push(`${demoId}:${voiceId}:gender:${voiceGender}->${expectedGender}`);
        }
        if (displayName !== String(voice.name || '').trim()) {
          mismatches.push(`${demoId}:${voiceId}:label:${displayName}->${String(voice.name || '').trim()}`);
        }
      }
    }

    expect(mismatches).toEqual([]);
  });
});
