#!/usr/bin/env node
import { spawn } from 'node:child_process';

const npmBin = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const loadGateEnabled = ['1', 'true', 'yes', 'on'].includes(String(process.env.VF_ENABLE_LOAD_GATE || '').trim().toLowerCase());
const liveAuditGateEnabled = ['1', 'true', 'yes', 'on'].includes(
  String(process.env.VF_ENABLE_LIVE_AUDIT_GATE || '').trim().toLowerCase(),
);
const llvcMappingAuditGateEnabled = ['1', 'true', 'yes', 'on'].includes(
  String(process.env.VF_ENABLE_LLVC_MAPPING_AUDIT_GATE || '').trim().toLowerCase(),
);

const run = (command, args, env = {}) =>
  new Promise((resolve) => {
    const commonOptions = {
      stdio: 'inherit',
      env: { ...process.env, ...env },
    };
    const child =
      process.platform === 'win32'
        ? spawn(command, args, {
            ...commonOptions,
            shell: true,
          })
        : spawn(command, args, {
            ...commonOptions,
            shell: false,
          });
    child.on('error', (error) => {
      resolve({
        ok: false,
        code: 1,
        command: `${command} ${args.join(' ')}`,
        error: error instanceof Error ? error.message : String(error),
      });
    });
    child.on('close', (code) => {
      resolve({ ok: code === 0, code: code ?? 1, command: `${command} ${args.join(' ')}` });
    });
  });

const steps = [
  {
    name: 'Type checks',
    command: npmBin,
    args: ['--prefix', '../frontend', 'run', 'typecheck'],
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

if (loadGateEnabled) {
  steps.push({
    name: '50-concurrency load gate',
    command: npmBin,
    args: ['run', 'test:load:50:all'],
  });
}

if (liveAuditGateEnabled) {
  steps.push({
    name: 'Live TTS performance audit gate',
    command: npmBin,
    args: ['run', 'audit:tts:live'],
  });
}

if (llvcMappingAuditGateEnabled) {
  steps.push({
    name: 'LLVC voice mapping audit gate',
    command: npmBin,
    args: ['run', 'audit:llvc:mapping'],
  });
}

const main = async () => {
  for (const step of steps) {
    console.log(`\n[ci:reliability] ${step.name}`);

    const result = await run(step.command, step.args, step.env || {});

    if (!result.ok) {
      if (result.error) {
        console.error(`[ci:reliability] ${step.name} spawn error: ${result.error}`);
      }
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
