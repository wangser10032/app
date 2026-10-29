const db = require('../db');
const { randomUUID } = require('crypto');
const { genNo } = require('../utils');
const { fail } = require('../utils/errors');
const { addLedger } = require('./ledger');
const getByNo = no => db.prepare('SELECT * FROM recharges WHERE recharge_no=?').get(no);
function createRecharge(userId, amountCents, channel) {
  if (!Number.isSafeInteger(amountCents) || amountCents < 1000 || amountCents > 1000000 || !['alipay', 'wechat'].includes(channel)) fail(400, 'VALIDATION_ERROR', '充值金额应为 ¥10 至 ¥10,000');
  if (db.prepare("SELECT COUNT(*) c FROM recharges WHERE user_id=? AND status='pending' AND created_at>?").get(userId, Date.now() - 3600000).c >= 10) fail(429, 'RATE_LIMITED', '待支付充值单较多，请先完成支付或稍后再试');
  const id = randomUUID();
  db.prepare('INSERT INTO recharges(id,recharge_no,user_id,amount_cents,channel,created_at) VALUES(?,?,?,?,?,?)').run(id, genNo('R'), userId, amountCents, channel, Date.now());
  return db.prepare('SELECT * FROM recharges WHERE id=?').get(id);
}
const markRechargePaid = db.transaction((no, { outTradeNo = '', channel, source, raw = {} } = {}) => {
  const row = getByNo(no);
  if (!row) fail(404, 'NOT_FOUND', '充值单不存在');
  if (!['mock', 'alipay', 'wechat', 'manual'].includes(source)) fail(400, 'VALIDATION_ERROR', '支付来源无效');
  if (channel && row.channel !== channel) fail(400, 'VALIDATION_ERROR', '支付渠道不匹配');
  const verifiedReal = ['alipay', 'wechat'].includes(source) && channel === source && row.channel === source;
  if (['alipay', 'wechat'].includes(source) && !verifiedReal) fail(400, 'VALIDATION_ERROR', '真实支付来源与渠道不匹配');
  if (row.status === 'paid') return { ok: true, already: true, recharge: row };
  // Only verified provider callbacks (signature + merchant + amount checked by payment routes)
  // or an explicit administrator reconciliation may recover a locally failed/expired order.
  if (row.status !== 'pending' && source !== 'manual' && !verifiedReal) fail(409, 'VALIDATION_ERROR', '充值单已关闭');
  const meta = JSON.stringify({ source, raw });
  db.prepare("UPDATE recharges SET status='paid',paid_at=?,out_trade_no=?,meta=? WHERE id=?").run(Date.now(), outTradeNo, meta, row.id);
  addLedger({ userId: row.user_id, type: 'recharge', amountCents: row.amount_cents, refType: 'recharge', refId: row.id, remark: source === 'manual' ? '人工核账充值' : ({ alipay: '支付宝充值', wechat: '微信支付充值' }[row.channel] || '充值') });
  return { ok: true, already: false, recharge: getByNo(no) };
});
const markRechargeFailed = db.transaction((no, { source, raw = {} } = {}) => {
  const row = getByNo(no);
  if (!row) fail(404, 'NOT_FOUND', '充值单不存在');
  if (row.status === 'paid') fail(409, 'VALIDATION_ERROR', '已支付充值单不能改为失败');
  db.prepare("UPDATE recharges SET status='failed',meta=? WHERE id=? AND status='pending'").run(JSON.stringify({ source, raw }), row.id);
  return { ok: true };
});
module.exports = { createRecharge, getByNo, markRechargePaid, markRechargeFailed };
