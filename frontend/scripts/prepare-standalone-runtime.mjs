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

if (!fs.existsSync(standaloneDir)) {
  console.error(`[standalone-runtime] Missing ${distDir}/standalone. Run \`npm run build\` first.`);
  process.exit(1);
}

fs.mkdirSync(standaloneNextDir, { recursive: true });
fs.mkdirSync(standaloneDistDir, { recursive: true });

if (fs.existsSync(staticSourceDir)) {
  fs.cpSync(staticSourceDir, staticTargetDir, { recursive: true, force: true });
  // Next's standalone runtime for a custom distDir still resolves the static tree
  // under the distDir mirror inside `standalone/`, so keep that copy in sync too.
  fs.cpSync(staticSourceDir, standaloneDistStaticDir, { recursive: true, force: true });
}

if (fs.existsSync(publicSourceDir)) {
  fs.cpSync(publicSourceDir, publicTargetDir, { recursive: true, force: true });
}
