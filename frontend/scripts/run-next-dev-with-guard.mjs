import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { ensureLoopbackPortAvailable, resolveGuardPort } from './frontend-startup-guard.mjs';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const frontendRoot = path.resolve(scriptDir, '..');
const nextBin = path.join(frontendRoot, 'node_modules', 'next', 'dist', 'bin', 'next');
const devArgs = process.argv.slice(2);

const start = async () => {
  const port = resolveGuardPort(devArgs, 3000);
  await ensureLoopbackPortAvailable('next dev', port);

  const child = spawn(process.execPath, [nextBin, 'dev', ...devArgs], {
    cwd: frontendRoot,
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

start().catch((error) => {
  const detail = error instanceof Error ? error.message : String(error);
  console.error(detail);
  process.exit(1);
});

