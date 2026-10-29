const jwt = require('jsonwebtoken');
const db = require('../db');
const config = require('../config');
const { fail } = require('../utils/errors');
const fields = 'id,email,nickname,role,status,balance_cents,created_at,last_login_at';
function publicUser(user) { const { password_hash, token_version, ...rest } = user; return rest; }
function signToken(user, remember = false) {
  return jwt.sign({ uid: user.id, role: user.role, ver: user.token_version || 0 }, config.jwtSecret, { algorithm: 'HS256', expiresIn: remember ? '30d' : '7d', issuer: 'resihub' });
}
function authRequired(req, res, next) {
  try {
    const value = req.get('Authorization') || '';
    if (!value.startsWith('Bearer ')) fail(401, 'UNAUTHORIZED', '请先登录');
    let token;
    try { token = jwt.verify(value.slice(7), config.jwtSecret, { algorithms: ['HS256'], issuer: 'resihub' }); }
    catch { fail(401, 'UNAUTHORIZED', '登录已失效，请重新登录'); }
    const user = db.prepare(`SELECT ${fields},token_version FROM users WHERE id=?`).get(token.uid);
    if (!user || user.status !== 'active' || user.token_version !== (token.ver || 0)) fail(401, 'UNAUTHORIZED', '账号不可用或登录已失效');
    req.user = user; next();
  } catch (err) { next(err); }
}
function adminRequired(req, res, next) {
  if (req.user?.role !== 'admin') return next(Object.assign(new Error('仅管理员可执行此操作'), { status: 403, code: 'FORBIDDEN' }));
  next();
}
module.exports = { signToken, authRequired, adminRequired, publicUser, fields };
