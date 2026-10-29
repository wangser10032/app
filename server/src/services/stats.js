const db = require('../db');
function weekSeries(table, amount, userId) {
  const result = [];
  for (let i = 6; i >= 0; i--) {
    const start = new Date(); start.setHours(0, 0, 0, 0); start.setDate(start.getDate() - i);
    const end = new Date(start); end.setDate(end.getDate() + 1);
    const where = table === 'recharges' ? "AND status='paid'" : '';
    const time = table === 'recharges' ? 'paid_at' : 'created_at';
    const row = db.prepare(`SELECT COALESCE(SUM(${amount}),0) value FROM ${table} WHERE ${time}>=? AND ${time}<? ${where} ${userId ? 'AND user_id=?' : ''}`).get(...[+start, +end, ...(userId ? [userId] : [])]);
    result.push({ date: `${String(start.getMonth() + 1).padStart(2, '0')}-${String(start.getDate()).padStart(2, '0')}`, value: row.value });
  }
  return result;
}
function usageSummary(userId) {
  return { week: weekSeries('usage_records', '(bytes_in+bytes_out)/1048576.0', userId).map(r => ({ date: r.date, mb: r.value })), total_mb: db.prepare('SELECT COALESCE(SUM(bytes_in+bytes_out),0)/1048576.0 mb FROM usage_records WHERE user_id=?').get(userId).mb };
}
function getStats() {
  require('./static-rentals').expireRentals();
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const count = (sql, ...params) => db.prepare(sql).get(...params).n;
  return {
    user_count: count('SELECT COUNT(*) n FROM users'),
    today_new_users: count('SELECT COUNT(*) n FROM users WHERE created_at>=?', +today),
    recharge_total_cents: count("SELECT COALESCE(SUM(amount_cents),0) n FROM recharges WHERE status='paid'"),
    recharge_today_cents: count("SELECT COALESCE(SUM(amount_cents),0) n FROM recharges WHERE status='paid' AND paid_at>=?", +today),
    order_count: count('SELECT COUNT(*) n FROM orders'),
    ip_active: count("SELECT COUNT(*) n FROM ip_pool WHERE status='active'"),
    ip_total: count('SELECT COUNT(*) n FROM ip_pool'),
    total_static_ips: count('SELECT COUNT(*) n FROM static_rentals'),
    active_static_ips: count("SELECT COUNT(*) n FROM static_rentals r JOIN ip_pool p ON p.id=r.ip_id WHERE r.status='active' AND r.expires_at>? AND p.status='active'", Date.now()),
    expiring_static_ips: count("SELECT COUNT(*) n FROM static_rentals r JOIN ip_pool p ON p.id=r.ip_id WHERE r.status='active' AND r.expires_at>? AND r.expires_at<=? AND p.status='active'", Date.now(), Date.now() + 7 * 86400000),
    available_static_ips: count("SELECT COUNT(*) n FROM ip_pool p WHERE p.status='active' AND NOT EXISTS (SELECT 1 FROM static_rentals r WHERE r.ip_id=p.id AND r.status IN ('active','disabled') AND r.expires_at>?)", Date.now()),
    pending_recharge_count: count("SELECT COUNT(*) n FROM recharges WHERE status='pending'"),
    recharge_week: weekSeries('recharges', 'amount_cents').map(r => ({ date: r.date, cents: r.value })),
  };
}
module.exports = { getStats, usageSummary };
