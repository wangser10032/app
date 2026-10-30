const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');

test('static residential purchase, renewal, inventory, account and payment workflow', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'resihub-static-integration-'));
  Object.assign(process.env, { NODE_ENV: 'test', DB_PATH: path.join(dir, 'test.db'), MAIL_MODE: 'mock', PAYMENT_MODE: 'mock',
    REGISTER_REQUIRE_CODE: 'true', TRUST_PROXY: '0', ADMIN_EMAIL: 'admin@resihub.local', ADMIN_PASSWORD: 'TestAdmin@123456' });
  const { app } = require('../src/index'); const db = require('../src/db');
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => { await new Promise(resolve => server.close(resolve)); db.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  async function api(method, route, body, token, expected = 200, headers = {}) {
    if (method === 'POST' && ['/api/auth/send-code', '/api/auth/login'].includes(route) && !body.captcha) {
      const random = t.mock.method(crypto, 'randomInt', (min, max) => max === undefined ? 0 : min);
      let challenge;
      try { challenge = await api('GET', `/api/auth/captcha?purpose=${route.endsWith('send-code') ? body.purpose : 'login'}`); }
      finally { random.mock.restore(); }
      body = { ...body, captcha: { id: challenge.id, answer: '22222' } };
    }
    const r = await fetch(base + route, { method, headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(10000) });
    const text = await r.text(); let data; try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    assert.equal(r.status, expected, `${method} ${route}: ${text}`); return data;
  }
  const email = 'buyer@example.test'; const password = 'BuyerPassword@123';
  let user; let admin; let recharge; let product; let ipA; let rentals; let order;
  await t.test('registration verifies email and protects user/admin data', async () => {
    await api('GET', '/api/health');
    await api('POST', '/api/auth/register', { email, password }, null, 400);
    const code = await api('POST', '/api/auth/send-code', { email, purpose: 'register' });
    user = await api('POST', '/api/auth/register', { email, password, nickname: '测试用户', code: code.dev_code }, null, 201);
    assert.equal(user.user.email, email); assert.equal(user.user.password_hash, undefined);
    await api('GET', '/api/me/static-ips', undefined, null, 401);
    await api('GET', '/api/admin/stats', undefined, user.token, 403);
    admin = await api('POST', '/api/auth/login', { email: 'admin@resihub.local', password: 'TestAdmin@123456' });
    const summary = await api('GET', '/api/me/summary', undefined, user.token);
    assert.equal(summary.static_ip_total, 0); assert.equal(summary.quota_total_mb, undefined); assert.equal(summary.remaining_mb, undefined);
    assert.deepEqual(await api('GET', '/api/me/static-ip-filters', undefined, user.token), { countries: [] }, 'no owned rentals means no country options');
  });
  await t.test('mock recharge is signed and concurrent repeats credit once', async () => {
    recharge = await api('POST', '/api/me/recharges', { amount_cents: 10000, channel: 'alipay' }, user.token, 201);
    const url = new URL(recharge.pay_url); const token = url.searchParams.get('token'); assert.ok(token);
    assert.equal((await fetch(base + url.pathname + url.search)).status, 200);
    await api('POST', '/api/payments/mock/confirm', { recharge_no: recharge.recharge_no, result: 'success' }, null, 403);
    await Promise.all(Array.from({ length: 5 }, () => api('POST', '/api/payments/mock/confirm', { recharge_no: recharge.recharge_no, result: 'success', token })));
    assert.equal((await api('GET', '/api/me/summary', undefined, user.token)).balance_cents, 10000);
    assert.equal((await api('GET', '/api/me/transactions', undefined, user.token)).total, 1);
    await api('POST', `/api/admin/recharges/${recharge.id}/mark-failed`, {}, admin.token, 409);
  });
  await t.test('products count matching free inventory and reject unavailable purchases without charging', async () => {
    product = (await api('POST', '/api/admin/static-products', { name: '美国静态住宅', country: 'US', isp: 'Test ISP', protocol: 'http', price_cents: 2500, duration_days: 30, description: '固定 IP，按租期计费' }, admin.token, 201)).product;
    const stock = async () => (await api('GET', '/api/static-products')).items.find(p => p.id === product.id).available_ips;
    assert.equal(await stock(), 0);
    await api('POST', '/api/me/static-orders', { product_id: product.id, quantity: 1 }, user.token, 409, { 'Idempotency-Key': 'no-stock' });
    assert.equal((await api('GET', '/api/me/summary', undefined, user.token)).balance_cents, 10000);
    ipA = (await api('POST', '/api/admin/ips', { host: '192.0.2.10', port: 8022, protocol: 'http', country: 'US', isp: 'Test ISP', upstream_user: 'supplier-master', upstream_pass: 'supplier-secret' }, admin.token, 201)).ip;
    await api('POST', '/api/admin/ips', { host: '192.0.2.11', port: 8022, protocol: 'http', country: 'US', isp: 'Test ISP' }, admin.token, 201);
    await api('POST', '/api/admin/ips', { host: '192.0.2.12', port: 8022, protocol: 'http', country: 'JP', isp: 'Test ISP' }, admin.token, 201);
    assert.equal(await stock(), 2);
    await api('POST', '/api/me/static-orders', { product_id: product.id, quantity: 101 }, user.token, 400, { 'Idempotency-Key': 'bad-quantity' });
    await api('POST', '/api/me/static-orders', { product_id: product.id, quantity: 1 }, user.token, 400);
  });
  await t.test('purchase allocates fixed exclusive IPs atomically, encrypts credentials, and is idempotent', async () => {
    const request = { product_id: product.id, quantity: 2 }; const headers = { 'Idempotency-Key': 'purchase-two-static' };
    const result = await api('POST', '/api/me/static-orders', request, user.token, 201, headers); rentals = result.rentals; order = result.order;
    assert.equal(rentals.length, 2); assert.equal(new Set(rentals.map(r => r.ip_host)).size, 2);
    assert.equal(order.kind, 'static_purchase'); assert.equal(order.quantity, 2); assert.equal(order.amount_cents, 5000);
    for (const r of rentals) { assert.ok(r.username && r.password); assert.equal(r.country, 'US'); assert.equal(r.upstream_user, undefined); assert.equal(r.upstream_pass, undefined); assert.notEqual(r.password, 'supplier-secret'); }
    const stored = db.prepare('SELECT * FROM static_rentals WHERE id=?').get(rentals[0].id);
    for (const value of Object.values(stored)) assert.notEqual(value, rentals[0].password, 'proxy password must not be stored as plaintext');
    const again = await api('POST', '/api/me/static-orders', request, user.token, 201, headers);
    assert.equal(again.order.id, order.id); assert.deepEqual(again.rentals.map(r => r.id), rentals.map(r => r.id));
    assert.equal((await api('GET', '/api/me/summary', undefined, user.token)).balance_cents, 5000);
    await api('POST', '/api/me/static-orders', { product_id: product.id, quantity: 1 }, user.token, 409, headers);
    await Promise.all(Array.from({ length: 3 }, (_, i) => api('POST', '/api/me/static-orders', { product_id: product.id, quantity: 1 }, user.token, 409, { 'Idempotency-Key': `sold-out-${i}` })));
    assert.equal((await api('GET', '/api/me/orders', undefined, user.token)).total, 1);
    assert.equal((await api('GET', '/api/me/summary', undefined, user.token)).static_ip_active, 2);
    assert.deepEqual(await api('GET', '/api/me/static-ip-filters?country=JP&q=not-a-match&page=99&page_size=1', undefined, user.token), { countries: [{ code: 'US', count: 2 }] }, 'options describe all owned rentals independently of search, pagination or unpurchased JP inventory');
  });
  await t.test('rental rows support remarks, ownership, filtering, and hide admin supplier secrets', async () => {
    const row = (await api('PATCH', `/api/me/static-ips/${rentals[0].id}`, { remark: '业务 A' }, user.token)).rental;
    assert.equal(row.remark, '业务 A'); assert.equal(row.password, rentals[0].password);
    const list = await api('GET', '/api/me/static-ips?country=US&status=active&q=%E4%B8%9A%E5%8A%A1', undefined, user.token);
    assert.equal(list.total, 1);
    await api('PATCH', `/api/me/static-ips/${rentals[0].id}`, { remark: 'not owner' }, admin.token, 404);
    assert.equal((await api('GET', '/api/me/static-ips', undefined, admin.token)).total, 0);
    assert.deepEqual(await api('GET', '/api/me/static-ip-filters', undefined, admin.token), { countries: [] }, 'country options must not expose another user\'s US rentals');
    const adminRows = await api('GET', '/api/admin/static-ips', undefined, admin.token);
    assert.equal(adminRows.total, 2); assert.equal(adminRows.items[0].password, undefined); assert.equal(adminRows.items[0].password_hash, undefined);
    await api('GET', `/api/me/recharges/${recharge.recharge_no}`, undefined, admin.token, 404);
  });
  await t.test('allocated upstreams cannot silently change or be deleted', async () => {
    await api('PATCH', `/api/admin/ips/${ipA.id}`, { host: '192.0.2.99' }, admin.token, 409);
    await api('PATCH', `/api/admin/ips/${ipA.id}`, { upstream_pass: 'different-secret' }, admin.token, 409);
    await api('DELETE', `/api/admin/ips/${ipA.id}`, undefined, admin.token, 409);
    const ips = await api('GET', '/api/admin/ips', undefined, admin.token); const ip = ips.items.find(row => row.id === ipA.id);
    assert.equal(ip.is_allocated, true); assert.equal(ip.assigned_to, email); assert.ok(ip.lease_expires_at);
  });
  await t.test('renewal extends the same IP and credentials once, with a separate bill', async () => {
    const original = rentals[0]; const headers = { 'Idempotency-Key': 'renew-first-ip' };
    const renewed = await api('POST', `/api/me/static-ips/${original.id}/renew`, {}, user.token, 200, headers);
    assert.equal(renewed.order.kind, 'static_renewal'); assert.equal(renewed.order.quantity, 1); assert.equal(renewed.order.amount_cents, 2500);
    assert.equal(renewed.rental.expires_at, original.expires_at + 30 * 86400000);
    assert.equal(renewed.rental.ip_host, original.ip_host); assert.equal(renewed.rental.username, original.username); assert.equal(renewed.rental.password, original.password);
    const repeated = await api('POST', `/api/me/static-ips/${original.id}/renew`, {}, user.token, 200, headers); assert.equal(repeated.order.id, renewed.order.id);
    assert.equal((await api('GET', '/api/me/summary', undefined, user.token)).balance_cents, 2500);
    assert.equal((await api('GET', '/api/me/transactions', undefined, user.token)).total, 3);
    await api('PATCH', `/api/admin/static-products/${product.id}`, { name: '静态住宅新名称' }, admin.token);
    assert.equal((await api('GET', '/api/me/orders', undefined, user.token)).items.find(o => o.id === order.id).package_name, '美国静态住宅');
    await api('DELETE', `/api/admin/static-products/${product.id}`, undefined, admin.token, 409);
  });
  await t.test('expired resale cannot be reclaimed by renewal or admin reactivation', async () => {
    const old = rentals[1]; db.prepare('UPDATE static_rentals SET expires_at=? WHERE id=?').run(Date.now() - 1000, old.id);
    await api('POST', `/api/admin/users/${admin.user.id}/adjust`, { amount_cents: 10000, remark: '测试购买备用余额' }, admin.token);
    const other = await api('POST', '/api/me/static-orders', { product_id: product.id, quantity: 1 }, admin.token, 201, { 'Idempotency-Key': 'resale-expired-ip' });
    assert.equal(other.rentals[0].ip_host, old.ip_host);
    await api('POST', `/api/me/static-ips/${old.id}/renew`, {}, user.token, 409, { 'Idempotency-Key': 'cannot-reclaim-resold' });
    await api('PATCH', `/api/admin/static-ips/${old.id}`, { status: 'active', expires_at: Date.now() + 30 * 86400000 }, admin.token, 409);
    assert.equal((await api('GET', '/api/me/summary', undefined, user.token)).balance_cents, 2500);
    await api('PATCH', `/api/admin/static-ips/${rentals[0].id}`, { status: 'disabled' }, admin.token);
    await api('POST', `/api/me/static-ips/${rentals[0].id}/renew`, {}, user.token, 409, { 'Idempotency-Key': 'disabled-no-renew' });
  });
  await t.test('static admin surfaces work and traffic business endpoints are retired', async () => {
    for (const name of ['stats', 'users', 'orders', 'recharges', 'static-products', 'static-ips', 'ips', 'settings']) await api('GET', `/api/admin/${name}`, undefined, admin.token);
    const stats = await api('GET', '/api/admin/stats', undefined, admin.token); assert.equal(typeof stats.active_static_ips, 'number'); assert.equal(stats.traffic_mb_today, undefined);
    await api('PUT', '/api/admin/settings', { site_name: 'ResiHub', announcement: '服务通知' }, admin.token);
    for (const route of ['usage', 'entitlements', 'keys']) await api('GET', `/api/me/${route}`, undefined, user.token, 410);
    await api('POST', '/api/me/orders', { package_id: product.id }, user.token, 410);
    for (const route of ['/', '/login', '/app/static', '/app/orders', '/admin', '/admin/static-ips']) { const r = await fetch(base + route); assert.equal(r.status, 200, route); assert.match(await r.text(), /<html/); }
  });
  await t.test('email codes are single use and password reset revokes old sessions', async () => {
    await api('POST', '/api/auth/send-code', { email, purpose: 'login' }, null, 429);
    db.prepare('UPDATE email_codes SET created_at=created_at-61000 WHERE email=?').run(email);
    const code = await api('POST', '/api/auth/send-code', { email, purpose: 'login' }); await api('POST', '/api/auth/login-code', { email, code: code.dev_code });
    await api('POST', '/api/auth/login-code', { email, code: code.dev_code }, null, 400);
    db.prepare('UPDATE email_codes SET created_at=created_at-61000 WHERE email=?').run(email);
    const reset = await api('POST', '/api/auth/send-code', { email, purpose: 'reset' });
    await api('POST', '/api/auth/reset-password', { email, code: reset.dev_code, password: 'ReplacementPassword@123' });
    await api('GET', '/api/me/summary', undefined, user.token, 401);
    await api('POST', '/api/auth/login', { email, password }, null, 401);
    await api('POST', '/api/auth/login', { email, password: 'ReplacementPassword@123' });
  });
});
