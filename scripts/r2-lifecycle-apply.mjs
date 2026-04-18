#!/usr/bin/env node
/**
 * Apply lifecycle rules to Cloudflare R2 buckets via S3 API.
 * Run once after bucket creation (idempotent).
 *
 *   node scripts/r2-lifecycle-apply.mjs
 *
 * Required env (from .env.local or shell):
 *   R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY
 *   R2_BUCKET (defaults to vf-assets)
 */
import { S3Client, PutBucketLifecycleConfigurationCommand } from "@aws-sdk/client-s3";

const accountId = process.env.R2_ACCOUNT_ID;
const accessKeyId = process.env.R2_ACCESS_KEY_ID;
const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
const bucket = process.env.R2_BUCKET ?? "vf-assets";

if (!accountId || !accessKeyId || !secretAccessKey) {
  console.error("missing R2 credentials (R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY)");
  process.exit(1);
}

const client = new S3Client({
  region: "auto",
  endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId, secretAccessKey },
});

const Rules = [
  {
    ID: "tts-live-24h",
    Status: "Enabled",
    Filter: { Prefix: "tts-live/" },
    Expiration: { Days: 1 },
    AbortIncompleteMultipartUpload: { DaysAfterInitiation: 1 },
  },
  {
    ID: "reader-sessions-7d",
    Status: "Enabled",
    Filter: { Prefix: "reader-sessions/" },
    Expiration: { Days: 7 },
  },
  {
    ID: "dubbing-live-3d",
    Status: "Enabled",
    Filter: { Prefix: "dubbing-live/" },
    Expiration: { Days: 3 },
  },
  {
    ID: "audit-90d",
    Status: "Enabled",
    Filter: { Prefix: "audit/" },
    Expiration: { Days: 90 },
  },
  {
    ID: "vault-imports-warning",
    Status: "Enabled",
    Filter: { Prefix: "users/" },
    // Vault enforcement is handled by the daily Cloud Scheduler "vault-sweeper"
    // job (it knows per-user subscription state). This rule only cleans
    // multipart upload garbage so we don't pay for orphans.
    AbortIncompleteMultipartUpload: { DaysAfterInitiation: 7 },
  },
];

const command = new PutBucketLifecycleConfigurationCommand({
  Bucket: bucket,
  LifecycleConfiguration: { Rules },
});

try {
  await client.send(command);
  console.log(`✓ Applied ${Rules.length} lifecycle rules to bucket "${bucket}"`);
  for (const r of Rules) {
    const expiry = r.Expiration ? `${r.Expiration.Days}d` : "n/a";
    console.log(`  · ${r.ID.padEnd(28)} prefix=${r.Filter.Prefix.padEnd(20)} expires=${expiry}`);
  }
} catch (err) {
  console.error(`✗ Failed: ${err.message}`);
  process.exit(1);
}
