/**
 * Migration registry.
 *
 * This file is the canonical migration source for the runtime. Each entry
 * corresponds to a `.sql` file in this directory. The SQL strings are
 * embedded here so the migration runner works in both Node.js (dev) and
 * Cloudflare Workers (edge) without filesystem access.
 *
 * IMPORTANT: When adding a new `.sql` migration file, add a corresponding
 * entry in the `migrationFiles` array below. Keep the filename prefix
 * numbering sequential and the array sorted in apply order.
 */

export interface MigrationFile {
  /** Filename with numeric prefix, e.g. "001_create_account_tables.sql" */
  readonly filename: string;
  /** SQL content to execute */
  readonly sql: string;
}

export const migrationFiles: MigrationFile[] = [
  {
    filename: '001_create_account_tables.sql',
    sql: `
CREATE TABLE IF NOT EXISTS account_profiles (
  uid TEXT PRIMARY KEY NOT NULL,
  payload_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS account_user_id_index (
  user_id TEXT PRIMARY KEY NOT NULL,
  uid TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS account_entitlements (
  uid TEXT PRIMARY KEY NOT NULL,
  payload_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS account_notification_preferences (
  uid TEXT PRIMARY KEY NOT NULL,
  payload_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS account_support_conversations (
  conversation_id TEXT PRIMARY KEY NOT NULL,
  uid TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS account_support_conversations_uid_updated_at_idx
  ON account_support_conversations (uid, updated_at DESC, conversation_id DESC);

CREATE TABLE IF NOT EXISTS account_support_messages (
  message_id TEXT PRIMARY KEY NOT NULL,
  conversation_id TEXT NOT NULL,
  uid TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS account_support_messages_conversation_created_at_idx
  ON account_support_messages (conversation_id, created_at ASC, message_id ASC);

CREATE TABLE IF NOT EXISTS account_coupons (
  coupon_id TEXT PRIMARY KEY NOT NULL,
  payload_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS account_coupons_code_idx ON account_coupons (
  json_extract(payload_json, '$.code')
);

CREATE TABLE IF NOT EXISTS account_characters (
  uid TEXT NOT NULL,
  char_id TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (uid, char_id)
);

CREATE INDEX IF NOT EXISTS account_characters_uid_idx ON account_characters(uid);
`.trim(),
  },
  {
    filename: '002_create_reader_legal_ack.sql',
    sql: `
CREATE TABLE IF NOT EXISTS reader_legal_ack (
  uid TEXT PRIMARY KEY NOT NULL,
  payload_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
`.trim(),
  },
  {
    filename: '003_create_voice_clone_artifacts.sql',
    sql: `
CREATE TABLE IF NOT EXISTS voice_clone_artifacts (
  id TEXT PRIMARY KEY NOT NULL,
  owner_uid TEXT NOT NULL,
  download_url TEXT NOT NULL,
  file_name TEXT,
  content_type TEXT,
  created_at TEXT NOT NULL
);
`.trim(),
  },
  {
    filename: '004_create_billing_tables.sql',
    sql: `
CREATE TABLE IF NOT EXISTS billing_operations (
  id TEXT PRIMARY KEY NOT NULL,
  uid TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS billing_webhook_events (
  id TEXT PRIMARY KEY NOT NULL,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS billing_stripe_customers (
  customer_id TEXT PRIMARY KEY NOT NULL,
  uid TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS billing_coupons (
  code TEXT PRIMARY KEY NOT NULL,
  payload_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS billing_coupon_redemptions (
  redemption_id TEXT PRIMARY KEY NOT NULL,
  uid TEXT NOT NULL,
  coupon_id TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS billing_wallet_transactions (
  transaction_id TEXT PRIMARY KEY NOT NULL,
  uid TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
`.trim(),
  },
];
