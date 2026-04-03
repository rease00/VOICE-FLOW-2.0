#!/usr/bin/env node

const REQUIRED_SECURITY_HEADERS = [
  'content-security-policy',
  'strict-transport-security',
  'x-frame-options',
  'x-content-type-options',
  'referrer-policy',
  'permissions-policy',
];

const resolveAssetUrl = (base, maybeRelative) => {
  try {
    return new URL(maybeRelative, base).toString();
  } catch {
    return '';
  }
};

const parseFirstScriptSrc = (html) => {
  const match = String(html || '').match(/<script[^>]+src=["']([^"']+\.js[^"']*)["']/i);
  return match ? String(match[1] || '').trim() : '';
};

const hasSafeNoCachePolicy = (cacheControl) => {
  const lowered = String(cacheControl || '').toLowerCase();
  return (
    lowered.includes('no-cache')
    || lowered.includes('no-store')
    || lowered.includes('max-age=0')
  );
};

const hasSafeImmutableAssetPolicy = (cacheControl) => {
  const lowered = String(cacheControl || '').toLowerCase();
  if (lowered.includes('immutable')) return true;
  const maxAgeMatch = lowered.match(/(?:^|,)\s*max-age=(\d+)/);
  const maxAge = maxAgeMatch ? Number(maxAgeMatch[1]) : 0;
  return Number.isFinite(maxAge) && maxAge >= 31536000;
};

const main = async () => {
  const targetUrl = String(process.argv[2] || '').trim();
  if (!targetUrl) {
    throw new Error('Usage: npm run headers:verify -- <url>');
  }

  const report = {
    targetUrl,
    passed: false,
    checks: [],
    warnings: [],
    failures: [],
  };

  const htmlResponse = await fetch(targetUrl, { method: 'GET' });
  report.checks.push({ name: 'html_status', ok: htmlResponse.ok, status: htmlResponse.status });
  if (!htmlResponse.ok) {
    report.failures.push(`HTML response failed with status ${htmlResponse.status}`);
  }

  const htmlCacheControl = String(htmlResponse.headers.get('cache-control') || '').toLowerCase();
  const htmlNoCache = hasSafeNoCachePolicy(htmlCacheControl);
  report.checks.push({ name: 'html_cache_policy', ok: htmlNoCache, cacheControl: htmlCacheControl });
  if (!htmlNoCache) {
    report.failures.push('HTML cache-control is missing no-cache/no-store/max-age=0 policy.');
  }

  for (const headerName of REQUIRED_SECURITY_HEADERS) {
    const value = String(htmlResponse.headers.get(headerName) || '').trim();
    const ok = value.length > 0;
    report.checks.push({ name: `security_header_${headerName}`, ok, value });
    if (!ok) {
      report.failures.push(`Missing security header: ${headerName}`);
    }
  }

  const htmlBody = await htmlResponse.text();
  const firstScriptSrc = parseFirstScriptSrc(htmlBody);
  if (!firstScriptSrc) {
    report.warnings.push('Could not locate first script src in HTML response.');
  } else {
    const assetUrl = resolveAssetUrl(targetUrl, firstScriptSrc);
    if (!assetUrl) {
      report.failures.push('Failed to resolve script asset URL from HTML response.');
    } else {
      const assetResponse = await fetch(assetUrl, { method: 'GET' });
      const assetCacheControl = String(assetResponse.headers.get('cache-control') || '').toLowerCase();
      const immutable = hasSafeImmutableAssetPolicy(assetCacheControl);
      report.checks.push({
        name: 'asset_cache_policy',
        ok: assetResponse.ok && immutable,
        status: assetResponse.status,
        cacheControl: assetCacheControl,
      });
      if (!assetResponse.ok) {
        report.failures.push(`Asset response failed with status ${assetResponse.status}`);
      } else if (!immutable) {
        report.failures.push('Asset cache-control is missing immutable or long-lived max-age policy.');
      }
    }
  }

  report.passed = report.failures.length === 0;

  console.log(`[headers:verify] target=${targetUrl}`);
  console.log(`[headers:verify] passed=${report.passed}`);
  if (report.warnings.length > 0) {
    for (const warning of report.warnings) {
      console.log(`[headers:verify] warning: ${warning}`);
    }
  }
  if (!report.passed) {
    for (const failure of report.failures) {
      console.error(`[headers:verify] failure: ${failure}`);
    }
    process.exitCode = 1;
  }
};

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
