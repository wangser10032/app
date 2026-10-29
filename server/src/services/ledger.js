const db = require('../db');
const { randomUUID } = require('crypto');
const { fail } = require('../utils/errors');
const addLedger = db.transaction(({ userId, type, amountCents, refType = '', refId = '', remark = '' }) => {
  if (!Number.isSafeInteger(amountCents) || !amountCents) fail(400, 'VALIDATION_ERROR', '金额必须为非零整数分');
  const user = db.prepare('SELECT balance_cents FROM users WHERE id=?').get(userId);
  if (!user) fail(404, 'NOT_FOUND', '用户不存在');
  const after = user.balance_cents + amountCents;
  if (!Number.isSafeInteger(after) || after < 0) fail(409, 'NO_ENOUGH_BALANCE', '余额不足，无法完成扣款');
  const entry = { id: randomUUID(), user_id: userId, type, amount_cents: amountCents, balance_after_cents: after, ref_type: refType, ref_id: refId, remark, created_at: Date.now() };
  db.prepare('UPDATE users SET balance_cents=? WHERE id=?').run(after, userId);
  db.prepare('INSERT INTO ledger(id,user_id,type,amount_cents,balance_after_cents,ref_type,ref_id,remark,created_at) VALUES(@id,@user_id,@type,@amount_cents,@balance_after_cents,@ref_type,@ref_id,@remark,@created_at)').run(entry);
  return entry;
});
module.exports = { addLedger };
