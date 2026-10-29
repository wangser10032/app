const crypto = require('crypto');
const nodemailer = require('nodemailer');
const config = require('../config');
const db = require('../db');
const { fail } = require('../utils/errors');
const hashCode = (email, purpose, code) => crypto.createHmac('sha256', config.jwtSecret).update(`${email}:${purpose}:${code}`).digest('hex');
async function sendCode(email, purpose) {
  const recent = db.prepare('SELECT created_at FROM email_codes WHERE email=? ORDER BY created_at DESC LIMIT 1').get(email);
  if (recent && recent.created_at > Date.now() - 60000) fail(429, 'RATE_LIMITED', '验证码已发送，请 60 秒后再试');
  const code = String(crypto.randomInt(100000, 1000000));
  const id = crypto.randomUUID();
  // Insert before awaiting SMTP to ensure simultaneous requests share the cooldown.
  db.transaction(() => {
    db.prepare('UPDATE email_codes SET used_at=? WHERE email=? AND purpose=? AND used_at IS NULL').run(Date.now(), email, purpose);
    db.prepare('INSERT INTO email_codes(id,email,code,purpose,expires_at,created_at) VALUES(?,?,?,?,?,?)').run(id, email, hashCode(email, purpose, code), purpose, Date.now() + 600000, Date.now());
    db.prepare('DELETE FROM email_codes WHERE created_at<?').run(Date.now() - 86400000);
  })();
  try {
    if (config.mailMode === 'smtp') {
      const transport = nodemailer.createTransport({ host: config.smtp.host, port: config.smtp.port, secure: config.smtp.port === 465, auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.pass } : undefined, connectionTimeout: 10000 });
      await transport.sendMail({ from: config.smtp.from, to: email, subject: 'ResiHub 邮箱验证码', text: `您的验证码为 ${code}，10 分钟内有效。请勿向他人泄露验证码。如果不是您本人操作，请忽略此邮件。` });
    }
  } catch (error) { db.prepare('DELETE FROM email_codes WHERE id=?').run(id); fail(503, 'MAIL_FAILED', '邮件发送失败，请稍后再试'); }
  return config.mailMode === 'mock' ? { ok: true, dev_code: code } : { ok: true };
}
function consumeCode(email, purpose, code) {
  const row = db.prepare('SELECT * FROM email_codes WHERE email=? AND purpose=? AND used_at IS NULL ORDER BY created_at DESC LIMIT 1').get(email, purpose);
  if (!row || row.attempts >= 5) fail(400, 'CODE_INVALID', '验证码无效，请重新获取');
  if (row.expires_at <= Date.now()) fail(400, 'CODE_EXPIRED', '验证码已过期');
  db.prepare('UPDATE email_codes SET attempts=attempts+1 WHERE id=?').run(row.id);
  const expected = hashCode(email, purpose, code);
  if (row.code !== expected) fail(400, 'CODE_INVALID', '验证码错误');
  db.prepare('UPDATE email_codes SET used_at=? WHERE id=?').run(Date.now(), row.id);
}
module.exports = { sendCode, consumeCode };
