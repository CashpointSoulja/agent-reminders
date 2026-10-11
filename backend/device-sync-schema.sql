-- Opt-in personal device bridge. Install locally before DEVICE_SYNC=1.
CREATE TABLE IF NOT EXISTS device_pairings (
  id TEXT PRIMARY KEY, token_hash TEXT NOT NULL UNIQUE, code_hash TEXT NOT NULL,
  name TEXT NOT NULL, manifest TEXT NOT NULL, created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL, approved_at INTEGER
);
CREATE TABLE IF NOT EXISTS device_pairing_limits (
  ip_hash TEXT PRIMARY KEY, window_start INTEGER NOT NULL, attempts INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS devices (
  id TEXT PRIMARY KEY, token_hash TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
  grants TEXT NOT NULL, active_lists TEXT NOT NULL, writeback_lists TEXT NOT NULL DEFAULT '[]',
  grant_version INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL, revoked_at INTEGER
);
CREATE TABLE IF NOT EXISTS device_mappings (
  id TEXT PRIMARY KEY, device_id TEXT NOT NULL REFERENCES devices(id),
  kind TEXT NOT NULL CHECK(kind IN ('list','reminder')), source_list_id TEXT NOT NULL,
  source_id TEXT NOT NULL, web_id TEXT NOT NULL, source_hash TEXT NOT NULL,
  web_hash TEXT NOT NULL, source_record TEXT NOT NULL, missing INTEGER NOT NULL DEFAULT 0,
  UNIQUE(device_id,kind,source_list_id,source_id)
);
CREATE INDEX IF NOT EXISTS device_mappings_web ON device_mappings(web_id);
CREATE TABLE IF NOT EXISTS device_import_receipts (
  device_id TEXT NOT NULL REFERENCES devices(id), request_key TEXT NOT NULL,
  request_hash TEXT NOT NULL, receipt TEXT NOT NULL, created_at INTEGER NOT NULL,
  PRIMARY KEY(device_id,request_key)
);
CREATE TABLE IF NOT EXISTS device_task_bindings (
  task_id TEXT PRIMARY KEY, mapping_id TEXT NOT NULL REFERENCES device_mappings(id),
  source_hash TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS device_commands (
  id TEXT PRIMARY KEY, device_id TEXT NOT NULL REFERENCES devices(id), task_id TEXT NOT NULL UNIQUE,
  mapping_id TEXT NOT NULL REFERENCES device_mappings(id), source_hash TEXT NOT NULL,
  grant_version INTEGER NOT NULL, web_hash TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'queued',
  created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, claim_id TEXT,
  claim_expires_at INTEGER, receipt TEXT
);
CREATE INDEX IF NOT EXISTS device_commands_device ON device_commands(device_id,status,created_at);
