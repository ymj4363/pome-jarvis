CREATE TABLE auth_sessions (
  id TEXT PRIMARY KEY,
  refresh_token TEXT NOT NULL,
  email TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_used_at TEXT NOT NULL
);
CREATE INDEX idx_auth_sessions_last_used ON auth_sessions(last_used_at);
