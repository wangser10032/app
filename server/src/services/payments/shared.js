const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const config = require('../../config');

function paymentError(message, status = 503) {
  return Object.assign(new Error(message), { status, statusCode: status, code: 'PAYMENT_UNAVAILABLE' });
}
function readPem(value) {
  if (!value) throw paymentError('支付密钥未配置');
  if (value.includes('-----BEGIN')) return value.replace(/\\n/g, '\n');
  return fs.readFileSync(path.resolve(path.join(__dirname, '../../..'), value), 'utf8');
}
function mockToken(no) {
  return crypto.createHmac('sha256', config.jwtSecret).update(`resihub-mock:${no}`).digest('hex');
}
function verifyMockToken(no, token) {
  if (typeof no !== 'string' || typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) return false;
  return crypto.timingSafeEqual(Buffer.from(mockToken(no)), Buffer.from(token));
}
function assertPaidRecharge(no, channel, amount) {
  const row = require('../recharge').getByNo(no);
  if (!row || row.channel !== channel || !Number.isSafeInteger(amount) || row.amount_cents !== amount) throw paymentError('支付订单、渠道或金额不匹配', 400);
  return row;
}
module.exports = { paymentError, readPem, mockToken, verifyMockToken, assertPaidRecharge };
