// Only the dedicated encrypted-vault namespace initializes these tables.
export const CLOUD_VAULT_SCHEMA = `
CREATE TABLE IF NOT EXISTS private_vaults (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL,
  envelope TEXT NOT NULL CHECK(length(envelope) <= 1700000),
  revision INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS private_vault_history (
  vault_id TEXT NOT NULL REFERENCES private_vaults(id) ON DELETE CASCADE,
  revision INTEGER NOT NULL,
  envelope TEXT NOT NULL CHECK(length(envelope) <= 1700000),
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (vault_id, revision)
);
CREATE TABLE IF NOT EXISTS private_vault_limits (
  bucket TEXT PRIMARY KEY,
  count INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS private_vault_limits_expiry ON private_vault_limits(expires_at);
`;
