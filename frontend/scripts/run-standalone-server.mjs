import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import { spawn } from 'node:child_process';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(scriptDir, '..');
const configuredDistDir = String(process.env.NEXT_DIST_DIR || '').trim();
const distDir = configuredDistDir || '.next';
const serverPath = path.join(rootDir, distDir, 'standalone', 'server.js');

if (!fs.existsSync(serverPath)) {
  console.error(`[standalone-runtime] Missing ${distDir}/standalone/server.js. Run \`npm run build\` first.`);
  process.exit(1);
}

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
