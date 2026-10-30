const express = require('express');
const db = require('../db');
const config = require('../config');
const { route, fail } = require('../utils/errors');
const { z } = require('../utils/validation');
const { authRequired, publicUser } = require('../middleware/auth');
const { paginate, paged } = require('../utils');
const { getSettings } = require('../services/settings');
const recharge = require('../services/recharge');
const rentals = require('../services/static-rentals');
const { createPayment, channels } = require('../services/payments');
const router = express.Router();
router.use(authRequired);
const rechargeFields = 'id,recharge_no,user_id,amount_cents,channel,status,pay_url,qr_content,paid_at,created_at';
function list(req, table, fields = '*', filter) {
  const { page, pageSize, offset } = paginate(req); const clauses = ['user_id=?']; const values = [req.user.id];
  if (filter && typeof req.query[filter] === 'string' && req.query[filter]) { clauses.push(`${filter}=?`); values.push(req.query[filter]); }
  const where = clauses.join(' AND ');
  return paged(db.prepare(`SELECT ${fields} FROM ${table} WHERE ${where} ORDER BY created_at DESC,id DESC LIMIT ? OFFSET ?`).all(...values, pageSize, offset), db.prepare(`SELECT COUNT(*) total FROM ${table} WHERE ${where}`).get(...values).total, page, pageSize);
}
router.get('/summary', route((req, res) => {
  const settings = getSettings(); const latest = rentals.listRentals({ user: req.user, query: { page_size: 5 } });
  res.json({ balance_cents: req.user.balance_cents, ...rentals.summary(req.user.id), site_name: settings.site_name, announcement: settings.announcement, gateway_endpoint: `${config.publicGatewayHost}:${config.publicGatewayPort || config.gatewayPort}`, recent_static_ips: latest.items });
}));
router.patch('/profile', route((req, res) => {
  const body = z.object({ nickname: z.string().trim().max(60) }).parse(req.body);
  db.prepare('UPDATE users SET nickname=? WHERE id=?').run(body.nickname, req.user.id);
  res.json({ user: publicUser(db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id)) });
}));
router.get('/transactions', (req, res) => res.json(list(req, 'ledger', '*', 'type')));
router.get('/orders', (req, res) => res.json(list(req, 'orders', '*', 'status')));
router.post('/orders', (req, res) => res.status(410).json({ error: { code: 'LEGACY_PRODUCT_RETIRED', message: '流量套餐已停售，请购买静态住宅 IP' } }));
router.post('/static-orders', route((req, res) => {
  const body = z.object({ product_id: z.string().uuid(), quantity: z.number().int().min(1).max(100) }).strict().parse(req.body);
  res.status(201).json(rentals.purchase.immediate({ userId: req.user.id, productId: body.product_id, quantity: body.quantity, key: rentals.requestKey(req) }));
}));
router.get('/static-ips', route((req, res) => res.json(rentals.listRentals(req))));
router.get('/static-ip-filters', route((req, res) => {
  const countries = db.prepare("SELECT UPPER(TRIM(country)) code,COUNT(*) count FROM static_rentals WHERE user_id=? AND TRIM(country)<>'' GROUP BY UPPER(TRIM(country)) ORDER BY code").all(req.user.id);
  res.json({ countries });
}));
router.patch('/static-ips/:id', route((req, res) => {
  const body = z.object({ remark: z.string().trim().max(500) }).strict().parse(req.body);
  if (!db.prepare('UPDATE static_rentals SET remark=? WHERE id=? AND user_id=?').run(body.remark, req.params.id, req.user.id).changes) fail(404, 'NOT_FOUND', '租用 IP 不存在');
  res.json({ rental: rentals.rentalView(rentals.rentalRow(req.params.id, req.user.id)) });
}));
router.post('/static-ips/:id/renew', route((req, res) => {
  z.object({}).strict().parse(req.body || {});
  res.json(rentals.renew.immediate({ userId: req.user.id, rentalId: req.params.id, key: rentals.requestKey(req) }));
}));
router.all(['/entitlements', '/usage', '/keys', '/keys/:id', '/coverage'], (req, res) => res.status(410).json({ error: { code: 'LEGACY_PRODUCT_RETIRED', message: '该流量代理功能已停用，请使用已购静态住宅 IP' } }));
router.get('/recharges', (req, res) => res.json(list(req, 'recharges', rechargeFields, 'status')));
router.post('/recharges', route(async (req, res) => {
  const body = z.object({ amount_cents: z.number().int().min(1000).max(1000000), channel: z.enum(['alipay', 'wechat']) }).parse(req.body);
  // 渠道关闭或未配置时直接拒绝，不留下失败的充值单
  const target = channels().find(c => c.key === body.channel);
  if (!target.switched_on) fail(409, 'PAYMENT_UNAVAILABLE', '该支付方式暂不支持，请选择其他方式');
  if (!target.enabled) fail(503, 'PAYMENT_UNAVAILABLE', '该支付渠道尚未配置，请联系管理员');
  const row = recharge.createRecharge(req.user.id, body.amount_cents, body.channel);
  try {
    const payment = await createPayment({ rechargeNo: row.recharge_no, amountCents: row.amount_cents, channel: row.channel, subject: 'ResiHub 账户充值' });
    db.prepare("UPDATE recharges SET pay_url=?,qr_content=?,out_trade_no=? WHERE id=? AND status='pending'").run(payment.pay_url, payment.qr_content, payment.out_trade_no, row.id);
    res.status(201).json({ ...db.prepare(`SELECT ${rechargeFields} FROM recharges WHERE id=?`).get(row.id), mode: payment.mode });
  } catch (error) { recharge.markRechargeFailed(row.recharge_no, { source: 'create', raw: { error: 'provider_create_failed' } }); throw error; }
}));
router.get('/recharges/:no', route((req, res) => {
  const row = db.prepare(`SELECT ${rechargeFields} FROM recharges WHERE recharge_no=? AND user_id=?`).get(req.params.no, req.user.id);
  if (!row) fail(404, 'NOT_FOUND', '充值单不存在'); res.json({ recharge: row });
}));
module.exports = router;
