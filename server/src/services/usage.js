const db = require('../db');
const { randomUUID } = require('crypto');
const MB = 1024 * 1024;
function expire(userId) { db.prepare("UPDATE entitlements SET status='expired' WHERE user_id=? AND status='active' AND expires_at<=?").run(userId, Date.now()); }
function getQuotaSummary(userId) {
  expire(userId);
  const summary = db.prepare("SELECT COALESCE(SUM(quota_mb),0) quota_total_mb, COALESCE(SUM(used_mb),0) quota_used_mb, COALESCE(SUM(CASE WHEN status='active' THEN MAX(0,quota_mb-used_mb) ELSE 0 END),0) remaining_mb, COALESCE(SUM(CASE WHEN status='active' AND used_mb<quota_mb THEN 1 ELSE 0 END),0) active_count FROM entitlements WHERE user_id=? AND status IN ('active','exhausted') AND expires_at>?").get(userId, Date.now());
  return summary;
}
const hasActiveQuota = userId => getQuotaSummary(userId).remaining_mb > 0;
const consumeTraffic = db.transaction((userId, bytes) => {
  // Keep sub-byte/MB precision in storage: rounding per request makes small requests free.
  if (!Number.isSafeInteger(bytes) || bytes < 0) throw new Error('Invalid traffic bytes');
  expire(userId);
  let remaining = bytes / MB;
  const rows = db.prepare("SELECT id,quota_mb,used_mb FROM entitlements WHERE user_id=? AND status='active' AND expires_at>? AND used_mb<quota_mb ORDER BY expires_at,id").all(userId, Date.now());
  for (const row of rows) {
    if (remaining <= 0) break;
    const take = Math.min(remaining, row.quota_mb - row.used_mb);
    const next = row.used_mb + take;
    db.prepare('UPDATE entitlements SET used_mb=?,status=? WHERE id=?').run(next, next >= row.quota_mb ? 'exhausted' : 'active', row.id);
    remaining -= take;
  }
  return { ok: true, recorded_mb: bytes / MB, consumed_mb: bytes / MB - remaining, remaining_mb: getQuotaSummary(userId).remaining_mb };
});
function recordUsage({ userId, keyId, ipId, bytesIn, bytesOut }) {
  if (!bytesIn && !bytesOut) return;
  db.prepare('INSERT INTO usage_records(id,user_id,key_id,ip_id,bytes_in,bytes_out,created_at) VALUES(?,?,?,?,?,?,?)').run(randomUUID(), userId, keyId, ipId, bytesIn, bytesOut, Date.now());
}
function addGiftEntitlement(userId, mb) {
  if (!Number.isFinite(mb) || mb <= 0) return;
  db.prepare("INSERT INTO entitlements(id,user_id,source,quota_mb,expires_at,created_at) VALUES(?,?,'gift',?,?,?)").run(randomUUID(), userId, mb, Date.now() + 30 * 86400000, Date.now());
}
module.exports = { getQuotaSummary, hasActiveQuota, consumeTraffic, recordUsage, addGiftEntitlement };
