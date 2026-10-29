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
