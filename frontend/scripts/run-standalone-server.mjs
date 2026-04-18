import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { ensureLoopbackPortAvailable, resolveGuardPort } from './frontend-startup-guard.mjs';
import { createRuntimeEnv } from './load-runtime-env.mjs';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(scriptDir, '..');
const configuredDistDir = String(process.env.NEXT_DIST_DIR || '').trim();
const distDir = configuredDistDir || '.next';
const buildIdPath = path.join(rootDir, distDir, 'BUILD_ID');
const customServerScript = path.join(rootDir, 'scripts', 'custom-next-server.ts');
const runtimeEnv = createRuntimeEnv(process.env, rootDir);

if (!fs.existsSync(buildIdPath)) {
  console.error(`[standalone-runtime] Missing ${distDir}/BUILD_ID. Run \`npm run build\` first.`);
  process.exit(1);
}

const startup = async () => {
  const port = resolveGuardPort([], 3000);
  await ensureLoopbackPortAvailable('standalone runtime', port);

  const entrypoint = {
    command: process.execPath,
    args: ['--experimental-strip-types', customServerScript],
  };

  const child = spawn(entrypoint.command, entrypoint.args, {
    cwd: rootDir,
    env: { ...runtimeEnv, PORT: String(port) },
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
