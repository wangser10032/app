const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'resihub-static-patch-'));
Object.assign(process.env, { NODE_ENV: 'test', DB_PATH: path.join(dir, 'test.db'), PAYMENT_MODE: 'mock', MAIL_MODE: 'mock', TRUST_PROXY: '0' });
const { app } = require('../src/index'); const db = require('../src/db'); const { signToken } = require('../src/middleware/auth');
let server; let base; let adminToken;
before(async () => { server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); }); base = `http://127.0.0.1:${server.address().port}`; adminToken = signToken(db.prepare("SELECT * FROM users WHERE role='admin' LIMIT 1").get()); });
after(async () => { await new Promise(resolve => server.close(resolve)); db.close(); fs.rmSync(dir, { recursive: true, force: true }); });
async function api(method, route, body, expected = 200) { const r = await fetch(base + route, { method, headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(10000) }); const data = await r.json(); assert.equal(r.status, expected, JSON.stringify(data)); return data; }
test('static product PATCH preserves omitted region, protocol, price and disabled status', async () => {
  const original = (await api('POST', '/api/admin/static-products', { name: '原产品', description: '保留说明', country: 'JP', region: 'Tokyo', city: 'Shibuya', isp: 'Test ISP', protocol: 'socks5', price_cents: 4000, duration_days: 7, sort: 77, status: 'disabled' }, 201)).product;
  const changed = (await api('PATCH', `/api/admin/static-products/${original.id}`, { name: '新产品名称' })).product; assert.deepEqual(changed, { ...original, name: '新产品名称' });
  assert.deepEqual((await api('PATCH', `/api/admin/static-products/${original.id}`, {})).product, changed);
  await api('PATCH', `/api/admin/static-products/${original.id}`, { unknown: 'rejected' }, 400);
});
test('IP PATCH preserves supplier credentials, protocol and country when changing a city', async () => {
  const original = (await api('POST', '/api/admin/ips', { host: 'patch-upstream.example.test', port: 1080, protocol: 'socks5', upstream_user: 'saved-user', upstream_pass: 'saved-password', country: 'JP', region: 'Tokyo', city: 'Shibuya', isp: 'Test ISP', status: 'disabled' }, 201)).ip;
  const changed = (await api('PATCH', `/api/admin/ips/${original.id}`, { city: 'Shinagawa' })).ip;
  assert.equal(changed.city, 'Shinagawa'); for (const field of ['host', 'port', 'protocol', 'upstream_user', 'upstream_pass', 'country', 'region', 'isp', 'status']) assert.equal(changed[field], original[field]);
  const empty = (await api('PATCH', `/api/admin/ips/${original.id}`, {})).ip; assert.deepEqual(empty, changed);
  await api('PATCH', `/api/admin/ips/${original.id}`, { unknown: 'rejected' }, 400);
});
