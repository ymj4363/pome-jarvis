CREATE TABLE partners (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'customer' CHECK (kind IN ('customer','intermediary','vendor')),
  memo TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE TABLE ledger_entries (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('sale','purchase')),
  sale_type TEXT CHECK (sale_type IN ('direct','commission')),
  partner_id TEXT NOT NULL REFERENCES partners(id),
  title TEXT NOT NULL,
  amount INTEGER NOT NULL,
  base_amount INTEGER,
  commission_rate REAL,
  invoice_status TEXT NOT NULL DEFAULT 'none' CHECK (invoice_status IN ('none','issued','received')),
  invoice_date TEXT,
  due_date TEXT,
  paid_date TEXT,
  paid_amount INTEGER,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','paid','canceled')),
  recurring_rule_id TEXT,
  period TEXT,
  memo TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX idx_entries_rule_period ON ledger_entries(recurring_rule_id, period)
  WHERE recurring_rule_id IS NOT NULL;
CREATE INDEX idx_entries_due ON ledger_entries(status, due_date);

CREATE TABLE recurring_rules (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('sale','purchase')),
  sale_type TEXT CHECK (sale_type IN ('direct','commission')),
  partner_id TEXT NOT NULL REFERENCES partners(id),
  title TEXT NOT NULL,
  amount INTEGER NOT NULL,
  base_amount INTEGER,
  commission_rate REAL,
  day_of_month INTEGER NOT NULL CHECK (day_of_month BETWEEN 1 AND 31),
  active INTEGER NOT NULL DEFAULT 1,
  memo TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
