const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

test('payment notifications verify signatures, merchant, amount, and credit only once', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'resihub-payments-'));
  process.env.DB_PATH = path.join(dir, 'test.db');
  process.env.NODE_ENV = 'test';
  process.env.MAIL_MODE = 'mock';
  process.env.PAYMENT_MODE = 'real';
  process.env.ADMIN_EMAIL = 'admin@resihub.local';
  process.env.ADMIN_PASSWORD = 'TestAdmin@123456';
  const pair = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const privatePem = pair.privateKey.export({ type: 'pkcs8', format: 'pem' });
  const publicPem = pair.publicKey.export({ type: 'spki', format: 'pem' });
  Object.assign(process.env, { ALIPAY_APP_ID: 'test-alipay', ALIPAY_PRIVATE_KEY: privatePem,
    ALIPAY_PUBLIC_KEY: publicPem, ALIPAY_SELLER_ID: 'test-seller', WEPAY_MCHID: 'test-mch',
    WEPAY_APPID: 'test-wechat', WEPAY_PRIVATE_KEY: privatePem, WEPAY_SERIAL: 'merchant-serial',
    WEPAY_APIV3_KEY: '12345678901234567890123456789012',
    WEPAY_PLATFORM_PUBLIC_KEY: publicPem, WEPAY_PLATFORM_SERIAL: 'PUB_KEY_ID_TEST' });
  const express = require('express');
  const app = express();
  app.use(express.json({ verify: (req, res, buffer) => { req.rawBody = buffer; } }));
  app.use(express.urlencoded({ extended: false }));
  app.use('/api/payments', require('../src/routes/payments'));
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const db = require('../src/db');
  const service = require('../src/services/recharge');
  const user = db.prepare('SELECT * FROM users LIMIT 1').get();
  const base = `http://127.0.0.1:${server.address().port}/api/payments`;
  t.after(async () => { await new Promise(resolve => server.close(resolve)); db.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  const post = (route, body, headers) => fetch(base + route, { method: 'POST', body, headers, signal: AbortSignal.timeout(5000) });
  function signedAlipay(no, amount = '10.00', extra = {}) {
    const body = { app_id: 'test-alipay', seller_id: 'test-seller', out_trade_no: no,
      total_amount: amount, trade_no: `ALI-${no}`, trade_status: 'TRADE_SUCCESS', ...extra };
    const canonical = Object.keys(body).sort().map(key => `${key}=${body[key]}`).join('&');
    return new URLSearchParams({ ...body, sign_type: 'RSA2', sign: crypto.sign('RSA-SHA256', Buffer.from(canonical), privatePem).toString('base64') });
  }
  const formHeaders = { 'Content-Type': 'application/x-www-form-urlencoded' };
  await t.test('Alipay valid callback and duplicate notify', async () => {
    const row = service.createRecharge(user.id, 1000, 'alipay');
    for (let i = 0; i < 2; i++) {
      const r = await post('/alipay/notify', signedAlipay(row.recharge_no, '10.00', { subject: '住宅代理%25充值+测试' }), formHeaders);
      assert.equal(r.status, 200); assert.equal(await r.text(), 'success');
    }
    assert.equal(db.prepare('SELECT balance_cents FROM users WHERE id=?').get(user.id).balance_cents, 1000);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM ledger WHERE ref_id=?').get(row.id).n, 1);
  });
  await t.test('Alipay forged signature, merchant, amount and channel never credit', async () => {
    const row = service.createRecharge(user.id, 1000, 'alipay');
    const forged = signedAlipay(row.recharge_no); forged.set('total_amount', '999.00');
    for (const body of [forged, signedAlipay(row.recharge_no, '0.01'), signedAlipay(row.recharge_no, '10.00', { app_id: 'other-app' }), signedAlipay(row.recharge_no, '10.00', { seller_id: 'other-seller' })]) {
      assert.equal((await post('/alipay/notify', body, formHeaders)).status, 400);
    }
    assert.equal(service.getByNo(row.recharge_no).status, 'pending');
  });
  function signedWechat(row, extra = {}) {
    const transaction = { appid: 'test-wechat', mchid: 'test-mch', out_trade_no: row.recharge_no,
      transaction_id: `WX-${row.recharge_no}`, trade_state: 'SUCCESS', amount: { total: row.amount_cents, currency: 'CNY' }, ...extra };
    const nonce = 'abcdefghijkl'; const associated = 'transaction';
    const cipher = crypto.createCipheriv('aes-256-gcm', Buffer.from(process.env.WEPAY_APIV3_KEY), Buffer.from(nonce));
    cipher.setAAD(Buffer.from(associated));
    const encrypted = Buffer.concat([cipher.update(JSON.stringify(transaction)), cipher.final(), cipher.getAuthTag()]);
    const body = JSON.stringify({ id: crypto.randomUUID(), event_type: 'TRANSACTION.SUCCESS', resource: {
      algorithm: 'AEAD_AES_256_GCM', nonce, associated_data: associated, ciphertext: encrypted.toString('base64') } });
    const timestamp = String(Math.floor(Date.now() / 1000)); const headerNonce = crypto.randomBytes(8).toString('hex');
    const signature = crypto.sign('RSA-SHA256', Buffer.from(`${timestamp}\n${headerNonce}\n${body}\n`), privatePem).toString('base64');
    return { body, headers: { 'Content-Type': 'application/json', 'Wechatpay-Timestamp': timestamp,
      'Wechatpay-Nonce': headerNonce, 'Wechatpay-Serial': 'PUB_KEY_ID_TEST', 'Wechatpay-Signature': signature } };
  }
  await t.test('WeChat verified and decrypted callback credits once', async () => {
    const row = service.createRecharge(user.id, 1000, 'wechat'); const signed = signedWechat(row);
    for (let i = 0; i < 2; i++) assert.equal((await post('/wechat/notify', signed.body, signed.headers)).status, 200);
    assert.equal(db.prepare('SELECT balance_cents FROM users WHERE id=?').get(user.id).balance_cents, 2000);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM ledger WHERE ref_id=?').get(row.id).n, 1);
  });
  await t.test('WeChat rejects altered, stale, wrong serial, merchant and amount', async () => {
    const row = service.createRecharge(user.id, 1000, 'wechat'); const signed = signedWechat(row);
    assert.equal((await post('/wechat/notify', signed.body + ' ', signed.headers)).status, 401);
    assert.equal((await post('/wechat/notify', signed.body, { ...signed.headers, 'Wechatpay-Serial': 'wrong' })).status, 401);
    assert.equal((await post('/wechat/notify', signed.body, { ...signed.headers, 'Wechatpay-Timestamp': '1' })).status, 401);
    for (const extra of [{ amount: { total: 1, currency: 'CNY' } }, { mchid: 'wrong' }, { appid: 'wrong' }]) {
      const bad = signedWechat(row, extra); assert.equal((await post('/wechat/notify', bad.body, bad.headers)).status, 400);
    }
    assert.equal(service.getByNo(row.recharge_no).status, 'pending');
  });
  await t.test('real mode rejects simulated confirmation and never falls back', async () => {
    assert.equal((await post('/mock/confirm', JSON.stringify({}), { 'Content-Type': 'application/json' })).status, 403);
    const config = require('../src/config'); const saved = config.alipay.appId; config.alipay.appId = '';
    await assert.rejects(require('../src/services/payments').createPayment({ rechargeNo: 'none', amountCents: 1000, channel: 'alipay', subject: 'test' }), /尚未配置/);
    config.alipay.appId = saved;
  });
});
