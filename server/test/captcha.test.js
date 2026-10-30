const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

test('human verification protects authentication with expiring single-use PNG challenges', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'resihub-captcha-'));
  Object.assign(process.env, { NODE_ENV: 'test', DB_PATH: path.join(dir, 'test.db'), MAIL_MODE: 'mock', PAYMENT_MODE: 'mock',
    REGISTER_REQUIRE_CODE: 'true', TRUST_PROXY: '0', ADMIN_EMAIL: 'admin@captcha.test', ADMIN_PASSWORD: 'CaptchaAdmin@123456' });
  const { app } = require('../src/index'), db = require('../src/db');
  const { createCaptcha, consumeCaptcha } = require('../src/services/captcha');
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}/api/auth`;
  t.after(async () => { await new Promise(resolve => server.close(resolve)); db.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  async function request(route, body) {
    const response = await fetch(base + route, { method: body === undefined ? 'GET' : 'POST', headers: body === undefined ? {} : { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { response, data: await response.json() };
  }
  async function issue(purpose) {
    // Stub entropy only in this test process; the production endpoint never
    // includes an answer or a test-mode bypass, including with MAIL_MODE=mock.
    const random = t.mock.method(crypto, 'randomInt', (min, max) => max === undefined ? 0 : min);
    try {
      const { response, data } = await request(`/captcha?purpose=${purpose}`);
      assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'no-store');
      return data;
    } finally { random.mock.restore(); }
  }
  const solved = challenge => ({ id: challenge.id, answer: '22222' });

  await t.test('PNG is the only answer representation exposed; storage uses hashes', async () => {
    const challenge = await issue('register');
    assert.deepEqual(Object.keys(challenge).sort(), ['expires_at', 'id', 'image']);
    assert.ok(challenge.expires_at > Date.now() && challenge.expires_at <= Date.now() + 300000);
    const png = Buffer.from(challenge.image.split(',')[1], 'base64');
    assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
    assert.equal(png.readUInt32BE(16), 196); assert.equal(png.readUInt32BE(20), 60);
    assert.ok(!png.includes(Buffer.from('22222')));
    const row = db.prepare('SELECT * FROM human_challenges WHERE id=?').get(challenge.id);
    assert.match(row.answer_hash, /^[a-f0-9]{64}$/); assert.match(row.requester_hash, /^[a-f0-9]{64}$/);
    assert.ok(!Object.values(row).includes('22222')); assert.ok(!Object.values(row).includes('127.0.0.1'));
  });
  await t.test('email send and password login cannot bypass the human check', async () => {
    const send = await request('/send-code', { email: 'new@captcha.test', purpose: 'register' });
    assert.equal(send.response.status, 400); assert.equal(send.data.error.code, 'CAPTCHA_REQUIRED');
    const login = await request('/login', { email: 'admin@captcha.test', password: 'CaptchaAdmin@123456' });
    assert.equal(login.response.status, 400); assert.equal(login.data.error.code, 'CAPTCHA_REQUIRED');
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM email_codes').get().n, 0);
    const register = await request('/register', { email: 'new@captcha.test', password: 'BuyerPassword@123', code: '111111' });
    assert.equal(register.response.status, 400);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM users WHERE email=?').get('new@captcha.test').n, 0);
  });
  await t.test('wrong answer, wrong purpose and an expired challenge are rejected and consumed', async () => {
    const challenge = await issue('register');
    const wrong = await request('/send-code', { email: 'new@captcha.test', purpose: 'register', captcha: { id: challenge.id, answer: 'WRONG' } });
    assert.equal(wrong.response.status, 400); assert.equal(wrong.data.error.code, 'CAPTCHA_INVALID');
    const retry = await request('/send-code', { email: 'new@captcha.test', purpose: 'register', captcha: solved(challenge) });
    assert.equal(retry.response.status, 400); assert.equal(retry.data.error.code, 'CAPTCHA_INVALID');
    const otherPurpose = await issue('reset');
    const mismatch = await request('/send-code', { email: 'new@captcha.test', purpose: 'register', captcha: solved(otherPurpose) });
    assert.equal(mismatch.response.status, 400); assert.equal(mismatch.data.error.code, 'CAPTCHA_INVALID');
    const expired = await issue('register');
    db.prepare('UPDATE human_challenges SET expires_at=? WHERE id=?').run(Date.now() - 1, expired.id);
    const stale = await request('/send-code', { email: 'new@captcha.test', purpose: 'register', captcha: solved(expired) });
    assert.equal(stale.response.status, 400); assert.equal(stale.data.error.code, 'CAPTCHA_EXPIRED');
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM human_challenges WHERE id IN (?,?,?)').get(challenge.id, otherPurpose.id, expired.id).n, 0);
  });
  await t.test('challenge is bound to requester and accepts lowercase letters', () => {
    const alphabetIndex = 8; // first non-numeric glyph: A
    const random = t.mock.method(crypto, 'randomInt', (min, max) => max === undefined ? Math.min(alphabetIndex, min - 1) : min);
    try {
      const wrongIp = createCaptcha('login', '192.0.2.1');
      assert.throws(() => consumeCaptcha({ id: wrongIp.id, answer: 'aaaaa' }, 'login', '192.0.2.2'), { code: 'CAPTCHA_INVALID' });
      assert.throws(() => consumeCaptcha({ id: wrongIp.id, answer: 'AAAAA' }, 'login', '192.0.2.1'), { code: 'CAPTCHA_INVALID' });
      const valid = createCaptcha('login', '192.0.2.1');
      consumeCaptcha({ id: valid.id, answer: 'aaaaa' }, 'login', '192.0.2.1');
      assert.throws(() => consumeCaptcha({ id: valid.id, answer: 'AAAAA' }, 'login', '192.0.2.1'), { code: 'CAPTCHA_INVALID' });
    } finally { random.mock.restore(); }
  });
  await t.test('protected email code registers once; a human challenge cannot be replayed', async () => {
    const challenge = await issue('register');
    const payload = { email: 'new@captcha.test', purpose: 'register', captcha: solved(challenge) };
    const sent = await request('/send-code', payload);
    assert.equal(sent.response.status, 200); assert.match(sent.data.dev_code, /^\d{6}$/);
    const replay = await request('/send-code', payload);
    assert.equal(replay.response.status, 400); assert.equal(replay.data.error.code, 'CAPTCHA_INVALID');
    const registered = await request('/register', { email: payload.email, password: 'BuyerPassword@123', code: sent.data.dev_code });
    assert.equal(registered.response.status, 201); assert.ok(registered.data.token);
  });
  await t.test('non-email dev registration still requires human verification', async () => {
    const config = require('../src/config'); config.registerRequireCode = false;
    try {
      const body = { email: 'local@captcha.test', password: 'BuyerPassword@123' };
      const denied = await request('/register', body); assert.equal(denied.response.status, 400); assert.equal(denied.data.error.code, 'CAPTCHA_REQUIRED');
      const challenge = await issue('register');
      const accepted = await request('/register', { ...body, captcha: solved(challenge) }); assert.equal(accepted.response.status, 201);
    } finally { config.registerRequireCode = true; }
  });
  await t.test('password failure consumes challenge and admin can log in with a new one', async () => {
    const old = await issue('login');
    const failed = await request('/login', { email: 'admin@captcha.test', password: 'incorrect', captcha: solved(old) });
    assert.equal(failed.response.status, 401);
    const replay = await request('/login', { email: 'admin@captcha.test', password: 'CaptchaAdmin@123456', captcha: solved(old) });
    assert.equal(replay.response.status, 400); assert.equal(replay.data.error.code, 'CAPTCHA_INVALID');
    const fresh = await issue('login');
    const accepted = await request('/login', { email: 'admin@captcha.test', password: 'CaptchaAdmin@123456', captcha: solved(fresh) });
    assert.equal(accepted.response.status, 200); assert.equal(accepted.data.user.role, 'admin');
  });
  await t.test('challenge generation is rate-limited', async () => {
    let result;
    for (let i = 0; i < 31; i++) {
      result = await request('/captcha?purpose=login');
      if (result.response.status === 429) break;
    }
    assert.equal(result.response.status, 429); assert.equal(result.data.error.code, 'RATE_LIMITED');
    assert.ok(result.response.headers.get('ratelimit'));
  });
});
