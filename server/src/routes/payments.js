const express = require('express');
const rateLimit = require('express-rate-limit');
const config = require('../config');
const { channels } = require('../services/payments');
const { verifyMockToken, assertPaidRecharge } = require('../services/payments/shared');
const router = express.Router();
router.get('/config', (req, res) => res.json({ mode: config.paymentMode, channels: channels() }));
router.post('/mock/confirm', rateLimit({ windowMs: 60000, limit: 30, standardHeaders: true, legacyHeaders: false }), (req, res, next) => {
  try {
    if (config.paymentMode !== 'mock' || config.production) return res.status(403).json({ error: { code: 'FORBIDDEN', message: '模拟支付未启用' } });
    const { recharge_no: no, result, token } = req.body || {};
    if (!['success', 'fail'].includes(result) || !verifyMockToken(no, token)) return res.status(403).json({ error: { code: 'FORBIDDEN', message: '无效的模拟收银台凭证' } });
    const service = require('../services/recharge');
    const row = service.getByNo(no);
    if (!row) return res.status(404).json({ error: { code: 'NOT_FOUND', message: '充值单不存在' } });
    if (result === 'success') service.markRechargePaid(no, { outTradeNo: `MOCK-${no}`, channel: row.channel, source: 'mock', raw: { mock: true } });
    else service.markRechargeFailed(no, { source: 'mock', raw: { mock: true } });
    res.json({ ok: true });
  } catch (err) { next(err); }
});
router.post('/alipay/notify', async (req, res) => {
  if (config.paymentMode !== 'real') return res.status(404).send('fail');
  try {
    const alipay = require('../services/payments/alipay');
    if (!alipay.verifyNotification(req.body)) return res.status(400).send('fail');
    const b = req.body;
    assertPaidRecharge(b.out_trade_no, 'alipay', alipay.amountInCents(b.total_amount));
    if (['TRADE_SUCCESS', 'TRADE_FINISHED'].includes(b.trade_status)) {
      if (!b.trade_no) return res.status(400).send('fail');
      require('../services/recharge').markRechargePaid(b.out_trade_no, { outTradeNo: b.trade_no, channel: 'alipay', source: 'alipay', raw: { trade_no: b.trade_no, trade_status: b.trade_status } });
    }
    return res.type('text').send('success');
  } catch (err) { console.error('[alipay notify]', err.code || 'verification_failed'); return res.status(400).type('text').send('fail'); }
});
router.get('/alipay/return', (req, res) => {
  const no = typeof req.query.out_trade_no === 'string' ? req.query.out_trade_no : '';
  res.redirect(`${config.payReturnBaseUrl}/app/recharge?no=${encodeURIComponent(no)}`);
});
router.post('/wechat/notify', async (req, res) => {
  if (config.paymentMode !== 'real') return res.status(404).json({ code: 'FAIL', message: '支付未启用' });
  try {
    const wechat = require('../services/payments/wechat');
    if (!req.rawBody || !wechat.verifySignature(req.headers, req.rawBody)) return res.status(401).json({ code: 'FAIL', message: '验签失败' });
    const t = wechat.decryptNotification(req.body);
    if (req.body.event_type !== 'TRANSACTION.SUCCESS' || t.trade_state !== 'SUCCESS' || t.mchid !== config.wepay.mchid || t.appid !== config.wepay.appid || t.amount?.currency !== 'CNY' || !t.transaction_id) throw new Error('invalid_transaction');
    assertPaidRecharge(t.out_trade_no, 'wechat', t.amount.total);
    require('../services/recharge').markRechargePaid(t.out_trade_no, { outTradeNo: t.transaction_id, channel: 'wechat', source: 'wechat', raw: { transaction_id: t.transaction_id, trade_state: t.trade_state } });
    return res.status(200).json({ code: 'SUCCESS', message: '成功' });
  } catch (err) { console.error('[wechat notify]', err.code || 'verification_failed'); return res.status(400).json({ code: 'FAIL', message: '通知处理失败' }); }
});
module.exports = router;
