const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { randomUUID } = require('node:crypto');

test('admin payment switches and Markdown integration guide', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'resihub-settings-'));
  Object.assign(process.env, { NODE_ENV: 'test', DB_PATH: path.join(dir, 'settings.db'), MAIL_MODE: 'mock', PAYMENT_MODE: 'mock', TRUST_PROXY: '0',
    ADMIN_EMAIL: 'admin@resihub.local', ADMIN_PASSWORD: 'TestAdmin@123456', PUBLIC_GATEWAY_HOST: 'gw.example.test', PUBLIC_GATEWAY_PORT: '3128' });
  const { app } = require('../src/index'); const db = require('../src/db'); const { signToken } = require('../src/middleware/auth');
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => { await new Promise(resolve => server.close(resolve)); db.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  async function api(method, route, body, token, expected = 200) {
    const r = await fetch(base + route, { method, headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await r.text(); assert.equal(r.status, expected, `${method} ${route}: ${text}`); return text ? JSON.parse(text) : null;
  }
  const userId = randomUUID();
  db.prepare("INSERT INTO users(id,email,password_hash,nickname,role,status,balance_cents,created_at) VALUES(?,?,'unused','buyer','user','active',0,?)").run(userId, 'buyer@example.test', Date.now());
  const admin = signToken(db.prepare("SELECT * FROM users WHERE role='admin'").get()), user = signToken(db.prepare('SELECT * FROM users WHERE id=?').get(userId));

  const initial = await api('GET', '/api/payments/config');
  assert.deepEqual(initial.channels.map(c => [c.key, c.enabled]), [['alipay', true], ['wechat', true]]);
  await api('GET', '/api/admin/settings', undefined, user, 403);
  let settings = (await api('GET', '/api/admin/settings', undefined, admin)).settings;
  assert.equal(settings.pay_alipay_enabled, true); assert.equal(settings.pay_wechat_enabled, true);
  assert.ok(settings.docs_default.includes('{{gateway}}')); assert.equal(settings.docs_markdown, settings.docs_default);

  settings = (await api('PUT', '/api/admin/settings', { pay_wechat_enabled: false }, admin)).settings;
  assert.equal(settings.pay_wechat_enabled, false);
  const wechat = (await api('GET', '/api/payments/config')).channels.find(c => c.key === 'wechat');
  assert.deepEqual([wechat.configured, wechat.switched_on, wechat.enabled], [true, false, false]);
  const refused = await api('POST', '/api/me/recharges', { amount_cents: 10000, channel: 'wechat' }, user, 409);
  assert.equal(refused.error.code, 'PAYMENT_UNAVAILABLE');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM recharges').get().n, 0, 'a refused channel leaves no recharge row');
  await api('POST', '/api/me/recharges', { amount_cents: 10000, channel: 'alipay' }, user, 201);

  let docs = (await api('GET', '/api/docs')).markdown;
  assert.ok(docs.includes('socks5h://gw.example.test:3128') && !docs.includes('{{gateway}}'));
  await api('PUT', '/api/admin/settings', { docs_markdown: '## 自定义说明\n\n地址 `{{gateway}}`' }, admin);
  docs = (await api('GET', '/api/docs')).markdown;
  assert.equal(docs, '## 自定义说明\n\n地址 `gw.example.test:3128`');
  await api('PUT', '/api/admin/settings', { docs_markdown: 'x'.repeat(50001) }, admin, 400);
  await api('PUT', '/api/admin/settings', { docs_markdown: settings.docs_default }, admin);
  assert.equal(db.prepare("SELECT value FROM settings WHERE key='docs_markdown'").get().value, '', 'saving the template stores an empty value');
  await api('PUT', '/api/admin/settings', { unknown_field: true }, admin, 400);
});
