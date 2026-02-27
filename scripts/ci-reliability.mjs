#!/usr/bin/env node
import { spawn } from 'node:child_process';

const npmBin = process.platform === 'win32' ? 'npm.cmd' : 'npm';

const run = (command, args, env = {}) =>
  new Promise((resolve) => {
    const child = spawn(command, args, {
      stdio: 'inherit',
      shell: process.platform === 'win32',
      env: { ...process.env, ...env },
    });
    child.on('close', (code) => {
      resolve({ ok: code === 0, code: code ?? 1, command: `${command} ${args.join(' ')}` });
    });
  });

const steps = [
  {
    name: 'Type checks',
    command: npmBin,
    args: ['exec', '--', 'tsc', '--noEmit'],
  },
  {
    name: 'Media backend audit',
    command: npmBin,
    args: ['run', 'audit:media'],
  },
  {
    name: 'TTS long-text 5000 smoke gate',
    command: npmBin,
    args: ['run', 'audit:tts:longtext:smoke'],
  },
  {
    name: 'Contract conformance',
    command: npmBin,
    args: ['run', 'test:contracts'],
  },
];

const main = async () => {
  for (const step of steps) {
    console.log(`\n[ci:reliability] ${step.name}`);
    const result = await run(step.command, step.args, step.env || {});
    if (!result.ok) {
      console.error(`[ci:reliability] failed at "${step.name}" (${result.command})`);
      process.exit(result.code);
    }
  }
  console.log('\n[ci:reliability] all reliability gates passed.');
};

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
