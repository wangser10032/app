const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

test('visitor IP endpoint reports local addresses without external lookups', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'resihub-ip-'));
  Object.assign(process.env, { NODE_ENV: 'test', DB_PATH: path.join(dir, 'ip.db'), MAIL_MODE: 'mock', PAYMENT_MODE: 'mock', TRUST_PROXY: '0', ADMIN_EMAIL: 'admin@resihub.local', ADMIN_PASSWORD: 'TestAdmin@123456' });
  const { app } = require('../src/index'); const db = require('../src/db');
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  t.after(async () => { await new Promise(resolve => server.close(resolve)); db.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  const realFetch = global.fetch; let external = 0;
  global.fetch = (url, ...rest) => { if (!String(url).startsWith('http://127.0.0.1')) external++; return realFetch(url, ...rest); };
  t.after(() => { global.fetch = realFetch; });
  const res = await fetch(`http://127.0.0.1:${server.address().port}/api/ip`, { headers: { 'X-Forwarded-For': '8.8.8.8' } });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ip: '127.0.0.1', local: true }, 'X-Forwarded-For is ignored without TRUST_PROXY');
  assert.equal(external, 0);
});

test('mainland IPs resolve offline with Chinese names and carrier', async t => {
  const realFetch = global.fetch; global.fetch = () => { throw new Error('mainland lookups must not call external services'); };
  t.after(() => { global.fetch = realFetch; });
  const { lookup } = require('../src/services/ip-lookup');
  const changsha = await lookup('113.246.0.1');
  assert.deepEqual([changsha.country, changsha.region, changsha.city, changsha.isp], ['CN', '湖南省', '长沙市', '中国电信']);
  assert.ok(Math.abs(changsha.lat - 28.23) < .01 && Math.abs(changsha.lon - 112.94) < .01);
  const beijing = await lookup('220.181.38.148');
  assert.deepEqual([beijing.country, beijing.region, beijing.city], ['CN', '', '北京市'], 'province and city collapse when they name the same place');
});
