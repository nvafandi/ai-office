PRAGMA journal_mode = WAL;

CREATE TABLE IF NOT EXISTS floors (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  repo TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  template TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS agents (
  id TEXT PRIMARY KEY,
  floor_id TEXT NOT NULL REFERENCES floors(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  role TEXT NOT NULL,
  stage TEXT NOT NULL,
  model TEXT NOT NULL,
  token_cap INTEGER NOT NULL DEFAULT 0,
  tokens_used INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS issues (
  id TEXT PRIMARY KEY,
  floor_id TEXT NOT NULL REFERENCES floors(id) ON DELETE CASCADE,
  number INTEGER NOT NULL,
  title TEXT NOT NULL,
  body TEXT,
  stage TEXT NOT NULL DEFAULT 'needs-work',
  assignee_id TEXT,
  pr_url TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS memories (
  id TEXT PRIMARY KEY,
  scope TEXT NOT NULL CHECK (scope IN ('office','floor','role')),
  scope_id TEXT NOT NULL,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ai_accounts (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL CHECK (provider IN ('claude','chatgpt','grok','ollama')),
  base_url TEXT NOT NULL,
  model TEXT NOT NULL,
  api_key TEXT,
  token_cap INTEGER NOT NULL DEFAULT 0,
  tokens_used INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_agents_floor ON agents(floor_id);
CREATE INDEX IF NOT EXISTS idx_issues_floor ON issues(floor_id);
CREATE INDEX IF NOT EXISTS idx_issues_stage ON issues(stage);
CREATE INDEX IF NOT EXISTS idx_memories_scope ON memories(scope, scope_id);

CREATE TABLE IF NOT EXISTS notices (
  id TEXT PRIMARY KEY,
  floor_id TEXT NOT NULL REFERENCES floors(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  author TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_notices_floor ON notices(floor_id);

CREATE TABLE IF NOT EXISTS github_installations (
  id TEXT PRIMARY KEY,
  installation_id INTEGER NOT NULL UNIQUE,
  account_login TEXT NOT NULL,
  encrypted_token TEXT NOT NULL,
  iv TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_github_installations_account ON github_installations(account_login);
