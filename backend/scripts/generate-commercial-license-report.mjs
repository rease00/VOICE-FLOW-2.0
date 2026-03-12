#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const backendRoot = path.resolve(__dirname, '..');
const workspaceRoot = path.resolve(backendRoot, '..');
const frontendRoot = path.join(workspaceRoot, 'frontend');
const reportPath = path.join(workspaceRoot, 'output', 'audit', 'commercial-license-report.json');

const PROVIDER_POLICY = {
  commercialModeDefault: true,
  blockedProvidersDefault: ['freesound', 'pixabay', 'project_gutenberg', 'standard_ebooks'],
  conditionalProviders: {
    openverse: {
      mode: 'allow_only_when_license_and_attribution_match_allowlist',
      requiredMetadata: ['license', 'attributionUrl'],
      licenseAllowlistEnv: 'VF_COMMERCIAL_LICENSE_ALLOWLIST',
    },
  },
  providerAllowlistEnv: 'VF_COMMERCIAL_PROVIDER_ALLOWLIST',
};

const BLOCKED_LICENSE_PATTERNS = [
  /\bagpl\b/i,
  /\baffero\b/i,
  /\blgpl\b/i,
  /\bgpl\b/i,
  /general public license/i,
];

const classifyLicense = (licenseText) => {
  const text = String(licenseText || '').trim();
  if (!text) return { status: 'review', reason: 'missing_license_metadata' };
  if (BLOCKED_LICENSE_PATTERNS.some((pattern) => pattern.test(text))) {
    return { status: 'blocked', reason: 'gpl_family_detected' };
  }
  return { status: 'allowed', reason: 'no_gpl_family_detected' };
};

const summarizeStatuses = (rows) => {
  const summary = { allowed: 0, blocked: 0, review: 0, unknown: 0 };
  for (const row of rows) {
    const token = String(row?.status || 'unknown');
    if (token in summary) {
      summary[token] += 1;
    } else {
      summary.unknown += 1;
    }
  }
  return summary;
};

const readJson = async (targetPath) => JSON.parse(await fs.readFile(targetPath, 'utf8'));

const parsePythonRequirementName = (line) => {
  const cleaned = String(line || '').trim();
  if (!cleaned || cleaned.startsWith('#') || cleaned.startsWith('-r ')) return '';
  const token = cleaned.split(';', 1)[0] || cleaned;
  const name = token.split(/[<>=!~[\s]/, 1)[0] || '';
  return name.trim();
};

const fetchJsonWithTimeout = async (url, timeoutMs = 10000) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal, headers: { Accept: 'application/json' } });
    if (!response.ok) {
      throw new Error(`${response.status} ${response.statusText}`.trim());
    }
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
};

const collectFrontendNpmLicenses = async () => {
  const packageJsonPath = path.join(frontendRoot, 'package.json');
  const packageJson = await readJson(packageJsonPath);
  const dependencies = Object.keys(packageJson.dependencies || {}).sort((a, b) => a.localeCompare(b));
  const rows = [];
  for (const name of dependencies) {
    const packagePath = path.join(frontendRoot, 'node_modules', ...name.split('/'), 'package.json');
    let license = '';
    let source = 'node_modules';
    try {
      const depPackage = await readJson(packagePath);
      const directLicense = depPackage.license;
      if (typeof directLicense === 'string') {
        license = directLicense;
      } else if (directLicense && typeof directLicense.type === 'string') {
        license = directLicense.type;
      } else if (Array.isArray(depPackage.licenses)) {
        license = depPackage.licenses
          .map((item) => String(item?.type || item || '').trim())
          .filter(Boolean)
          .join(', ');
      }
    } catch {
      source = 'missing_node_module_metadata';
    }
    const classified = classifyLicense(license);
    rows.push({
      name,
      license: license || null,
      status: classified.status,
      reason: classified.reason,
      source,
    });
  }
  return {
    dependencies: rows,
    summary: summarizeStatuses(rows),
  };
};

const collectBackendPythonLicenses = async () => {
  const requirementsPath = path.join(backendRoot, 'requirements-core.txt');
  const lines = (await fs.readFile(requirementsPath, 'utf8')).split(/\r?\n/);
  const packageNames = Array.from(
    new Set(lines.map((line) => parsePythonRequirementName(line)).filter(Boolean))
  ).sort((a, b) => a.localeCompare(b));
  const rows = [];
  for (const name of packageNames) {
    let license = '';
    let source = 'pypi_json';
    try {
      const payload = await fetchJsonWithTimeout(`https://pypi.org/pypi/${encodeURIComponent(name)}/json`, 10000);
      const info = payload?.info || {};
      const expressionLicense = String(info.license_expression || '').trim();
      const baseLicense = String(info.license || '').trim();
      const classifiers = Array.isArray(info.classifiers)
        ? info.classifiers.filter((entry) => String(entry || '').startsWith('License ::'))
        : [];
      const dedupedLicenses = Array.from(
        new Set(
          [expressionLicense, baseLicense, ...classifiers]
            .map((item) => String(item || '').trim())
            .filter(Boolean)
        )
      );
      license = dedupedLicenses.join(' | ');
    } catch (error) {
      source = `lookup_failed:${error instanceof Error ? error.message : String(error)}`;
    }
    const classified = classifyLicense(license);
    rows.push({
      name,
      license: license || null,
      status: classified.status,
      reason: classified.reason,
      source,
    });
  }
  return {
    dependencies: rows,
    summary: summarizeStatuses(rows),
  };
};

const main = async () => {
  const [npmReport, pythonReport] = await Promise.all([
    collectFrontendNpmLicenses(),
    collectBackendPythonLicenses(),
  ]);

  const report = {
    generatedAt: new Date().toISOString(),
    policyVersion: '2026-03-11.strict',
    providerPolicy: PROVIDER_POLICY,
    frontendNpm: npmReport,
    backendPython: pythonReport,
    releaseGate: {
      frontendNoGplOrLgpl:
        (npmReport.dependencies || []).filter((entry) => entry.status === 'blocked').length === 0,
      reviewCount:
        Number(npmReport.summary.review || 0)
        + Number(pythonReport.summary.review || 0),
    },
  };

  await fs.mkdir(path.dirname(reportPath), { recursive: true });
  await fs.writeFile(reportPath, JSON.stringify(report, null, 2));
  console.log(`Wrote ${path.relative(workspaceRoot, reportPath).replace(/\\/g, '/')}`);
};

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
