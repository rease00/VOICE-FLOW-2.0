#!/usr/bin/env node
import { spawn } from 'node:child_process';

const npmBin = process.platform === 'win32' ? 'npm.cmd' : 'npm';

const run = (command, args, env = {}) =>
  new Promise((resolve) => {
    const child = spawn(command, args, {
      stdio: 'inherit',
      shell: false,
      env: { ...process.env, ...env },
    });
    child.on('close', (code) => {
      resolve({ ok: code === 0, code: code ?? 1, command: `${command} ${args.join(' ')}` });
    });
  });

const steps = [
  {
    name: 'Type checks',
    command: process.execPath,
    args: ['../frontend/node_modules/typescript/bin/tsc', '--noEmit', '--project', '../frontend/tsconfig.json'],
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

    // #region agent log
    fetch('http://127.0.0.1:7253/ingest/7d53969d-0f6f-4881-933b-2b09a69b4b29', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Debug-Session-Id': '74262e',
      },
      body: JSON.stringify({
        sessionId: '74262e',
        runId: 'ci-reliability-pre-fix',
        hypothesisId: step.name === 'Type checks' ? 'H1' : 'H-other',
        location: 'backend/scripts/ci-reliability.mjs:44',
        message: 'ci step start',
        data: {
          cwd: process.cwd(),
          stepName: step.name,
          command: step.command,
          args: step.args,
        },
        timestamp: Date.now(),
      }),
    }).catch(() => {});
    // #endregion agent log

    const result = await run(step.command, step.args, step.env || {});

    // #region agent log
    fetch('http://127.0.0.1:7253/ingest/7d53969d-0f6f-4881-933b-2b09a69b4b29', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Debug-Session-Id': '74262e',
      },
      body: JSON.stringify({
        sessionId: '74262e',
        runId: 'ci-reliability-pre-fix',
        hypothesisId: step.name === 'Type checks' ? 'H1' : 'H-other',
        location: 'backend/scripts/ci-reliability.mjs:64',
        message: 'ci step result',
        data: {
          stepName: step.name,
          ok: result.ok,
          code: result.code,
          command: result.command,
        },
        timestamp: Date.now(),
      }),
    }).catch(() => {});
    // #endregion agent log

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
