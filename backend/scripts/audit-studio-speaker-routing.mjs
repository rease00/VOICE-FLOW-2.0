#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const workspaceRoot = path.resolve(root, '..');

const readJson = (relativePath) => {
  const filePath = path.resolve(root, relativePath);
  const raw = fs.readFileSync(filePath, 'utf8');
  return JSON.parse(raw.replace(/^\uFEFF/, ''));
};

const readJsonOptional = (relativePath) => {
  try {
    return readJson(relativePath);
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
};

const existsFile = (relativePathFromWorkspace) => {
  const candidates = [
    path.resolve(workspaceRoot, relativePathFromWorkspace),
    path.resolve(root, relativePathFromWorkspace),
  ];
  for (const absolute of candidates) {
    try {
      if (fs.statSync(absolute).isFile()) return true;
    } catch {
      // continue
    }
  }
  return false;
};

const now = new Date();
const ts = now.toISOString().replace(/[:.]/g, '-');

const voiceMap = readJson('./config/voice_id_map.v1.json');
const profileBank = readJson('./config/voice_profile_bank.v1.json');
const llvcRegistry = readJsonOptional('./config/voice_transfer_model_registry.json');

const runtimeVoices = Array.isArray(voiceMap?.engines?.PRIME?.runtimeVoices)
  ? voiceMap.engines.PRIME.runtimeVoices
  : [];
const voiceToProfile = (voiceMap?.engines?.PRIME?.voiceToProfile && typeof voiceMap.engines.PRIME.voiceToProfile === 'object')
  ? voiceMap.engines.PRIME.voiceToProfile
  : {};
const profiles = Array.isArray(profileBank?.profiles) ? profileBank.profiles : [];
const profileById = new Map(profiles.map((p) => [String(p?.profileId || ''), p]));

const registryModels = new Set(
  (Array.isArray(llvcRegistry?.models) ? llvcRegistry.models : [])
    .filter((m) => m && m.enabled !== false)
    .map((m) => String(m.id || '').trim())
    .filter(Boolean),
);

const issues = [];
const checks = [];

for (const row of runtimeVoices) {
  const voiceId = String(row?.voice_id || row?.id || '').trim();
  const runtimeVoiceName = String(row?.voice || row?.runtimeVoice || '').trim();
  const declaredGender = String(row?.gender || '').trim().toLowerCase();
  if (!voiceId) {
    issues.push({ severity: 'error', code: 'voice_missing_id', detail: 'Runtime voice missing id.' });
    continue;
  }

  const mappedProfileId = String(
    voiceToProfile[voiceId]
      || voiceToProfile[voiceId.toLowerCase()]
      || voiceToProfile[runtimeVoiceName]
      || voiceToProfile[runtimeVoiceName.toLowerCase()]
      || '',
  ).trim();

  if (!mappedProfileId) {
    issues.push({
      severity: 'error',
      code: 'profile_mapping_missing',
      voiceId,
      runtimeVoiceName,
      detail: 'No voiceToProfile mapping found for runtime voice.',
    });
    continue;
  }

  const profile = profileById.get(mappedProfileId);
  if (!profile) {
    issues.push({
      severity: 'error',
      code: 'profile_missing',
      voiceId,
      runtimeVoiceName,
      profileId: mappedProfileId,
      detail: 'Mapped profile id not present in voice profile bank.',
    });
    continue;
  }

  const profileGender = String(profile?.gender || '').trim().toLowerCase();
  if (declaredGender && profileGender && declaredGender !== profileGender) {
    issues.push({
      severity: 'warn',
      code: 'gender_mismatch',
      voiceId,
      runtimeVoiceName,
      profileId: mappedProfileId,
      declaredGender,
      profileGender,
    });
  }

  const referencePath = String(profile?.referencePath || '').trim();
  if (!referencePath || !existsFile(referencePath)) {
    issues.push({
      severity: 'warn',
      code: 'reference_audio_missing',
      voiceId,
      runtimeVoiceName,
      profileId: mappedProfileId,
      referencePath,
    });
  }

  const llvcModelName = String(profile?.llvcModelName || '').trim();
  if (!llvcModelName || !registryModels.has(llvcModelName)) {
    issues.push({
      severity: 'warn',
      code: 'llvc_model_unavailable',
      voiceId,
      runtimeVoiceName,
      profileId: mappedProfileId,
      llvcModelName,
    });
  }

  checks.push({
    voiceId,
    runtimeVoiceName,
    profileId: mappedProfileId,
    gender: profileGender || 'unknown',
    referencePath,
    llvcModelName: String(profile?.llvcModelName || '').trim(),
  });
}

const freeAllowlist = {
  PRIME: ['v2', 'v4', 'v6', 'v8', 'v10', 'v1', 'v3', 'v5', 'v7', 'v9'],
  VECTOR: ['v2', 'v4', 'v6', 'v8', 'v10', 'v1', 'v3', 'v5', 'v7', 'v9'],
  DUNO: ['deepinfra_default'],
};

for (const [engine, ids] of Object.entries(freeAllowlist)) {
  const minimumVoices = engine === 'DUNO' ? 1 : 10;
  if (ids.length < minimumVoices) {
    issues.push({
      severity: 'error',
      code: 'free_allowlist_size_invalid',
      engine,
      size: ids.length,
      detail: `Free tier allowlist must contain at least ${minimumVoices} speaker${minimumVoices === 1 ? '' : 's'}.`,
    });
  }
}

const summary = {
  checkedAt: now.toISOString(),
  runtimeVoiceCount: runtimeVoices.length,
  profileCount: profiles.length,
  llvcRegistryModelCount: registryModels.size,
  issueCount: issues.length,
  errors: issues.filter((i) => i.severity === 'error').length,
  warnings: issues.filter((i) => i.severity === 'warn').length,
};

const payload = {
  ok: summary.errors === 0,
  summary,
  freeAllowlist,
  checks,
  issues,
};

const outDir = path.resolve(workspaceRoot, 'output', 'audits');
fs.mkdirSync(outDir, { recursive: true });
const outPath = path.resolve(outDir, `studio-speaker-deep-audit-${ts}.json`);
fs.writeFileSync(outPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');

console.log(JSON.stringify({
  ok: payload.ok,
  output: outPath,
  summary,
}, null, 2));
