CREATE TABLE IF NOT EXISTS subscriptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  url TEXT,
  content TEXT,
  target TEXT NOT NULL DEFAULT 'raw',
  user_agent TEXT,
  config_json TEXT NOT NULL DEFAULT '{}',
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_subscriptions_name ON subscriptions(name);
CREATE INDEX IF NOT EXISTS idx_subscriptions_enabled ON subscriptions(enabled);
