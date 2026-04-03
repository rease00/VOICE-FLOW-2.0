#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs/promises';

const ROOT = process.cwd();
const ARTIFACT_DIR = path.join(ROOT, 'artifacts');
const ARTIFACT_PATH = path.join(ARTIFACT_DIR, 'lighthouse-summary.json');
const DEFAULT_BASE_URL = 'http://127.0.0.1:3000';
const DEFAULT_TARGETS = [
  { route: 'studio', path: '/app/studio' },
  { route: 'voices', path: '/app/voices' },
  { route: 'reader', path: '/app/reader' },
];

const truthy = (value) => {
  const token = String(value || '').trim().toLowerCase();
  return token === '1' || token === 'true' || token === 'yes' || token === 'on';
};

const looksLikeUrl = (value) => /^https?:\/\//i.test(String(value || '').trim());

const safeRouteSlug = (value, fallback) => {
  const token = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return token || fallback;
};

const readReportJson = async (reportPath) => {
  try {
    const raw = await fs.readFile(reportPath, 'utf8');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
};

const isCleanupOnlyWindowsError = (result, reportJson) => {
  if (process.platform !== 'win32' || !reportJson) return false;
  const combinedOutput = [result?.stdout || '', result?.stderr || ''].join('\n');
  return /\b(EPERM|EBUSY)\b/i.test(combinedOutput);
};

const extractMetricValue = (reportJson, auditId) => {
  const numericValue = reportJson?.audits?.[auditId]?.numericValue;
  return Number.isFinite(Number(numericValue)) ? Math.round(Number(numericValue)) : 0;
};

const buildTargets = () => {
  const cliTargets = process.argv.slice(2).map((value) => String(value || '').trim()).filter(Boolean);
  const explicitTargets = cliTargets.length > 0
    ? cliTargets
    : String(process.env.VF_LIGHTHOUSE_URL || '').trim()
      ? [String(process.env.VF_LIGHTHOUSE_URL || '').trim()]
      : [];

  if (explicitTargets.length > 0) {
    return explicitTargets.map((target, index) => {
      if (looksLikeUrl(target)) {
        let route = `custom-${index + 1}`;
        try {
          const parsed = new URL(target);
          route = safeRouteSlug(parsed.pathname.split('/').filter(Boolean).join('-'), route);
        } catch {
          // Keep fallback route name.
        }
        return { route, url: target };
      }

      const route = safeRouteSlug(target, `custom-${index + 1}`);
      return { route, url: new URL(target, DEFAULT_BASE_URL).toString() };
    });
  }

  const baseUrl = String(process.env.VF_LIGHTHOUSE_BASE_URL || DEFAULT_BASE_URL).trim() || DEFAULT_BASE_URL;
  return DEFAULT_TARGETS.map((target) => ({
    route: target.route,
    url: new URL(target.path, baseUrl).toString(),
  }));
};

const runLighthouseTarget = async (target) => {
  const outputPath = path.join(ARTIFACT_DIR, `lighthouse-${safeRouteSlug(target.route, 'report')}.json`);
  const startedAtMs = Date.now();
  await fs.rm(outputPath, { force: true }).catch(() => undefined);
  const lighthouseArgs = [
    '--yes',
    'lighthouse',
    target.url,
    '--chrome-flags=--headless',
    '--output=json',
    `--output-path=${outputPath}`,
  ];
  const cmd = 'npx';
  const args = lighthouseArgs;
  const result = spawnSync(cmd, args, {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: 'pipe',
    shell: process.platform === 'win32',
    maxBuffer: 20 * 1024 * 1024,
    env: process.env,
  });

  if (result.error) {
    console.error(result.error instanceof Error ? result.error.message : String(result.error));
  }
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);

  const reportJson = await readReportJson(outputPath);
  let freshReportJson = null;
  if (reportJson) {
    try {
      const stats = await fs.stat(outputPath);
      const reportUrl = String(reportJson.finalUrl || reportJson.requestedUrl || '').trim();
      const isFreshWrite = stats.mtimeMs >= startedAtMs - 1000;
      if (isFreshWrite && (!reportUrl || reportUrl === target.url)) {
        freshReportJson = reportJson;
      }
    } catch {
      freshReportJson = null;
    }
  }
  const cleanupWarning = isCleanupOnlyWindowsError(result, freshReportJson)
    ? 'Lighthouse report was generated, but Windows temp cleanup returned a non-fatal lock error.'
    : '';
  const passed = !result.error && (result.status === 0 || Boolean(cleanupWarning));

  return {
    route: target.route,
    url: target.url,
    reportPath: path.relative(ROOT, outputPath).replace(/\\/g, '/'),
    passed,
    status: typeof result.status === 'number' ? result.status : (result.error ? 1 : 0),
    cleanupWarning,
    metrics: freshReportJson ? {
      performance: Math.round(Number(freshReportJson?.categories?.performance?.score || 0) * 100),
      lcpMs: extractMetricValue(freshReportJson, 'largest-contentful-paint'),
      tbtMs: extractMetricValue(freshReportJson, 'total-blocking-time'),
      cls: Number(freshReportJson?.audits?.['cumulative-layout-shift']?.numericValue || 0),
    } : null,
  };
};

const main = async () => {
  const enforceInCi = truthy(process.env.CI) && !String(process.env.VF_ENABLE_LIGHTHOUSE || '').trim();
  const enforce = truthy(process.env.VF_ENABLE_LIGHTHOUSE) || enforceInCi;
  const targets = buildTargets();

  const report = {
    generatedAt: new Date().toISOString(),
    targetUrl: targets[0]?.url || DEFAULT_BASE_URL,
    enforce,
    ran: false,
    passed: true,
    note: '',
    targets: [],
  };

  if (!enforce) {
    report.note = 'Skipped. Set VF_ENABLE_LIGHTHOUSE=1 to run Lighthouse locally. CI runs by default.';
    await fs.mkdir(ARTIFACT_DIR, { recursive: true });
    await fs.writeFile(ARTIFACT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    console.log(`[perf:lighthouse] ${report.note}`);
    console.log(`[perf:lighthouse] artifact: ${path.relative(ROOT, ARTIFACT_PATH).replace(/\\/g, '/')}`);
    return;
  }

  report.ran = true;
  let exitCode = 0;

  for (const target of targets) {
    const targetReport = await runLighthouseTarget(target);
    report.targets.push(targetReport);
    if (!targetReport.passed) {
      report.passed = false;
      exitCode = targetReport.status || 1;
    }
  }

  report.note = report.passed
    ? 'Lighthouse completed.'
    : 'One or more Lighthouse targets failed.';

  await fs.mkdir(ARTIFACT_DIR, { recursive: true });
  await fs.writeFile(ARTIFACT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(`[perf:lighthouse] artifact: ${path.relative(ROOT, ARTIFACT_PATH).replace(/\\/g, '/')}`);

  if (!report.passed) {
    process.exitCode = exitCode || 1;
  }
};

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
