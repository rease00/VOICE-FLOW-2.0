-- Migration 003: Create voice clone artifacts table
-- Source: frontend/src/server/voiceClone/service.ts

CREATE TABLE IF NOT EXISTS voice_clone_artifacts (
  id TEXT PRIMARY KEY NOT NULL,
  owner_uid TEXT NOT NULL,
  download_url TEXT NOT NULL,
  file_name TEXT,
  content_type TEXT,
  created_at TEXT NOT NULL
);
