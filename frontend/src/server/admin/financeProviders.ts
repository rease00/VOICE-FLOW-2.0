import fs from 'node:fs';
import path from 'node:path';

import { GoogleAuth } from 'google-auth-library';

import {
  getGoogleCloudAuthOptions,
  resolveFirebaseAdminServiceAccount,
} from '../googleCredentials';
import { readEnvBoolean, readEnvValue } from '../../shared/runtime/env';

const CLOUD_PLATFORM_SCOPE = 'https://www.googleapis.com/auth/cloud-platform';
const DEFAULT_USD_TO_INR = 86;
const DEFAULT_EUR_TO_INR = 94;
const DEFAULT_GBP_TO_INR = 101;

type ProviderSeriesPoint = {
  bucket: string;
  actualInr: number;
};

type ProviderTopDriver = {
  label: string;
  amountInr: number;
  detail?: string;
};

export type ProviderSnapshot = {
  provider: 'gcp' | 'modal';
  displayName: string;
  source: string;
  configured: boolean;
  supported: boolean;
  status: 'ok' | 'warning' | 'critical' | 'missing' | 'stale';
  stale: boolean;
  currency: string;
  actualWindows: {
    todayInr: number;
    last7dInr: number;
    monthInr: number;
    trailing30dInr: number;
  };
  series: ProviderSeriesPoint[];
  topDrivers: ProviderTopDriver[];
  providerCoverage: number;
  lastAttemptAt: string;
  lastSuccessAt?: string;
  lastProviderSyncAt?: string;
  detail?: string;
};

export type ExternalBudgetRecord = {
  budgetId: string;
  name: string;
  amountInr: number;
  warningPct: number;
  criticalPct: number;
  scopeType: 'global' | 'provider';
  scopeKey: string;
  source: 'gcp_budget_api';
  readOnly: boolean;
  externalRef: string;
  status: 'ok';
  currency: 'INR';
  metadata?: Record<string, unknown>;
};

type GcpBigQueryRow = {
  bucket: string;
  service_name: string;
  sku_name: string;
  currency: string;
  amount: string | number;
};

const asString = (value: unknown): string => String(value ?? '').trim();
const asLower = (value: unknown): string => asString(value).toLowerCase();
const asNumber = (value: unknown, fallback = 0): number => {
  const next = Number(value);
  return Number.isFinite(next) ? next : fallback;
};
const asPositiveNumber = (value: unknown, fallback = 0): number => Math.max(0, asNumber(value, fallback));
const nowIso = (): string => new Date().toISOString();

const roundInr = (value: number): number => Math.round((Number.isFinite(value) ? value : 0) * 100) / 100;

const convertAmountToInr = (amount: number, currency: string): number => {
  const normalized = asLower(currency || 'INR');
  if (!Number.isFinite(amount) || amount <= 0) return 0;
  if (!normalized || normalized === 'inr') return roundInr(amount);
  if (normalized === 'usd') {
    return roundInr(amount * asPositiveNumber(process.env.VF_ADMIN_USD_TO_INR, DEFAULT_USD_TO_INR));
  }
  if (normalized === 'eur') {
    return roundInr(amount * asPositiveNumber(process.env.VF_ADMIN_EUR_TO_INR, DEFAULT_EUR_TO_INR));
  }
  if (normalized === 'gbp') {
    return roundInr(amount * asPositiveNumber(process.env.VF_ADMIN_GBP_TO_INR, DEFAULT_GBP_TO_INR));
  }
  return roundInr(amount);
};

const parseBigQueryCell = (cell: unknown): unknown => {
  if (!cell || typeof cell !== 'object') return cell;
  const payload = cell as { v?: unknown; f?: unknown[] };
  if (Array.isArray(payload.f)) {
    return payload.f.map((item) => parseBigQueryCell(item));
  }
  const value = payload.v;
  if (value && typeof value === 'object') {
    const nested = value as { f?: unknown[] };
    if (Array.isArray(nested.f)) {
      return nested.f.map((item) => parseBigQueryCell(item));
    }
  }
  return value;
};

const parseBigQueryRows = (
  schemaFields: Array<{ name?: string }> | undefined,
  rows: Array<{ f?: unknown[] }> | undefined,
): GcpBigQueryRow[] => {
  if (!Array.isArray(schemaFields) || !Array.isArray(rows)) return [];
  return rows.map((row) => {
    const values = Array.isArray(row?.f) ? row.f.map((item) => parseBigQueryCell(item)) : [];
    return schemaFields.reduce((acc, field, index) => {
      if (field?.name) {
        acc[field.name] = values[index];
      }
      return acc;
    }, {} as Record<string, unknown>) as unknown as GcpBigQueryRow;
  });
};

const buildSnapshotFromRows = (
  provider: 'gcp' | 'modal',
  displayName: string,
  source: string,
  rows: Array<{ bucket: string; amountInr: number; label: string; detail?: string }>,
  options?: { detail?: string; configured?: boolean; supported?: boolean; lastAttemptAt?: string },
): ProviderSnapshot => {
  const bucketTotals = new Map<string, number>();
  const driverTotals = new Map<string, { amountInr: number; detail?: string }>();
  for (const row of rows) {
    const bucket = asString(row.bucket);
    const amountInr = asPositiveNumber(row.amountInr);
    if (!bucket || amountInr <= 0) continue;
    bucketTotals.set(bucket, roundInr((bucketTotals.get(bucket) || 0) + amountInr));
    const label = asString(row.label) || 'Unknown';
    const previous = driverTotals.get(label) || { amountInr: 0 };
    driverTotals.set(label, {
      amountInr: roundInr(previous.amountInr + amountInr),
      ...((previous.detail || row.detail) ? { detail: previous.detail || row.detail } : {}),
    });
  }

  const buckets = Array.from(bucketTotals.entries())
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([bucket, amountInr]) => ({ bucket, actualInr: amountInr }));

  const today = new Date();
  const todayBucket = today.toISOString().slice(0, 10);
  const last7Threshold = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const trailing30Threshold = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const monthThreshold = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1)).toISOString().slice(0, 10);

  const sumBuckets = (threshold: string): number => roundInr(
    buckets
      .filter((item) => item.bucket >= threshold)
      .reduce((sum, item) => sum + asPositiveNumber(item.actualInr), 0)
  );

  const topDrivers = Array.from(driverTotals.entries())
    .map(([label, item]) => ({ label, amountInr: roundInr(item.amountInr), ...(item.detail ? { detail: item.detail } : {}) }))
    .sort((left, right) => right.amountInr - left.amountInr)
    .slice(0, 6);

  const latestBucket = buckets.length > 0 ? buckets[buckets.length - 1] : undefined;
  const lastAttemptAt = options?.lastAttemptAt || nowIso();
  const configured = options?.configured ?? true;
  const supported = options?.supported ?? true;
  const stale = !latestBucket || latestBucket.bucket < last7Threshold;

  return {
    provider,
    displayName,
    source,
    configured,
    supported,
    status: !configured
      ? 'missing'
      : !supported
        ? 'warning'
        : stale
          ? 'stale'
          : 'ok',
    stale,
    currency: 'INR',
    actualWindows: {
      todayInr: roundInr(bucketTotals.get(todayBucket) || 0),
      last7dInr: sumBuckets(last7Threshold),
      monthInr: sumBuckets(monthThreshold),
      trailing30dInr: sumBuckets(trailing30Threshold),
    },
    series: buckets.slice(-30),
    topDrivers,
    providerCoverage: buckets.length > 0 ? 1 : 0,
    lastAttemptAt,
    ...(latestBucket ? { lastSuccessAt: lastAttemptAt, lastProviderSyncAt: `${latestBucket.bucket}T23:59:59.000Z` } : {}),
    ...(options?.detail ? { detail: options.detail } : {}),
  };
};

const getGoogleAuthClient = async () => {
  const credentials = resolveFirebaseAdminServiceAccount();
  const auth = new GoogleAuth({
    ...getGoogleCloudAuthOptions(credentials),
    scopes: [CLOUD_PLATFORM_SCOPE],
  });
  return auth.getClient();
};

const fetchGoogleAccessToken = async (): Promise<string> => {
  const client = await getGoogleAuthClient();
  const token = await client.getAccessToken();
  const accessToken = typeof token === 'string' ? token : token?.token;
  if (!accessToken) {
    throw new Error('Unable to acquire Google Cloud access token.');
  }
  return accessToken;
};

const normalizeBigQueryProjectId = (): string => (
  asString(
    readEnvValue(
      process.env.VF_ADMIN_GCP_BILLING_PROJECT_ID,
      process.env.VF_GOOGLE_CLOUD_PROJECT,
      process.env.VF_GEMINI_VERTEX_PROJECT,
      process.env.GOOGLE_CLOUD_PROJECT,
    ),
  ) || resolveFirebaseAdminServiceAccount().projectId
);

const executeBigQueryQuery = async (projectId: string, query: string): Promise<GcpBigQueryRow[]> => {
  const accessToken = await fetchGoogleAccessToken();
  const response = await fetch(`https://bigquery.googleapis.com/bigquery/v2/projects/${encodeURIComponent(projectId)}/queries`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${accessToken}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      query,
      useLegacySql: false,
      timeoutMs: 20000,
      maxResults: 5000,
    }),
  });
  if (!response.ok) {
    throw new Error(`BigQuery query failed (${response.status})`);
  }
  const payload = await response.json() as { schema?: { fields?: Array<{ name?: string }> }; rows?: Array<{ f?: unknown[] }> };
  return parseBigQueryRows(payload.schema?.fields, payload.rows);
};

const normalizeBillingAccountId = (): string => {
  const raw = asString(process.env.VF_ADMIN_GCP_BILLING_ACCOUNT_ID);
  if (!raw) return '';
  return raw.startsWith('billingAccounts/') ? raw : `billingAccounts/${raw}`;
};

const moneyToSpecifiedAmount = (amountInr: number) => {
  const normalized = Math.max(0, asNumber(amountInr));
  const units = Math.trunc(normalized);
  const nanos = Math.round((normalized - units) * 1_000_000_000);
  return {
    currencyCode: 'INR',
    units: String(units),
    nanos,
  };
};

const normalizeGcpBudget = (budget: Record<string, unknown>): ExternalBudgetRecord => {
  const specified = (budget.amount as { specifiedAmount?: { units?: string; nanos?: number } } | undefined)?.specifiedAmount || {};
  const units = asNumber(specified.units);
  const nanos = asNumber(specified.nanos) / 1_000_000_000;
  const thresholdRules = Array.isArray(budget.thresholdRules) ? budget.thresholdRules as Array<Record<string, unknown>> : [];
  const sortedThresholds = thresholdRules
    .map((item) => asPositiveNumber(item.thresholdPercent) * 100)
    .filter((value) => value > 0)
    .sort((left, right) => left - right);
  const externalRef = asString(budget.name);
  const suffix = externalRef.split('/').pop() || asString(budget.displayName) || 'gcp-budget';
  return {
    budgetId: `gcp_${suffix}`,
    name: asString(budget.displayName) || suffix,
    amountInr: roundInr(units + nanos),
    warningPct: sortedThresholds[0] || 80,
    criticalPct: sortedThresholds[sortedThresholds.length - 1] || 100,
    scopeType: 'provider',
    scopeKey: 'gcp',
    source: 'gcp_budget_api',
    readOnly: !(readEnvBoolean(process.env.VF_ADMIN_GCP_BILLING_BUDGET_WRITE) ?? false),
    externalRef,
    status: 'ok',
    currency: 'INR',
    metadata: {
      budgetFilter: budget.budgetFilter || null,
    },
  };
};

export const listGcpBudgetRecords = async (): Promise<ExternalBudgetRecord[]> => {
  const billingAccountId = normalizeBillingAccountId();
  if (!billingAccountId) return [];
  const accessToken = await fetchGoogleAccessToken();
  const response = await fetch(`https://billingbudgets.googleapis.com/v1/${billingAccountId}/budgets`, {
    headers: {
      authorization: `Bearer ${accessToken}`,
    },
  });
  if (!response.ok) {
    throw new Error(`GCP Budget API request failed (${response.status})`);
  }
  const payload = await response.json() as { budgets?: Array<Record<string, unknown>> };
  return Array.isArray(payload.budgets) ? payload.budgets.map(normalizeGcpBudget) : [];
};

export const createOrUpdateGcpBudgetRecord = async (
  input: {
    budgetId?: string;
    name: string;
    amountInr: number;
    warningPct: number;
    criticalPct: number;
    externalRef?: string;
  },
): Promise<ExternalBudgetRecord> => {
  const billingAccountId = normalizeBillingAccountId();
  if (!billingAccountId) {
    throw new Error('VF_ADMIN_GCP_BILLING_ACCOUNT_ID is required to manage GCP budgets.');
  }
  if (!(readEnvBoolean(process.env.VF_ADMIN_GCP_BILLING_BUDGET_WRITE) ?? false)) {
    throw new Error('GCP budget write mode is disabled. Set VF_ADMIN_GCP_BILLING_BUDGET_WRITE=1 to enable live budget writes.');
  }

  const accessToken = await fetchGoogleAccessToken();
  const normalizedWarning = Math.max(1, Math.min(99, asPositiveNumber(input.warningPct)));
  const normalizedCritical = Math.max(normalizedWarning, Math.min(200, asPositiveNumber(input.criticalPct || 100)));
  const body = {
    displayName: asString(input.name) || 'V FLOW budget',
    amount: {
      specifiedAmount: moneyToSpecifiedAmount(asPositiveNumber(input.amountInr)),
    },
    budgetFilter: {
      calendarPeriod: 'MONTH',
    },
    thresholdRules: [
      { thresholdPercent: normalizedWarning / 100 },
      { thresholdPercent: normalizedCritical / 100 },
    ],
  };

  const endpoint = input.externalRef
    ? `https://billingbudgets.googleapis.com/v1/${input.externalRef}?updateMask=displayName,amount,thresholdRules,budgetFilter`
    : `https://billingbudgets.googleapis.com/v1/${billingAccountId}/budgets`;
  const response = await fetch(endpoint, {
    method: input.externalRef ? 'PATCH' : 'POST',
    headers: {
      authorization: `Bearer ${accessToken}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(input.externalRef ? { name: input.externalRef, ...body } : body),
  });
  if (!response.ok) {
    throw new Error(`GCP budget ${input.externalRef ? 'update' : 'create'} failed (${response.status})`);
  }
  const payload = await response.json() as Record<string, unknown>;
  return normalizeGcpBudget(payload);
};

export const syncGcpProviderSnapshot = async (): Promise<{ snapshot: ProviderSnapshot; budgets: ExternalBudgetRecord[] }> => {
  const exportTable = asString(process.env.VF_ADMIN_GCP_BILLING_EXPORT_TABLE);
  const lastAttemptAt = nowIso();
  if (!exportTable) {
    return {
      snapshot: {
        provider: 'gcp',
        displayName: 'Google Cloud',
        source: 'gcp_bigquery_export',
        configured: false,
        supported: true,
        status: 'missing',
        stale: true,
        currency: 'INR',
        actualWindows: { todayInr: 0, last7dInr: 0, monthInr: 0, trailing30dInr: 0 },
        series: [],
        topDrivers: [],
        providerCoverage: 0,
        lastAttemptAt,
        detail: 'Configure VF_ADMIN_GCP_BILLING_EXPORT_TABLE to sync actual GCP billing.',
      },
      budgets: [],
    };
  }

  try {
    const projectId = normalizeBigQueryProjectId();
    const rows = await executeBigQueryQuery(projectId, `
      WITH base AS (
        SELECT
          FORMAT_DATE('%Y-%m-%d', DATE(usage_start_time)) AS bucket,
          COALESCE(service.description, 'Unknown') AS service_name,
          COALESCE(sku.description, 'Unknown') AS sku_name,
          ANY_VALUE(currency) AS currency,
          SUM(CAST(cost AS FLOAT64) + IFNULL((SELECT SUM(CAST(c.amount AS FLOAT64)) FROM UNNEST(credits) c), 0)) AS amount
        FROM \`${exportTable}\`
        WHERE usage_start_time >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 35 DAY)
        GROUP BY 1, 2, 3
      )
      SELECT bucket, service_name, sku_name, currency, ROUND(amount, 4) AS amount
      FROM base
      WHERE amount != 0
      ORDER BY bucket DESC, amount DESC
    `);

    const snapshotRows = rows.map((row) => {
      const amountInr = convertAmountToInr(asNumber(row.amount), asString(row.currency) || 'INR');
      return {
        bucket: asString(row.bucket),
        amountInr,
        label: asString(row.service_name) || 'Google Cloud',
        detail: asString(row.sku_name),
      };
    });
    const resolvedBudgets = normalizeBillingAccountId()
      ? await listGcpBudgetRecords().catch(() => [])
      : [];
    return {
      snapshot: buildSnapshotFromRows('gcp', 'Google Cloud', 'gcp_bigquery_export', snapshotRows, {
        configured: true,
        supported: true,
        lastAttemptAt,
        detail: `Synced ${snapshotRows.length.toLocaleString()} billing rows from BigQuery export.`,
      }),
      budgets: resolvedBudgets,
    };
  } catch (error) {
    return {
      snapshot: {
        provider: 'gcp',
        displayName: 'Google Cloud',
        source: 'gcp_bigquery_export',
        configured: true,
        supported: true,
        status: 'warning',
        stale: true,
        currency: 'INR',
        actualWindows: { todayInr: 0, last7dInr: 0, monthInr: 0, trailing30dInr: 0 },
        series: [],
        topDrivers: [],
        providerCoverage: 0,
        lastAttemptAt,
        detail: `GCP billing sync failed: ${error instanceof Error ? error.message : 'unknown error'}`,
      },
      budgets: [],
    };
  }
};

const readModalReportPayload = async (): Promise<Record<string, unknown> | null> => {
  const reportFile = asString(process.env.VF_ADMIN_MODAL_BILLING_REPORT_FILE);
  if (reportFile) {
    const resolved = path.resolve(reportFile);
    const raw = fs.readFileSync(resolved, 'utf8');
    return JSON.parse(raw) as Record<string, unknown>;
  }

  const reportUrl = asString(process.env.VF_ADMIN_MODAL_BILLING_REPORT_URL);
  if (!reportUrl) return null;

  const headers = new Headers();
  const token = asString(readEnvValue(
    process.env.VF_ADMIN_MODAL_BILLING_TOKEN,
    process.env.VF_VOICE_CLONE_MODAL_RUNTIME_TOKEN,
  ));
  if (token) {
    headers.set('authorization', `Bearer ${token}`);
  }
  const response = await fetch(reportUrl, { headers });
  if (!response.ok) {
    throw new Error(`Modal billing report request failed (${response.status})`);
  }
  return response.json() as Promise<Record<string, unknown>>;
};

const normalizeModalRows = (payload: Record<string, unknown>): Array<{ bucket: string; amountInr: number; label: string; detail?: string }> => {
  const candidates = (
    Array.isArray(payload.items) ? payload.items
      : Array.isArray(payload.rows) ? payload.rows
        : Array.isArray(payload.entries) ? payload.entries
          : Array.isArray(payload.series) ? payload.series
            : []
  ) as Array<Record<string, unknown>>;

  return candidates.map((item) => {
    const currency = asString(item.currency || payload.currency || 'USD');
    const bucket = asString(
      item.bucket
      || item.date
      || item.day
      || item.periodStart
      || item.timestamp,
    ).slice(0, 10);
    const label = asString(
      item.label
      || item.service
      || item.app
      || item.function
      || item.tag
      || item.sku,
    ) || 'Modal';
    const detail = asString(item.detail || item.environment || item.workspace || item.project) || undefined;
    const rawAmount = asNumber(
      item.amountInr
      ?? item.amount
      ?? item.cost
      ?? item.total
      ?? item.spend
      ?? item.totalUsd
      ?? item.usd,
    );
    return {
      bucket,
      amountInr: convertAmountToInr(rawAmount, currency),
      label,
      ...(detail ? { detail } : {}),
    };
  }).filter((item) => item.bucket);
};

export const syncModalProviderSnapshot = async (): Promise<{ snapshot: ProviderSnapshot }> => {
  const lastAttemptAt = nowIso();
  const hasConfig = Boolean(
    asString(process.env.VF_ADMIN_MODAL_BILLING_REPORT_URL)
    || asString(process.env.VF_ADMIN_MODAL_BILLING_REPORT_FILE)
  );
  if (!hasConfig) {
    return {
      snapshot: {
        provider: 'modal',
        displayName: 'Modal',
        source: 'modal_billing_report',
        configured: false,
        supported: true,
        status: 'missing',
        stale: true,
        currency: 'INR',
        actualWindows: { todayInr: 0, last7dInr: 0, monthInr: 0, trailing30dInr: 0 },
        series: [],
        topDrivers: [],
        providerCoverage: 0,
        lastAttemptAt,
        detail: 'Configure VF_ADMIN_MODAL_BILLING_REPORT_URL or VF_ADMIN_MODAL_BILLING_REPORT_FILE to sync actual Modal billing.',
      },
    };
  }

  try {
    const payload = await readModalReportPayload();
    const rows = payload ? normalizeModalRows(payload) : [];
    return {
      snapshot: buildSnapshotFromRows('modal', 'Modal', 'modal_billing_report', rows, {
        configured: true,
        supported: true,
        lastAttemptAt,
        detail: rows.length > 0
          ? `Synced ${rows.length.toLocaleString()} Modal billing entries.`
          : 'Modal billing sync completed with no billable rows.',
      }),
    };
  } catch (error) {
    return {
      snapshot: {
        provider: 'modal',
        displayName: 'Modal',
        source: 'modal_billing_report',
        configured: true,
        supported: true,
        status: 'warning',
        stale: true,
        currency: 'INR',
        actualWindows: { todayInr: 0, last7dInr: 0, monthInr: 0, trailing30dInr: 0 },
        series: [],
        topDrivers: [],
        providerCoverage: 0,
        lastAttemptAt,
        detail: `Modal billing sync failed: ${error instanceof Error ? error.message : 'unknown error'}`,
      },
    };
  }
};
