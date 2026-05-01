-- Migration 001: Create account tables
-- Source: frontend/src/server/account/service.ts
-- Consolidates all account-related tables from inline schema definitions.

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
