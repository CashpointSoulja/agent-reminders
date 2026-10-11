CREATE TABLE IF NOT EXISTS state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  document TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 0,
  mutation TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS events (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  operation_id TEXT NOT NULL UNIQUE,
  type TEXT NOT NULL,
  payload TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS attachments (
  id TEXT PRIMARY KEY,
  reminder_id TEXT NOT NULL,
  object_key TEXT NOT NULL UNIQUE,
  filename TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS attachments_reminder ON attachments(reminder_id);
CREATE TABLE IF NOT EXISTS login_attempts (
  client_hash TEXT PRIMARY KEY,
  count INTEGER NOT NULL,
  window_start INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  nonce_hash TEXT PRIMARY KEY,
  expires INTEGER NOT NULL
);

-- Also reserves quota before an R2 write; active uploads become cleanup jobs after an hour.
CREATE TABLE IF NOT EXISTS pending_file_cleanup (
  object_key TEXT PRIMARY KEY,
  reminder_id TEXT NOT NULL,
  size INTEGER NOT NULL CHECK (size >= 0),
  ready_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS pending_file_cleanup_ready ON pending_file_cleanup(ready_at);

CREATE TABLE IF NOT EXISTS template_shares (
  template_id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  token_ciphertext TEXT NOT NULL,
  key_fingerprint TEXT NOT NULL,
  snapshot TEXT NOT NULL,
  options TEXT NOT NULL,
  source_fingerprint TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS template_attachments (
  id TEXT PRIMARY KEY,
  template_id TEXT NOT NULL,
  reminder_id TEXT NOT NULL,
  object_key TEXT NOT NULL UNIQUE,
  filename TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS template_attachments_template ON template_attachments(template_id, reminder_id);

-- Personal-instance agent access is separate from the owner's password/session.
CREATE TABLE IF NOT EXISTS agents (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  revoked_at TEXT
);
CREATE TABLE IF NOT EXISTS agent_credentials (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL REFERENCES agents(id),
  token_hash TEXT NOT NULL UNIQUE,
  scopes TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  revoked_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS agent_credentials_agent ON agent_credentials(agent_id);
CREATE TABLE IF NOT EXISTS agent_tasks (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE,
  agent_id TEXT NOT NULL REFERENCES agents(id),
  reminder_id TEXT NOT NULL,
  criteria TEXT NOT NULL,
  include_subtasks INTEGER NOT NULL CHECK (include_subtasks IN (0, 1)),
  authorized_ids TEXT NOT NULL,
  snapshot_hash TEXT NOT NULL,
  reminder_updated_at TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('queued', 'claimed', 'succeeded', 'failed', 'cancelled', 'needs_input', 'timed_out', 'superseded')),
  credential_id TEXT,
  claim_key_hash TEXT,
  claim_started_at INTEGER,
  lease_expires_at INTEGER,
  report_hash TEXT,
  result TEXT,
  mutation TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS agent_tasks_active_reminder ON agent_tasks(reminder_id) WHERE status IN ('queued', 'claimed');
CREATE INDEX IF NOT EXISTS agent_tasks_agent ON agent_tasks(agent_id, sequence);
CREATE INDEX IF NOT EXISTS agent_tasks_active_agent ON agent_tasks(agent_id, sequence) WHERE status IN ('queued', 'claimed');
CREATE TABLE IF NOT EXISTS agent_events (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  type TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS agent_events_agent ON agent_events(agent_id, sequence);
