#!/usr/bin/env node
import { runCommand } from './lib/process-runner.mjs';

const npmBin = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const loadGateEnabled = ['1', 'true', 'yes', 'on'].includes(String(process.env.VF_ENABLE_LOAD_GATE || '').trim().toLowerCase());
const liveAuditGateEnabled = ['1', 'true', 'yes', 'on'].includes(
  String(process.env.VF_ENABLE_LIVE_AUDIT_GATE || '').trim().toLowerCase(),
);
const llvcMappingAuditGateEnabled = ['1', 'true', 'yes', 'on'].includes(
  String(process.env.VF_ENABLE_LLVC_MAPPING_AUDIT_GATE || '').trim().toLowerCase(),
);
const connectivityAuditGateEnabled = ['1', 'true', 'yes', 'on'].includes(
  String(process.env.VF_ENABLE_CONNECTIVITY_AUDIT_GATE || '').trim().toLowerCase(),
);

const steps = [
  {
    name: 'Type checks',
    command: npmBin,
    args: ['--prefix', '../frontend', 'run', 'typecheck'],
  },
  {
    name: 'Kubernetes manifest validation',
    command: npmBin,
    args: ['run', 'validate:k8s'],
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

if (connectivityAuditGateEnabled) {
  steps.push({
    name: 'Frontend/backend connectivity audit gate',
    command: npmBin,
    args: ['run', 'audit:connectivity'],
  });
}

const main = async () => {
  for (const step of steps) {
    console.log(`\n[ci:reliability] ${step.name}`);

    const result = await runCommand(step.command, step.args, {
      env: step.env || {},
      stdio: 'inherit',
    });

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
