import { cp, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const frontendRoot = path.resolve(scriptDir, '..');
const repoRoot = path.resolve(frontendRoot, '..');
const clientBuildRoot = path.join(frontendRoot, 'build', 'client');
const snapshotRoot = path.join(clientBuildRoot, '__snapshots');

const snapshotPageEntries = [
  'app',
  'billing',
  'landing',
  'legal',
  'index.html',
];

const rootAssetEntries = [
  '_next',
  'audio',
  'icon.svg',
  'manifest.json',
  'manifest.webmanifest',
  'og-landing.png',
];

await mkdir(clientBuildRoot, { recursive: true });
await rm(snapshotRoot, { recursive: true, force: true });
await mkdir(snapshotRoot, { recursive: true });

for (const entry of snapshotPageEntries) {
  await cp(path.join(repoRoot, entry), path.join(snapshotRoot, entry), {
    recursive: true,
    force: true,
  });
}

for (const entry of rootAssetEntries) {
  await rm(path.join(clientBuildRoot, entry), { recursive: true, force: true });
  await cp(path.join(repoRoot, entry), path.join(clientBuildRoot, entry), {
    recursive: true,
    force: true,
  });
}

await cp(path.join(repoRoot, 'assets'), path.join(clientBuildRoot, 'assets'), {
  recursive: true,
  force: true,
});

await cp(path.join(repoRoot, 'assets'), path.join(snapshotRoot, 'assets'), {
  recursive: true,
  force: true,
});

await cp(path.join(repoRoot, '_next'), path.join(snapshotRoot, '_next'), {
  recursive: true,
  force: true,
});

await cp(path.join(repoRoot, 'audio'), path.join(snapshotRoot, 'audio'), {
  recursive: true,
  force: true,
});

for (const entry of ['icon.svg', 'manifest.json', 'manifest.webmanifest', 'og-landing.png']) {
  await cp(path.join(repoRoot, entry), path.join(snapshotRoot, entry), {
    recursive: true,
    force: true,
  });
}
