const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const config = require('../config');

fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });

const db = new Database(config.dbPath);
db.pragma('journal_mode = WAL');
db.pragma('busy_timeout = 5000');

db.exec(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));
// Additive migrations preserve an existing installation and all financial data.
const columns = table => new Set(db.prepare(`PRAGMA table_info(${table})`).all().map(row => row.name));
if (!columns('users').has('token_version')) db.exec('ALTER TABLE users ADD COLUMN token_version INTEGER NOT NULL DEFAULT 0');
if (!columns('email_codes').has('attempts')) db.exec('ALTER TABLE email_codes ADD COLUMN attempts INTEGER NOT NULL DEFAULT 0');
if (!columns('orders').has('request_key')) db.exec("ALTER TABLE orders ADD COLUMN request_key TEXT NOT NULL DEFAULT ''");
for (const [field, declaration] of Object.entries({ kind: "TEXT NOT NULL DEFAULT 'legacy'", quantity: 'INTEGER NOT NULL DEFAULT 1', duration_days: 'INTEGER NOT NULL DEFAULT 0', product_id: "TEXT NOT NULL DEFAULT ''", rental_id: "TEXT NOT NULL DEFAULT ''" })) {
  if (!columns('orders').has(field)) db.exec(`ALTER TABLE orders ADD COLUMN ${field} ${declaration}`);
}
db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_order_request ON orders(user_id,request_key) WHERE request_key<>''; CREATE UNIQUE INDEX IF NOT EXISTS idx_recharge_ledger ON ledger(ref_id) WHERE ref_type='recharge' AND type='recharge'; CREATE INDEX IF NOT EXISTS idx_email_code ON email_codes(email,purpose,created_at)");

const userCount = db.prepare('SELECT COUNT(*) AS c FROM users').get().c;
if (userCount === 0) {
  db.transaction(() => require('./seed')(db))();
}
if (!db.prepare("SELECT key FROM settings WHERE key='static_model_v1'").get()) {
  db.transaction(() => {
    db.prepare("UPDATE packages SET status='disabled'").run();
    db.prepare("INSERT INTO settings(key,value) VALUES('register_gift_mb','0') ON CONFLICT(key) DO UPDATE SET value='0'").run();
    db.prepare("INSERT INTO settings(key,value) VALUES('static_model_v1','1')").run();
  })();
}

module.exports = db;
