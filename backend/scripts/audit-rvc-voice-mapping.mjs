#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const BACKEND_ROOT = path.resolve(__dirname, '..');

const DEFAULT_BASE_URL = String(process.env.VF_MEDIA_BACKEND_URL || 'http://127.0.0.1:7800').replace(/\/+$/, '');
const DEFAULT_UID = String(process.env.VF_LIVE_AUDIT_UID || 'local_admin').trim() || 'local_admin';
const DEFAULT_TIMEOUT_MS = 20000;
const DEFAULT_FIX = true;

const PROFILE_BANK_PATH = path.join(BACKEND_ROOT, 'config', 'voice_profile_bank.v1.json');
const VOICE_MAP_PATH = path.join(BACKEND_ROOT, 'config', 'voice_id_map.v1.json');
const ARTIFACT_PATH = path.join(BACKEND_ROOT, 'artifacts', 'load', 'rvc_voice_mapping_audit.json');

const KOKORO_CANONICAL_PROFILE_MAP = Object.freeze({
  af_heart: 'p02_india_f_adult',
  af_bella: 'p04_us_f_adult',
  af_nova: 'p06_uk_f_adult',
  af_sarah: 'p08_canada_f_adult',
  am_fenrir: 'p01_india_m_adult',
  am_michael: 'p03_us_m_adult',
  am_onyx: 'p05_uk_m_adult',
  am_echo: 'p07_canada_m_adult',
  bf_emma: 'p10_au_f_adult',
  bf_isabella: 'p12_jp_f_adult',
  bm_george: 'p09_au_m_adult',
  bm_fable: 'p11_jp_m_adult',
  hf_alpha: 'p02_india_f_adult',
  hf_beta: 'p28_ae_f_adult',
  hm_omega: 'p27_ae_m_adult',
  hm_psi: 'p19_india_old_man',
});

const GEM_DESIGNATED = Object.freeze({
  v17: { ageGroup: 'Child', gender: 'Male' },
  v18: { ageGroup: 'Child', gender: 'Female' },
  v19: { ageGroup: 'Elderly', gender: 'Male' },
  v20: { ageGroup: 'Elderly', gender: 'Female' },
});

const KOKORO_DESIGNATED = Object.freeze({
  hm_psi: { ageGroup: 'Elderly', gender: 'Male' },
});

const parseArgs = (argv) => {
  const out = new Map();
  for (let i = 0; i < argv.length; i += 1) {
    const token = String(argv[i] || '').trim();
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (!next || String(next).startsWith('--')) {
      out.set(key, '1');
      continue;
    }
    out.set(key, String(next));
    i += 1;
  }
  return out;
};

const parseBool = (value, fallback = false) => {
  if (value === undefined || value === null) return fallback;
  const token = String(value).trim().toLowerCase();
  if (!token) return fallback;
  if (['1', 'true', 'yes', 'on'].includes(token)) return true;
  if (['0', 'false', 'no', 'off'].includes(token)) return false;
  return fallback;
};

const parseIntSafe = (value, fallback, min = 1) => {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, parsed);
};

const args = parseArgs(process.argv.slice(2));
const CONFIG = {
  baseUrl: String(args.get('base-url') || process.env.VF_MEDIA_BACKEND_URL || DEFAULT_BASE_URL).replace(/\/+$/, ''),
  uid: String(args.get('uid') || process.env.VF_LIVE_AUDIT_UID || DEFAULT_UID).trim() || DEFAULT_UID,
  timeoutMs: parseIntSafe(args.get('timeout-ms') || process.env.VF_RVC_MAPPING_AUDIT_TIMEOUT_MS, DEFAULT_TIMEOUT_MS, 1000),
  fix: parseBool(args.get('fix') ?? process.env.VF_RVC_MAPPING_AUDIT_FIX, DEFAULT_FIX),
};

const normalizeGender = (value) => {
  const token = String(value || '').trim().toLowerCase();
  if (!token) return 'unknown';
  if (token.includes('female')) return 'female';
  if (token.includes('male')) return 'male';
  return 'unknown';
};

const normalizeAgeGroup = (value) => {
  const token = String(value || '').trim().toLowerCase();
  if (!token) return 'unknown';
  if (token.includes('elder')) return 'elderly';
  if (token.includes('child')) return 'child';
  if (token.includes('adult')) return 'adult';
  return token;
};

const expectedKokoroGender = (voiceId, runtimeGender) => {
  const id = String(voiceId || '').trim().toLowerCase();
  if (id.startsWith('af_') || id.startsWith('bf_') || id.startsWith('hf_')) return 'female';
  if (id.startsWith('am_') || id.startsWith('bm_') || id.startsWith('hm_')) return 'male';
  return normalizeGender(runtimeGender);
};

const withTimeout = async (url, init, timeoutMs) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
};

const fetchVoices = async (engine) => {
  const url = `${CONFIG.baseUrl}/tts/engines/voices?engine=${encodeURIComponent(engine)}`;
  const response = await withTimeout(
    url,
    {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'x-dev-uid': CONFIG.uid,
      },
    },
    CONFIG.timeoutMs,
  );
  const text = await response.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = text;
  }
  if (!response.ok) {
    throw new Error(`fetch ${engine} voices failed (${response.status}): ${typeof payload === 'string' ? payload : JSON.stringify(payload)}`);
  }
  const voices = Array.isArray(payload?.voices) ? payload.voices : [];
  return voices.filter((item) => item && typeof item === 'object');
};

const readJsonFile = async (filePath) => {
  const raw = await fs.readFile(filePath, 'utf8');
  const cleaned = raw.replace(/^\uFEFF/, '');
  return JSON.parse(cleaned);
};

const profileIdIndex = (profiles) => {
  const out = new Map();
  for (const profile of profiles || []) {
    const profileId = String(profile?.profileId || '').trim();
    if (!profileId) continue;
    out.set(profileId, profile);
  }
  return out;
};

const canonicalGemMap = (profiles, runtimeVoices) => {
  const profileByNumeric = new Map();
  for (const profile of profiles || []) {
    const profileId = String(profile?.profileId || '').trim();
    const match = /^p(\d{1,3})_/i.exec(profileId);
    if (!match) continue;
    profileByNumeric.set(Number(match[1]), profileId);
  }
  const out = {};
  for (const voice of runtimeVoices || []) {
    const voiceId = String(voice?.voice_id || '').trim();
    const match = /^v(\d{1,3})$/i.exec(voiceId);
    if (!match) continue;
    const profileId = profileByNumeric.get(Number(match[1]));
    if (profileId) out[voiceId] = profileId;
  }
  return out;
};

const mappingCandidates = (voiceToProfile, voiceId, voiceName) => {
  const candidates = new Set();
  const keys = [voiceId, voiceName, String(voiceId || '').toLowerCase(), String(voiceName || '').toLowerCase()]
    .map((key) => String(key || '').trim())
    .filter(Boolean);
  for (const key of keys) {
    const value = String(voiceToProfile?.[key] || '').trim();
    if (value) candidates.add(value);
  }
  return Array.from(candidates);
};

const setMapping = (voiceToProfile, voiceId, voiceName, profileId) => {
  const safeProfile = String(profileId || '').trim();
  if (!safeProfile) return false;
  const safeVoiceId = String(voiceId || '').trim();
  const safeVoiceName = String(voiceName || '').trim();
  let changed = false;
  if (safeVoiceId && voiceToProfile[safeVoiceId] !== safeProfile) {
    voiceToProfile[safeVoiceId] = safeProfile;
    changed = true;
  }
  if (safeVoiceName && voiceToProfile[safeVoiceName] !== safeProfile) {
    voiceToProfile[safeVoiceName] = safeProfile;
    changed = true;
  }
  return changed;
};

const recordIssue = (target, issue) => {
  target.push({
    engine: String(issue.engine || ''),
    voiceId: String(issue.voiceId || ''),
    voiceName: String(issue.voiceName || ''),
    issue: String(issue.issue || ''),
    expected: String(issue.expected || ''),
    actual: String(issue.actual || ''),
    profileId: String(issue.profileId || ''),
  });
};

const auditEngine = ({
  engine,
  runtimeVoices,
  voiceToProfile,
  profilesById,
  expectedGender,
  canonicalProfiles,
  designatedMap,
  applyFix,
  fixLog,
  issues,
  warnings,
}) => {
  for (const voice of runtimeVoices) {
    const voiceId = String(voice?.voice_id || voice?.id || '').trim();
    if (!voiceId) continue;
    const voiceName = String(voice?.voice || voice?.name || '').trim();
    const runtimeGender = normalizeGender(voice?.gender);
    const wantedGender = expectedGender(voiceId, runtimeGender);
    const wantedCanonical = String(canonicalProfiles?.[voiceId] || '').trim();

    const applyCanonicalFixIfNeeded = (reason) => {
      if (!applyFix || !wantedCanonical || !profilesById.has(wantedCanonical)) return false;
      const changed = setMapping(voiceToProfile, voiceId, voiceName, wantedCanonical);
      if (changed) {
        fixLog.push({
          engine,
          voiceId,
          voiceName,
          reason,
          profileId: wantedCanonical,
        });
      }
      return changed;
    };

    let candidates = mappingCandidates(voiceToProfile, voiceId, voiceName);
    if (candidates.length === 0) {
      applyCanonicalFixIfNeeded('missing_mapping');
      candidates = mappingCandidates(voiceToProfile, voiceId, voiceName);
    }
    if (candidates.length === 0) {
      recordIssue(issues, { engine, voiceId, voiceName, issue: 'missing_mapping' });
      continue;
    }

    if (candidates.length > 1) {
      if (applyCanonicalFixIfNeeded('ambiguous_mapping')) {
        candidates = mappingCandidates(voiceToProfile, voiceId, voiceName);
      }
    }
    if (candidates.length > 1) {
      recordIssue(issues, {
        engine,
        voiceId,
        voiceName,
        issue: 'ambiguous_mapping',
        actual: candidates.join(','),
      });
      continue;
    }

    let profileId = String(candidates[0] || '').trim();
    let profile = profilesById.get(profileId);
    if (!profile) {
      if (applyCanonicalFixIfNeeded('missing_profile')) {
        candidates = mappingCandidates(voiceToProfile, voiceId, voiceName);
        profileId = String(candidates[0] || '').trim();
        profile = profilesById.get(profileId);
      }
    }
    if (!profile) {
      recordIssue(issues, {
        engine,
        voiceId,
        voiceName,
        issue: 'missing_profile',
        profileId,
      });
      continue;
    }

    const mappedGender = normalizeGender(profile?.gender);
    if (wantedGender !== 'unknown' && mappedGender !== 'unknown' && wantedGender !== mappedGender) {
      const fixed = applyCanonicalFixIfNeeded('gender_mismatch');
      if (fixed) {
        candidates = mappingCandidates(voiceToProfile, voiceId, voiceName);
        profileId = String(candidates[0] || '').trim();
        profile = profilesById.get(profileId);
      }
      const finalGender = normalizeGender(profile?.gender);
      if (wantedGender !== 'unknown' && finalGender !== 'unknown' && wantedGender !== finalGender) {
        recordIssue(issues, {
          engine,
          voiceId,
          voiceName,
          issue: 'gender_mismatch',
          expected: wantedGender,
          actual: finalGender,
          profileId,
        });
      }
    }

    const designated = designatedMap?.[voiceId];
    if (designated && profile) {
      const expectedAge = normalizeAgeGroup(designated.ageGroup);
      const expectedGen = normalizeGender(designated.gender);
      const actualAge = normalizeAgeGroup(profile?.ageGroup);
      const actualGen = normalizeGender(profile?.gender);
      if (expectedAge !== 'unknown' && actualAge !== 'unknown' && expectedAge !== actualAge) {
        recordIssue(issues, {
          engine,
          voiceId,
          voiceName,
          issue: 'age_group_mismatch',
          expected: expectedAge,
          actual: actualAge,
          profileId,
        });
      }
      if (expectedGen !== 'unknown' && actualGen !== 'unknown' && expectedGen !== actualGen) {
        recordIssue(issues, {
          engine,
          voiceId,
          voiceName,
          issue: 'designated_gender_mismatch',
          expected: expectedGen,
          actual: actualGen,
          profileId,
        });
      }
    }

    if (wantedGender === 'unknown') {
      warnings.push({
        engine,
        voiceId,
        voiceName,
        issue: 'runtime_gender_unknown',
      });
    }
  }
};

const countByEngine = (entries) => {
  const out = { GEM: 0, KOKORO: 0 };
  for (const item of entries || []) {
    const engine = String(item?.engine || '').toUpperCase();
    if (engine === 'GEM' || engine === 'KOKORO') out[engine] += 1;
  }
  return out;
};

const main = async () => {
  const generatedAt = new Date().toISOString();
  const profileRaw = await readJsonFile(PROFILE_BANK_PATH);
  const mapRaw = await readJsonFile(VOICE_MAP_PATH);

  const profiles = Array.isArray(profileRaw?.profiles) ? profileRaw.profiles : [];
  const profilesById = profileIdIndex(profiles);
  const engines = mapRaw?.engines && typeof mapRaw.engines === 'object' ? mapRaw.engines : {};
  const gemSource = engines.GEM && typeof engines.GEM === 'object' ? engines.GEM : {};
  const kokoroSource = engines.KOKORO && typeof engines.KOKORO === 'object' ? engines.KOKORO : {};
  const gemVoiceToProfile = gemSource.voiceToProfile && typeof gemSource.voiceToProfile === 'object' ? gemSource.voiceToProfile : {};
  const kokoroVoiceToProfile = kokoroSource.voiceToProfile && typeof kokoroSource.voiceToProfile === 'object' ? kokoroSource.voiceToProfile : {};
  const fetchedGemVoices = await fetchVoices('GEM');
  const fetchedKokoroVoices = await fetchVoices('KOKORO');
  const gemRuntimeFromMap = Array.isArray(gemSource.runtimeVoices) ? gemSource.runtimeVoices : [];
  const runtimeGemVoices =
    fetchedGemVoices.length >= 5
      ? fetchedGemVoices
      : gemRuntimeFromMap;
  const runtimeKokoroVoices = fetchedKokoroVoices;

  const gemCanonical = canonicalGemMap(profiles, runtimeGemVoices);
  const issues = [];
  const warnings = [];
  const staticWarnings = [];
  const fixedEntries = [];
  if (fetchedGemVoices.length < 5 && runtimeGemVoices.length > 0) {
    staticWarnings.push({
      engine: 'GEM',
      voiceId: '',
      voiceName: '',
      issue: 'gem_endpoint_catalog_small_using_voice_map_runtime_voices',
    });
  }

  auditEngine({
    engine: 'GEM',
    runtimeVoices: runtimeGemVoices,
    voiceToProfile: gemVoiceToProfile,
    profilesById,
    expectedGender: (_voiceId, runtimeGender) => normalizeGender(runtimeGender),
    canonicalProfiles: gemCanonical,
    designatedMap: GEM_DESIGNATED,
    applyFix: CONFIG.fix,
    fixLog: fixedEntries,
    issues,
    warnings,
  });

  auditEngine({
    engine: 'KOKORO',
    runtimeVoices: runtimeKokoroVoices,
    voiceToProfile: kokoroVoiceToProfile,
    profilesById,
    expectedGender: (voiceId, runtimeGender) => expectedKokoroGender(voiceId, runtimeGender),
    canonicalProfiles: KOKORO_CANONICAL_PROFILE_MAP,
    designatedMap: KOKORO_DESIGNATED,
    applyFix: CONFIG.fix,
    fixLog: fixedEntries,
    issues,
    warnings,
  });

  const seenFixedKeys = new Set();
  const dedupFixedEntries = [];
  for (const item of fixedEntries) {
    const key = `${item.engine}:${item.voiceId}:${item.profileId}:${item.reason}`;
    if (seenFixedKeys.has(key)) continue;
    seenFixedKeys.add(key);
    dedupFixedEntries.push(item);
  }

  let fileUpdated = false;
  if (CONFIG.fix && dedupFixedEntries.length > 0) {
    await fs.writeFile(VOICE_MAP_PATH, JSON.stringify(mapRaw, null, 2), 'utf8');
    fileUpdated = true;
  }

  const postFixIssues = [];
  const postFixWarnings = [];
  auditEngine({
    engine: 'GEM',
    runtimeVoices: runtimeGemVoices,
    voiceToProfile: gemVoiceToProfile,
    profilesById,
    expectedGender: (_voiceId, runtimeGender) => normalizeGender(runtimeGender),
    canonicalProfiles: gemCanonical,
    designatedMap: GEM_DESIGNATED,
    applyFix: false,
    fixLog: [],
    issues: postFixIssues,
    warnings: postFixWarnings,
  });
  auditEngine({
    engine: 'KOKORO',
    runtimeVoices: runtimeKokoroVoices,
    voiceToProfile: kokoroVoiceToProfile,
    profilesById,
    expectedGender: (voiceId, runtimeGender) => expectedKokoroGender(voiceId, runtimeGender),
    canonicalProfiles: KOKORO_CANONICAL_PROFILE_MAP,
    designatedMap: KOKORO_DESIGNATED,
    applyFix: false,
    fixLog: [],
    issues: postFixIssues,
    warnings: postFixWarnings,
  });

  const finalWarnings = [...staticWarnings, ...postFixWarnings];

  const report = {
    schemaVersion: '1.0.0',
    generatedAt,
    target: {
      baseUrl: CONFIG.baseUrl,
      uid: CONFIG.uid,
      fixMode: CONFIG.fix,
    },
    files: {
      profileBank: PROFILE_BANK_PATH,
      voiceMap: VOICE_MAP_PATH,
      artifact: ARTIFACT_PATH,
    },
    runtimeVoiceCounts: {
      GEM: runtimeGemVoices.length,
      KOKORO: runtimeKokoroVoices.length,
    },
    endpointRuntimeVoiceCounts: {
      GEM: fetchedGemVoices.length,
      KOKORO: fetchedKokoroVoices.length,
    },
    profileCount: profilesById.size,
    fixSummary: {
      fileUpdated,
      fixedEntries: dedupFixedEntries,
      fixedByEngine: countByEngine(dedupFixedEntries),
    },
    issues: postFixIssues,
    warnings: finalWarnings,
    totals: {
      issues: postFixIssues.length,
      warnings: finalWarnings.length,
      pass: postFixIssues.length === 0,
    },
    verdict: {
      passed: postFixIssues.length === 0,
      reasons: postFixIssues.map((item) => `${item.engine}:${item.voiceId}:${item.issue}`),
    },
  };

  await fs.mkdir(path.dirname(ARTIFACT_PATH), { recursive: true });
  await fs.writeFile(ARTIFACT_PATH, JSON.stringify(report, null, 2), 'utf8');

  const summary =
    `[audit:rvc:mapping] gemVoices=${runtimeGemVoices.length} kokoroVoices=${runtimeKokoroVoices.length} ` +
    `issues=${postFixIssues.length} fixed=${dedupFixedEntries.length} verdict=${report.verdict.passed ? 'passed' : 'failed'}`;
  console.log(summary);
  console.log(`artifact=${ARTIFACT_PATH.replace(/\\/g, '/')}`);
  if (postFixIssues.length > 0) {
    for (const item of postFixIssues.slice(0, 20)) {
      console.error(
        `[audit:rvc:mapping][FAIL] ${item.engine}:${item.voiceId} ${item.issue}` +
        `${item.expected ? ` expected=${item.expected}` : ''}` +
        `${item.actual ? ` actual=${item.actual}` : ''}` +
        `${item.profileId ? ` profile=${item.profileId}` : ''}`,
      );
    }
    process.exitCode = 1;
  }
};

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
