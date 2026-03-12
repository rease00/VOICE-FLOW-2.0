#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';

const ROOT = process.cwd();
const DIST_DIR = path.join(ROOT, 'dist');
const KEEP_BUNDLED_AUDIO = ['1', 'true', 'yes', 'on'].includes(String(process.env.VF_KEEP_BUNDLED_AUDIO || '').trim().toLowerCase());

const main = async () => {
  if (KEEP_BUNDLED_AUDIO) {
    console.log('[prune:audio] keeping bundled audio assets.');
    return;
  }

  const targets = [
    path.join(DIST_DIR, 'assets', 'audio', 'music'),
    path.join(DIST_DIR, 'assets', 'audio', 'sfx', 'light_rain.mp3'),
  ];

  await Promise.all(targets.map(async (target) => {
    await fs.rm(target, { recursive: true, force: true }).catch(() => undefined);
  }));

  console.log('[prune:audio] removed bundled music catalog and oversized ambient SFX from dist.');
};

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
