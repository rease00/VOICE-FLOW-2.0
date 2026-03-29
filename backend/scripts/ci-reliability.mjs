#!/usr/bin/env node
import { runCommand } from './lib/process-runner.mjs';

const npmBin = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const asBool = (value) => ['1', 'true', 'yes', 'on'].includes(String(value || '').trim().toLowerCase());
const asFalseyBool = (value) => ['0', 'false', 'no', 'off'].includes(String(value || '').trim().toLowerCase());
const loadGateEnabled = ['1', 'true', 'yes', 'on'].includes(String(process.env.VF_ENABLE_LOAD_GATE || '').trim().toLowerCase());
const loadGate100Enabled = ['1', 'true', 'yes', 'on'].includes(
  String(process.env.VF_ENABLE_LOAD_GATE_100 || '').trim().toLowerCase(),
);
const liveAuditGateEnabled = ['1', 'true', 'yes', 'on'].includes(
  String(process.env.VF_ENABLE_LIVE_AUDIT_GATE || '').trim().toLowerCase(),
);
const connectivityAuditGateEnabled = ['1', 'true', 'yes', 'on'].includes(
  String(process.env.VF_ENABLE_CONNECTIVITY_AUDIT_GATE || '').trim().toLowerCase(),
);
const authEnforced = !asFalseyBool(process.env.VF_AUTH_ENFORCE);
const hasAuditBearerToken = Boolean(String(
  process.env.AUDIT_BEARER_TOKEN
  || process.env.VF_AUDIT_BEARER_TOKEN
  || process.env.VF_BEARER_TOKEN
  || ''
).trim());
const forceMediaAuditGate = asBool(process.env.VF_FORCE_MEDIA_AUDIT_GATE);
const shouldRunMediaAuditGate = forceMediaAuditGate || !authEnforced || hasAuditBearerToken;

const steps = [
  {
    name: 'Tracked config secret scan',
    command: npmBin,
    args: ['run', 'audit:secrets:tracked-config'],
  },
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

if (shouldRunMediaAuditGate) {
  steps.splice(3, 0, {
    name: 'Media backend audit',
    command: npmBin,
    args: ['run', 'audit:media'],
  });
} else {
  const reason = authEnforced
    ? 'VF_AUTH_ENFORCE is enabled and no AUDIT_BEARER_TOKEN was provided.'
    : 'media audit gate disabled.';
  console.log(`[ci:reliability] skipping "Media backend audit": ${reason}`);
}

if (loadGateEnabled) {
  steps.push({
    name: '50-concurrency load gate',
    command: npmBin,
    args: ['run', 'test:load:50:all'],
  });
  if (loadGate100Enabled) {
    steps.push({
      name: '100-concurrency load gate',
      command: npmBin,
      args: ['run', 'test:load:100:all'],
    });
  }
}

if (liveAuditGateEnabled) {
  steps.push({
    name: 'Live TTS performance audit gate',
    command: npmBin,
    args: ['run', 'audit:tts:live'],
  });
}

if (connectivityAuditGateEnabled) {
  steps.push({
    name: 'Frontend/backend connectivity audit gate',
    command: npmBin,
    args: ['run', 'audit:connectivity'],
  });
}

const stabilizeServicesAfterFailure = async () => {
  console.log('\n[ci:reliability] attempting post-failure service stabilization');
  const precheck = await runCommand(npmBin, ['run', 'services:check'], { stdio: 'inherit' });
  if (precheck.ok) {
    console.log('[ci:reliability] services:check passed; no restart needed.');
    return;
  }

  const restart = await runCommand(npmBin, ['run', 'services:restart'], { stdio: 'inherit' });
  if (!restart.ok) {
    const reason = restart.error ? ` (${restart.error})` : '';
    console.warn(`[ci:reliability] services:restart failed${reason}`);
    return;
  }

  const postcheck = await runCommand(npmBin, ['run', 'services:check'], { stdio: 'inherit' });
  if (!postcheck.ok) {
    const reason = postcheck.error ? ` (${postcheck.error})` : '';
    console.warn(`[ci:reliability] services:check still failing after restart${reason}`);
    return;
  }
  console.log('[ci:reliability] service stabilization succeeded.');
};

const main = async () => {
  for (const step of steps) {
    console.log(`\n[ci:reliability] ${step.name}`);

    const result = await runCommand(step.command, step.args, {
      env: step.env || {},
      stdio: 'inherit',
    });

    if (!result.ok) {
      if (step.name === 'TTS long-text 5000 smoke gate') {
        await stabilizeServicesAfterFailure();
      }
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
