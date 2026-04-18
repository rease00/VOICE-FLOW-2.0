import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(scriptDir, '..');
const configuredDistDir = String(process.env.NEXT_DIST_DIR || '').trim();
const distDir = configuredDistDir || '.next';
const nextDir = path.join(rootDir, distDir);
const standaloneDir = path.join(nextDir, 'standalone');
const standaloneNextDir = path.join(standaloneDir, '.next');
const standaloneDistDir = path.join(standaloneDir, distDir);
const staticSourceDir = path.join(nextDir, 'static');
const staticTargetDir = path.join(standaloneNextDir, 'static');
const standaloneDistStaticDir = path.join(standaloneDistDir, 'static');
const publicSourceDir = path.join(rootDir, 'public');
const publicTargetDir = path.join(standaloneDir, 'public');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const copyTreeWithRetry = async (sourceDir, targetDir, label) => {
  const maxAttempts = 4;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      fs.cpSync(sourceDir, targetDir, { recursive: true, force: true });
      return;
    } catch (error) {
      const code = error && typeof error === 'object' && 'code' in error ? String(error.code || '') : '';
      const retryable = code === 'EPIPE' || code === 'EBUSY' || code === 'EPERM';
      if (!retryable || attempt === maxAttempts) {
        throw error;
      }
      console.warn(`[standalone-runtime] retrying ${label} copy (${attempt}/${maxAttempts}) after ${code || 'copy error'}.`);
      await sleep(attempt * 250);
    }
  }
};

if (!fs.existsSync(standaloneDir)) {
  console.error(`[standalone-runtime] Missing ${distDir}/standalone. Run \`npm run build\` first.`);
  process.exit(1);
}

fs.mkdirSync(standaloneNextDir, { recursive: true });
fs.mkdirSync(standaloneDistDir, { recursive: true });

if (fs.existsSync(staticSourceDir)) {
  await copyTreeWithRetry(staticSourceDir, staticTargetDir, 'Next static assets');
  // Next's standalone runtime for a custom distDir still resolves the static tree
  // under the distDir mirror inside `standalone/`, so keep that copy in sync too.
  await copyTreeWithRetry(staticSourceDir, standaloneDistStaticDir, 'mirrored Next static assets');
}

if (fs.existsSync(publicSourceDir)) {
  await copyTreeWithRetry(publicSourceDir, publicTargetDir, 'public assets');
}
