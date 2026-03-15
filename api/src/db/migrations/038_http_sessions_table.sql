-- Create table for express-session (used by csrf-sync for CSRF token storage).
-- This replaces the default in-memory MemoryStore, which leaks memory and
-- loses all CSRF tokens on server restart.
-- Schema follows connect-pg-simple conventions: sid (PK), sess (JSON), expire (timestamp).
CREATE TABLE IF NOT EXISTS http_sessions (
  sid VARCHAR NOT NULL PRIMARY KEY,
  sess JSON NOT NULL,
  expire TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_http_sessions_expire ON http_sessions (expire);
