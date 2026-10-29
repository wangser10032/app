const express = require('express');
const bcrypt = require('bcryptjs');
const { randomUUID } = require('crypto');
const { rateLimit } = require('express-rate-limit');
const db = require('../db');
const config = require('../config');
const { route, fail } = require('../utils/errors');
const { z, email, password } = require('../utils/validation');
const { signToken, authRequired, publicUser } = require('../middleware/auth');
const { consumeCode, sendCode } = require('../services/mail');
const router = express.Router();
const limit = rateLimit({ windowMs: 15 * 60000, limit: 60, standardHeaders: 'draft-7', legacyHeaders: false, message: { error: { code: 'RATE_LIMITED', message: '操作过于频繁，请稍后再试' } } });
router.use(limit);
const account = address => db.prepare('SELECT * FROM users WHERE email=?').get(address);
function loggedIn(res, user, remember, status = 200) {
  if (user.status !== 'active') fail(401, 'UNAUTHORIZED', '账号已停用');
  db.prepare('UPDATE users SET last_login_at=? WHERE id=?').run(Date.now(), user.id);
  const fresh = db.prepare('SELECT * FROM users WHERE id=?').get(user.id);
  res.status(status).json({ token: signToken(fresh, remember), user: publicUser(fresh) });
}
router.post('/send-code', route(async (req, res) => {
  const body = z.object({ email, purpose: z.enum(['register', 'login', 'reset']) }).parse(req.body);
  const user = account(body.email);
  if (body.purpose === 'register' && user) fail(409, 'EMAIL_EXISTS', '此邮箱已注册');
  if (body.purpose !== 'register' && (!user || user.status !== 'active')) return res.json({ ok: true });
  res.json(await sendCode(body.email, body.purpose));
}));
router.post('/register', route(async (req, res) => {
  const body = z.object({ email, password, nickname: z.string().trim().max(60).default(''), code: z.string().max(6).optional() }).parse(req.body);
  if (account(body.email)) fail(409, 'EMAIL_EXISTS', '此邮箱已注册');
  if (config.registerRequireCode) consumeCode(body.email, 'register', body.code || '');
  const hash = await bcrypt.hash(body.password, 12);
  const user = db.transaction(() => {
    if (account(body.email)) fail(409, 'EMAIL_EXISTS', '此邮箱已注册');
    const id = randomUUID();
    db.prepare('INSERT INTO users(id,email,password_hash,nickname,created_at) VALUES(?,?,?,?,?)').run(id, body.email, hash, body.nickname, Date.now());
    return db.prepare('SELECT * FROM users WHERE id=?').get(id);
  })();
  loggedIn(res, user, false, 201);
}));
router.post('/login', route(async (req, res) => {
  const body = z.object({ email, password: z.string().min(1).max(200), remember: z.boolean().optional() }).parse(req.body);
  const user = account(body.email);
  // A fixed bcrypt comparison also gives unknown accounts a password-work cost.
  const good = await bcrypt.compare(body.password, user?.password_hash || '$2a$12$Gq0S0XJDt2znPlK1R./oEepRLeUQXR0U8u0P.VOzaq2vVeQwuMace');
  if (!user || !good || user.status !== 'active') fail(401, 'UNAUTHORIZED', '邮箱或密码错误，或账号已停用');
  loggedIn(res, user, body.remember);
}));
router.post('/login-code', route((req, res) => {
  const body = z.object({ email, code: z.string().regex(/^\d{6}$/), remember: z.boolean().optional() }).parse(req.body);
  const user = account(body.email);
  if (!user || user.status !== 'active') fail(401, 'UNAUTHORIZED', '账号不可用');
  consumeCode(body.email, 'login', body.code);
  loggedIn(res, user, body.remember);
}));
router.post('/reset-password', route(async (req, res) => {
  const body = z.object({ email, code: z.string().regex(/^\d{6}$/), password }).parse(req.body);
  const user = account(body.email);
  if (!user || user.status !== 'active') fail(400, 'CODE_INVALID', '验证码无效');
  consumeCode(body.email, 'reset', body.code);
  const hash = await bcrypt.hash(body.password, 12);
  db.prepare('UPDATE users SET password_hash=?,token_version=token_version+1 WHERE id=?').run(hash, user.id);
  res.json({ ok: true });
}));
router.get('/me', authRequired, (req, res) => res.json({ user: publicUser(req.user) }));
router.patch('/me', authRequired, route((req, res) => {
  const body = z.object({ nickname: z.string().trim().max(60) }).parse(req.body);
  db.prepare('UPDATE users SET nickname=? WHERE id=?').run(body.nickname, req.user.id);
  res.json({ user: publicUser(db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id)) });
}));
router.post('/change-password', authRequired, route(async (req, res) => {
  const body = z.object({ old_password: z.string().max(200), new_password: password }).parse(req.body);
  const user = db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id);
  if (!await bcrypt.compare(body.old_password, user.password_hash)) fail(400, 'VALIDATION_ERROR', '原密码错误');
  const hash = await bcrypt.hash(body.new_password, 12);
  db.prepare('UPDATE users SET password_hash=?,token_version=token_version+1 WHERE id=?').run(hash, user.id);
  res.json({ ok: true });
}));
module.exports = router;
