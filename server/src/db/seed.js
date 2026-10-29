const crypto = require('crypto');
const bcrypt = require('bcryptjs');

// 首次启动种子数据：管理员 + 默认套餐 + 系统设置（见 docs/CONTRACT.md §1）
module.exports = function seed(db) {
  const now = Date.now();
  const email = (process.env.ADMIN_EMAIL || 'admin@resihub.local').trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD || (process.env.NODE_ENV === 'production' ? '' : 'Admin@123456');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || password.length < 12 || Buffer.byteLength(password) > 72) throw new Error('首次启动需要设置有效的 ADMIN_EMAIL 与至少 12 位的 ADMIN_PASSWORD');

  db.prepare(
    `INSERT INTO users (id, email, password_hash, nickname, role, status, balance_cents, created_at)
     VALUES (?, ?, ?, ?, 'admin', 'active', 0, ?)`
  ).run(crypto.randomUUID(), email, bcrypt.hashSync(password, 12), '管理员', now);

  const insSetting = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
  insSetting.run('site_name', 'ResiHub');
  insSetting.run('announcement', '');
  insSetting.run('register_gift_mb', '0');

  console.log('[seed] 已初始化管理员和站点设置；静态产品库存以实际 IP 池为准');
};
