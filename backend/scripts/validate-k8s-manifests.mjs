#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';

const ROOT = process.cwd();
const K8S_DIR = path.join(ROOT, 'deploy', 'k8s');
const ARTIFACT_PATH = path.join(ROOT, 'artifacts', 'k8s_manifest_validation_report.json');

const readFileText = async (name) => {
  const fullPath = path.join(K8S_DIR, name);
  const content = await fs.readFile(fullPath, 'utf8');
  return { name, fullPath, content };
};

const has = (text, pattern) => pattern.test(String(text || ''));

const validateRuntimeManifest = (manifest, { runtimeName, port }) => {
  const failures = [];
  const warnings = [];
  const text = manifest.content;

  if (has(text, /command:\s*\[\s*"python"\s*,\s*"app\.py"\s*\]/i)) {
    failures.push('Uses python app.py command instead of uvicorn module command.');
  }
  if (!has(text, /command:\s*[\s\S]*uvicorn[\s\S]*app:app/is)) {
    failures.push('Missing uvicorn app:app command wiring.');
  }
  if (!has(text, /--host[\s\S]*0\.0\.0\.0/i)) {
    failures.push('Missing explicit host bind 0.0.0.0.');
  }
  if (!has(text, new RegExp(`--port[\\s\\S]*${port}`, 'i'))) {
    failures.push(`Missing explicit runtime port argument ${port}.`);
  }
  if (!has(text, /envFrom:\s*[\s\S]*configMapRef:\s*[\s\S]*name:\s*voiceflow-backend-config/i)) {
    failures.push('Missing envFrom configMap voiceflow-backend-config.');
  }
  if (!has(text, /envFrom:\s*[\s\S]*secretRef:\s*[\s\S]*name:\s*voiceflow-runtime-admin/i)) {
    failures.push('Missing envFrom secretRef voiceflow-runtime-admin.');
  }
  if (runtimeName === 'gemini' && !has(text, /GEMINI_RUNTIME_ADMIN_TOKEN/i)) {
    warnings.push('GEMINI_RUNTIME_ADMIN_TOKEN not explicitly referenced in runtime-gemini manifest.');
  }

  return { failures, warnings };
};

const validateApiManifest = (manifest) => {
  const failures = [];
  const warnings = [];
  const text = manifest.content;

  if (has(text, /command:\s*\[\s*"python"\s*,\s*"app\.py"\s*\]/i)) {
    failures.push('Uses python app.py command instead of uvicorn module command.');
  }
  if (!has(text, /command:\s*[\s\S]*uvicorn[\s\S]*app:app/is)) {
    failures.push('Missing uvicorn app:app command wiring.');
  }
  if (!has(text, /--host[\s\S]*0\.0\.0\.0/i)) {
    failures.push('Missing explicit host bind 0.0.0.0.');
  }
  if (!has(text, /--port[\s\S]*7800/i)) {
    failures.push('Missing explicit runtime port argument 7800.');
  }
  if (!has(text, /envFrom:\s*[\s\S]*configMapRef:\s*[\s\S]*name:\s*voiceflow-backend-config/i)) {
    failures.push('API deployment missing envFrom configMap voiceflow-backend-config.');
  }
  if (!has(text, /envFrom:\s*[\s\S]*secretRef:\s*[\s\S]*name:\s*voiceflow-runtime-admin/i)) {
    failures.push('API deployment missing envFrom secretRef voiceflow-runtime-admin.');
  }

  return { failures, warnings };
};

const main = async () => {
  const files = await Promise.all([
    readFileText('runtime-gemini.yaml'),
    readFileText('worker-deployment.yaml'),
    readFileText('api-deployment.yaml'),
    readFileText('kustomization.yaml'),
  ]);

  const index = Object.fromEntries(files.map((item) => [item.name, item]));
  const report = {
    timestamp: new Date().toISOString(),
    k8sDir: K8S_DIR,
    passed: false,
    checks: [],
    summary: {
      failures: 0,
      warnings: 0,
    },
  };

  const geminiValidation = validateRuntimeManifest(index['runtime-gemini.yaml'], { runtimeName: 'gemini', port: 7810 });
  report.checks.push({
    file: 'runtime-gemini.yaml',
    ...geminiValidation,
  });

  const workerText = index['worker-deployment.yaml'].content;
  const workerFailures = [];
  if (has(workerText, /name:\s*VF_AUTH_ENFORCE\s*[\s\S]*value:\s*"0"/i)) {
    workerFailures.push('Worker explicitly disables auth with VF_AUTH_ENFORCE=0.');
  }
  if (!has(workerText, /envFrom:\s*[\s\S]*secretRef:\s*[\s\S]*name:\s*voiceflow-runtime-admin/i)) {
    workerFailures.push('Worker missing envFrom secretRef voiceflow-runtime-admin.');
  }
  report.checks.push({ file: 'worker-deployment.yaml', failures: workerFailures, warnings: [] });

  report.checks.push({
    file: 'api-deployment.yaml',
    ...validateApiManifest(index['api-deployment.yaml']),
  });

  const kustomizationText = index['kustomization.yaml'].content;
  const kustomizationFailures = [];
  if (!has(kustomizationText, /runtime-admin-secret\.example\.yaml/i)) {
    kustomizationFailures.push('kustomization.yaml is missing runtime-admin-secret.example.yaml resource.');
  }
  if (has(kustomizationText, /runtime-duno\.yaml/i)) {
    kustomizationFailures.push('kustomization.yaml still references runtime-duno.yaml.');
  }
  report.checks.push({ file: 'kustomization.yaml', failures: kustomizationFailures, warnings: [] });

  for (const check of report.checks) {
    report.summary.failures += (check.failures || []).length;
    report.summary.warnings += (check.warnings || []).length;
  }

  report.passed = report.summary.failures === 0;

  await fs.mkdir(path.dirname(ARTIFACT_PATH), { recursive: true });
  await fs.writeFile(ARTIFACT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

  console.log(`[validate:k8s] artifact: ${path.relative(ROOT, ARTIFACT_PATH).replace(/\\/g, '/')}`);
  console.log(`[validate:k8s] passed=${report.passed}`);

  if (!report.passed) {
    process.exitCode = 1;
  }
};

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
