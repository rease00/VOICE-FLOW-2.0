#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..', '..');

const readText = (relativePath) =>
  readFileSync(path.join(repoRoot, relativePath), 'utf8');

const readJson = (relativePath) => JSON.parse(readText(relativePath));

const assert = (condition, message) => {
  if (!condition) {
    throw new Error(message);
  }
};

const assertContains = (relativePath, snippets) => {
  const content = readText(relativePath);
  for (const snippet of snippets) {
    assert(
      content.includes(snippet),
      `${relativePath} is missing expected text: ${snippet}`
    );
  }
};

const assertNotMatches = (relativePath, patterns) => {
  const content = readText(relativePath);
  for (const pattern of patterns) {
    assert(
      !pattern.test(content),
      `${relativePath} still contains drifted provider wording matching ${pattern}`
    );
  }
};

const config = readJson('infra/cloudrun/services.default.json');
const services = new Map(config.services.map((service) => [service.name, service]));

const requireService = (serviceName) => {
  const service = services.get(serviceName);
  assert(service, `Missing Cloud Run service config for ${serviceName}.`);
  return service;
};

const assertRuntimeMapping = (serviceName) => {
  const service = requireService(serviceName);
  const env = service.env ?? {};
  const secretEnv = service.secretEnv ?? {};

  assert(
    env.VF_TTS_RUNTIME_URL === '__GEMINI_RUNTIME_URL__',
    `${serviceName} must source TTS traffic through VF_TTS_RUNTIME_URL.`
  );
  assert(
    env.VF_VERTEX_TEXT_RUNTIME_URL === '__VERTEX_TEXT_RUNTIME_URL__',
    `${serviceName} must source Vertex text traffic through VF_VERTEX_TEXT_RUNTIME_URL.`
  );
  assert(
    env.VF_VOICE_CLONE_PROVIDER_DEFAULT === 'modal',
    `${serviceName} must keep Voice Clone on Modal.`
  );
  assert(
    env.VF_OPENVOICE_PROVIDER_DEFAULT === 'modal',
    `${serviceName} must keep OpenVoice compatibility on Modal.`
  );
  assert(
    env.VF_VOICE_CLONE_MODAL_RUNTIME_URL === '__VOICE_CLONE_MODAL_RUNTIME_URL__',
    `${serviceName} must keep the Modal Voice Clone runtime mapping.`
  );
  assert(
    env.VF_OPENVOICE_MODAL_RUNTIME_URL === '__OPENVOICE_MODAL_RUNTIME_URL__',
    `${serviceName} must keep the Modal OpenVoice runtime mapping.`
  );
  const allowedSecretBindings = new Set([
    'VF_VOICE_CLONE_MODAL_RUNTIME_TOKEN',
    'VF_OPENVOICE_MODAL_RUNTIME_TOKEN',
    'VF_VOICE_CLONE_ARTIFACT_SECRET',
    'VF_OPENVOICE_ARTIFACT_SECRET',
  ]);
  assert(
    Object.keys(secretEnv).every((key) => allowedSecretBindings.has(key)),
    `${serviceName} secretEnv contains an unexpected legacy runtime secret binding.`
  );
  assert(
    secretEnv.VF_VOICE_CLONE_MODAL_RUNTIME_TOKEN,
    `${serviceName} must bind VF_VOICE_CLONE_MODAL_RUNTIME_TOKEN from Secret Manager.`
  );
  assert(
    secretEnv.VF_OPENVOICE_MODAL_RUNTIME_TOKEN,
    `${serviceName} must bind VF_OPENVOICE_MODAL_RUNTIME_TOKEN from Secret Manager.`
  );
};

assertRuntimeMapping('voiceflow-api');
assertRuntimeMapping('voiceflow-worker');

for (const service of config.services) {
  for (const [envName, secretRef] of Object.entries(service.secretEnv ?? {})) {
    assert(
      !String(secretRef).endsWith(':1'),
      `${service.name}.${envName} is pinned to secret version 1. Use an unqualified secret name or :latest.`
    );
  }
}

assertContains('README.md', [
  'Vertex text runtime',
  'Cloud TTS runtime',
  'Voice Clone/Seed-VC` is served through the backend voice-clone routes and the Modal-hosted runtime configured by `VF_VOICE_CLONE_RUNTIME_URL`',
]);
assertContains('README_SERVERS.md', [
  'Vertex text runtime',
  'Cloud TTS runtime',
]);
assertContains('docs/SCALING_ARCHITECTURE.md', [
  'Engine runtimes (Cloud TTS and Vertex text)',
  'Vertex text runtime',
]);
assertContains('infra/cloudrun/README.md', [
  'voiceflow-vertex-text-runtime',
  'VF_VERTEX_TEXT_RUNTIME_URL',
  'Voice Clone, OpenVoice compatibility, and Demucs separation stay Modal-backed in production',
]);

const deployScript = readText('infra/cloudrun/deploy.ps1');
assert(
  deployScript.includes('__VERTEX_TEXT_RUNTIME_URL__'),
  'infra/cloudrun/deploy.ps1 must resolve the Vertex text runtime placeholder.'
);
assert(
  deployScript.includes('return "$token`:latest"'),
  'infra/cloudrun/deploy.ps1 must default secret refs to :latest.'
);
assert(
  !deployScript.includes('return "$token`:1"'),
  'infra/cloudrun/deploy.ps1 still defaults secret refs to :1.'
);

console.log('[cloudrun] provider/env drift validation passed.');
