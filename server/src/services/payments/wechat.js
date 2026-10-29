const crypto = require('crypto');
const config = require('../../config');
const { readPem, paymentError } = require('./shared');
function verifySignature(headers, rawBody) {
  const get = key => typeof headers.get === 'function' ? headers.get(key) : headers[key.toLowerCase()];
  const timestamp = get('Wechatpay-Timestamp');
  const nonce = get('Wechatpay-Nonce');
  const serial = get('Wechatpay-Serial');
  const signature = get('Wechatpay-Signature');
  if (!timestamp || !/^\d+$/.test(timestamp) || Math.abs(Date.now() / 1000 - Number(timestamp)) > 300 || !nonce || !signature || serial !== config.wepay.platformSerial) return false;
  return crypto.verify('RSA-SHA256', Buffer.from(`${timestamp}\n${nonce}\n${rawBody.toString('utf8')}\n`), readPem(config.wepay.platformPublicKey), Buffer.from(signature, 'base64'));
}
function decryptNotification(body) {
  const resource = body && body.resource;
  if (!resource || resource.algorithm !== 'AEAD_AES_256_GCM' || Buffer.byteLength(config.wepay.apiv3Key) !== 32) throw paymentError('微信通知格式错误', 400);
  const ciphertext = Buffer.from(resource.ciphertext, 'base64');
  if (ciphertext.length < 17) throw paymentError('微信通知密文无效', 400);
  const decipher = crypto.createDecipheriv('aes-256-gcm', Buffer.from(config.wepay.apiv3Key), Buffer.from(resource.nonce));
  decipher.setAuthTag(ciphertext.subarray(-16));
  decipher.setAAD(Buffer.from(resource.associated_data || ''));
  return JSON.parse(Buffer.concat([decipher.update(ciphertext.subarray(0, -16)), decipher.final()]).toString('utf8'));
}
async function createPayment({ rechargeNo, amountCents, subject }) {
  const w = config.wepay;
  const uri = '/v3/pay/transactions/native';
  const body = JSON.stringify({ appid: w.appid, mchid: w.mchid, description: subject,
    out_trade_no: rechargeNo, notify_url: `${config.publicBaseUrl}/api/payments/wechat/notify`,
    time_expire: new Date(Date.now() + 30 * 60000).toISOString(), amount: { total: amountCents, currency: 'CNY' } });
  const nonce = crypto.randomBytes(16).toString('hex');
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = crypto.sign('RSA-SHA256', Buffer.from(`POST\n${uri}\n${timestamp}\n${nonce}\n${body}\n`), readPem(w.privateKey)).toString('base64');
  const authorization = `WECHATPAY2-SHA256-RSA2048 mchid="${w.mchid}",nonce_str="${nonce}",timestamp="${timestamp}",serial_no="${w.serial}",signature="${signature}"`;
  const response = await fetch(`https://api.mch.weixin.qq.com${uri}`, { method: 'POST', headers: {
    Authorization: authorization, 'Content-Type': 'application/json', Accept: 'application/json',
    'Wechatpay-Serial': w.platformSerial, 'User-Agent': 'ResiHub/1.0' }, body, signal: AbortSignal.timeout(15000) });
  const raw = await response.text();
  if (!response.ok) throw paymentError('微信支付下单失败，请检查商户配置或稍后重试');
  if (!verifySignature(response.headers, raw)) throw paymentError('微信支付响应验签失败');
  const result = JSON.parse(raw);
  if (!result.code_url) throw paymentError('微信支付未返回有效二维码');
  return { mode: 'real', pay_url: `${config.payReturnBaseUrl}/app/recharge?no=${encodeURIComponent(rechargeNo)}`, qr_content: result.code_url, out_trade_no: rechargeNo };
}
module.exports = { createPayment, verifySignature, decryptNotification };
