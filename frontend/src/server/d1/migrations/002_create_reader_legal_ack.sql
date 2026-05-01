-- Migration 002: Create reader legal acknowledgement table
-- Source: frontend/src/server/account/readerLegalAck.ts

CREATE TABLE IF NOT EXISTS reader_legal_ack (
  uid TEXT PRIMARY KEY NOT NULL,
  payload_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
