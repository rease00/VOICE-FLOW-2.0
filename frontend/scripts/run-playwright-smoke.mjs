import { spawnSync } from 'node:child_process';
import path from 'node:path';

const profile = process.argv[2] === 'full' ? 'full' : 'launch';
const extraArgs = process.argv.slice(3);
const command = path.resolve(
  process.cwd(),
  'node_modules',
  '.bin',
  process.platform === 'win32' ? 'playwright.cmd' : 'playwright'
);

const result = spawnSync(command, ['test', ...extraArgs], {
  stdio: 'inherit',
  shell: process.platform === 'win32',
  env: {
    ...process.env,
    PLAYWRIGHT_SMOKE_PROFILE: profile,
  },
});

if (result.error) {
  console.error(result.error);
}

if (typeof result.status === 'number') {
  process.exit(result.status);
}

process.exit(1);
