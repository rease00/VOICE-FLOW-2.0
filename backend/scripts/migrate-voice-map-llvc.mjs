#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(__filename), '..');
const BANK_PATH = path.join(ROOT, 'config', 'voice_profile_bank.v1.json');
const MAP_PATH = path.join(ROOT, 'config', 'voice_id_map.v1.json');

async function migrateProfileBank() {
  const raw = await fs.readFile(BANK_PATH, 'utf8');
  const payload = JSON.parse(raw.replace(/^\uFEFF/, ''));
  if (!payload || typeof payload !== 'object' || !Array.isArray(payload.profiles)) {
    throw new Error('voice_profile_bank.v1.json has unexpected schema.');
  }
  let changed = 0;
  for (const profile of payload.profiles) {
    if (!profile || typeof profile !== 'object') continue;
    const oldValue = String(profile.rvcModelName || '').trim();
    const hasNew = typeof profile.llvcModelName === 'string' && profile.llvcModelName.trim();
    if (!hasNew && oldValue) {
      profile.llvcModelName = oldValue;
      changed += 1;
    }
    delete profile.rvcModelName;
  }
  await fs.writeFile(BANK_PATH, JSON.stringify(payload, null, 2) + '\n', 'utf8');
  return changed;
}

async function migrateVoiceIdMap() {
  const raw = await fs.readFile(MAP_PATH, 'utf8');
  const payload = JSON.parse(raw.replace(/^\uFEFF/, ''));
  let changed = 0;

  const visit = (node) => {
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    if (!node || typeof node !== 'object') return;

    const oldValue = String(node.rvcModelName || '').trim();
    const hasNew = typeof node.llvcModelName === 'string' && node.llvcModelName.trim();
    if (!hasNew && oldValue) {
      node.llvcModelName = oldValue;
      changed += 1;
    }
    if ('rvcModelName' in node) {
      delete node.rvcModelName;
      changed += 1;
    }

    for (const value of Object.values(node)) visit(value);
  };

  visit(payload);
  await fs.writeFile(MAP_PATH, JSON.stringify(payload, null, 2) + '\n', 'utf8');
  return changed;
}

async function main() {
  const bankChanged = await migrateProfileBank();
  const mapChanged = await migrateVoiceIdMap();
  console.log(`[migrate:llvc] profileBankUpdated=${bankChanged} voiceIdMapUpdated=${mapChanged}`);
}

main().catch((error) => {
  console.error(`[migrate:llvc] failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
