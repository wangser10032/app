const { test, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'resihub-recharge-'));
process.env.NODE_ENV = 'test'; process.env.DB_PATH = path.join(temp, 'test.db'); process.env.MAIL_MODE = 'mock'; process.env.PAYMENT_MODE = 'mock';
const db = require('../src/db');
const recharge = require('../src/services/recharge');
let userId;
beforeEach(() => { userId = randomUUID(); db.prepare("INSERT INTO users(id,email,password_hash,created_at) VALUES(?,?,'unused',?)").run(userId, `${userId}@example.test`, Date.now()); });
after(() => { db.close(); fs.rmSync(temp, { recursive: true, force: true }); });
function balance() { return db.prepare('SELECT balance_cents FROM users WHERE id=?').get(userId).balance_cents; }
function entries(row) { return db.prepare("SELECT COUNT(*) n FROM ledger WHERE ref_type='recharge' AND ref_id=?").get(row.id).n; }
test('duplicate paid notification credits balance and ledger exactly once', () => {
  const row = recharge.createRecharge(userId, 3500, 'alipay'); const details = { channel: 'alipay', source: 'alipay', outTradeNo: 'provider-one' };
  const first = recharge.markRechargePaid(row.recharge_no, details); const second = recharge.markRechargePaid(row.recharge_no, details);
  assert.equal(first.already, false); assert.equal(second.already, true); assert.equal(balance(), 3500); assert.equal(entries(row), 1);
  assert.throws(() => recharge.markRechargeFailed(row.recharge_no, { source: 'manual' }), { status: 409 }); assert.equal(balance(), 3500);
});
for (const channel of ['alipay', 'wechat']) for (const status of ['failed', 'expired']) test(`verified ${channel} notification recovers ${status} recharge exactly once`, () => {
  const row = recharge.createRecharge(userId, 1000, channel); db.prepare('UPDATE recharges SET status=? WHERE id=?').run(status, row.id);
  const result = recharge.markRechargePaid(row.recharge_no, { channel, source: channel, outTradeNo: `${channel}-${status}-transaction` });
  assert.equal(result.recharge.status, 'paid'); assert.equal(balance(), 1000); assert.equal(entries(row), 1);
  recharge.markRechargePaid(row.recharge_no, { channel, source: channel }); assert.equal(balance(), 1000); assert.equal(entries(row), 1);
});
test('invalid source, mismatched channel and missing real channel cannot credit an order', () => {
  const row = recharge.createRecharge(userId, 1000, 'alipay');
  for (const details of [
    { source: 'untrusted', channel: 'alipay' },
    { source: 'wechat', channel: 'wechat' },
    { source: 'wechat', channel: 'alipay' },
    { source: 'alipay', channel: 'wechat' },
    { source: 'alipay' },
  ]) assert.throws(() => recharge.markRechargePaid(row.recharge_no, details), { status: 400 });
  assert.equal(balance(), 0); assert.equal(entries(row), 0);
  recharge.markRechargePaid(row.recharge_no, { source: 'alipay', channel: 'alipay' });
  assert.throws(() => recharge.markRechargePaid(row.recharge_no, { source: 'untrusted', channel: 'alipay' }), { status: 400 });
});
test('mock cannot reopen a failed order; administrator reconciliation may do so once', () => {
  const row = recharge.createRecharge(userId, 1000, 'wechat'); recharge.markRechargeFailed(row.recharge_no, { source: 'mock' });
  assert.throws(() => recharge.markRechargePaid(row.recharge_no, { source: 'mock', channel: 'wechat' }), { status: 409 }); assert.equal(balance(), 0);
  recharge.markRechargePaid(row.recharge_no, { source: 'manual', channel: 'wechat', outTradeNo: 'MANUAL-ONE' });
  recharge.markRechargePaid(row.recharge_no, { source: 'manual', channel: 'wechat', outTradeNo: 'MANUAL-ONE' });
  assert.equal(balance(), 1000); assert.equal(entries(row), 1);
});
