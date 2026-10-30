CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  nickname TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL DEFAULT 'user',
  status TEXT NOT NULL DEFAULT 'active',
  balance_cents INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  last_login_at INTEGER
);

CREATE TABLE IF NOT EXISTS email_codes (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  code TEXT NOT NULL,
  purpose TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at INTEGER,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS human_challenges (
  id TEXT PRIMARY KEY,
  purpose TEXT NOT NULL,
  answer_hash TEXT NOT NULL,
  requester_hash TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_human_challenge_expiry ON human_challenges(expires_at);

CREATE TABLE IF NOT EXISTS packages (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  traffic_mb INTEGER NOT NULL,
  price_cents INTEGER NOT NULL,
  duration_days INTEGER NOT NULL DEFAULT 30,
  status TEXT NOT NULL DEFAULT 'active',
  sort INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS recharges (
  id TEXT PRIMARY KEY,
  recharge_no TEXT UNIQUE NOT NULL,
  user_id TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  channel TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  pay_url TEXT NOT NULL DEFAULT '',
  qr_content TEXT NOT NULL DEFAULT '',
  out_trade_no TEXT NOT NULL DEFAULT '',
  paid_at INTEGER,
  created_at INTEGER NOT NULL,
  meta TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  order_no TEXT UNIQUE NOT NULL,
  user_id TEXT NOT NULL,
  package_id TEXT NOT NULL,
  package_name TEXT NOT NULL,
  traffic_mb INTEGER NOT NULL,
  amount_cents INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'paid',
  paid_at INTEGER,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS entitlements (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  order_id TEXT,
  source TEXT NOT NULL DEFAULT 'order',
  quota_mb REAL NOT NULL,
  used_mb REAL NOT NULL DEFAULT 0,
  expires_at INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS ledger (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  type TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  balance_after_cents INTEGER NOT NULL,
  ref_type TEXT NOT NULL DEFAULT '',
  ref_id TEXT NOT NULL DEFAULT '',
  remark TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS proxy_keys (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  label TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active',
  country_filter TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  last_used_at INTEGER
);

CREATE TABLE IF NOT EXISTS ip_pool (
  id TEXT PRIMARY KEY,
  host TEXT NOT NULL,
  port INTEGER NOT NULL,
  protocol TEXT NOT NULL DEFAULT 'http',
  upstream_user TEXT NOT NULL DEFAULT '',
  upstream_pass TEXT NOT NULL DEFAULT '',
  country TEXT NOT NULL DEFAULT '',
  region TEXT NOT NULL DEFAULT '',
  city TEXT NOT NULL DEFAULT '',
  isp TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active',
  fail_count INTEGER NOT NULL DEFAULT 0,
  last_ok_at INTEGER,
  last_check_at INTEGER,
  created_at INTEGER NOT NULL,
  UNIQUE(host, port)
);

CREATE TABLE IF NOT EXISTS usage_records (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  key_id TEXT NOT NULL,
  ip_id TEXT NOT NULL,
  bytes_in INTEGER NOT NULL DEFAULT 0,
  bytes_out INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_usage_user ON usage_records(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_ledger_user ON ledger(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_recharge_user ON recharges(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_ip_country ON ip_pool(country, status);

CREATE TABLE IF NOT EXISTS static_products (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  country TEXT NOT NULL DEFAULT '',
  region TEXT NOT NULL DEFAULT '',
  city TEXT NOT NULL DEFAULT '',
  isp TEXT NOT NULL DEFAULT '',
  protocol TEXT NOT NULL DEFAULT 'http',
  duration_days INTEGER NOT NULL,
  price_cents INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  sort INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS static_rentals (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  initial_order_id TEXT NOT NULL,
  ip_id TEXT NOT NULL,
  product_name TEXT NOT NULL,
  country TEXT NOT NULL DEFAULT '',
  region TEXT NOT NULL DEFAULT '',
  city TEXT NOT NULL DEFAULT '',
  isp TEXT NOT NULL DEFAULT '',
  protocol TEXT NOT NULL,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  password_encrypted TEXT NOT NULL,
  remark TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active',
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_static_exclusive ON static_rentals(ip_id) WHERE status IN ('active','disabled');
CREATE INDEX IF NOT EXISTS idx_static_user ON static_rentals(user_id,created_at);
CREATE INDEX IF NOT EXISTS idx_static_product ON static_rentals(product_id);
CREATE INDEX IF NOT EXISTS idx_static_order ON static_rentals(initial_order_id);
