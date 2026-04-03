import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { ensureLoopbackPortAvailable, resolveGuardPort } from './frontend-startup-guard.mjs';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(scriptDir, '..');
const configuredDistDir = String(process.env.NEXT_DIST_DIR || '').trim();
const distDir = configuredDistDir || '.next';
const serverPath = path.join(rootDir, distDir, 'standalone', 'server.js');

if (!fs.existsSync(serverPath)) {
  console.error(`[standalone-runtime] Missing ${distDir}/standalone/server.js. Run \`npm run build\` first.`);
  process.exit(1);
}

const startup = async () => {
  const port = resolveGuardPort([], 3000);
  await ensureLoopbackPortAvailable('standalone runtime', port);

  const child = spawn(process.execPath, [serverPath], {
    cwd: rootDir,
    env: process.env,
    stdio: 'inherit',
  });

  child.on('exit', (code, signal) => {
    if (signal) {
      process.exit(1);
      return;
    }
    process.exit(code ?? 0);
  });
};

startup().catch((error) => {
  const detail = error instanceof Error ? error.message : String(error);
  console.error(detail);
  process.exit(1);
});
