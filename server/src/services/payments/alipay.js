const config = require('../../config');
const { readPem, paymentError } = require('./shared');
let sdk;
function client() {
  if (!sdk) {
    const { AlipaySdk } = require('alipay-sdk');
    sdk = new AlipaySdk({ appId: config.alipay.appId, privateKey: readPem(config.alipay.privateKey),
      alipayPublicKey: readPem(config.alipay.publicKey), gateway: config.alipay.gateway,
      signType: 'RSA2', timeout: 15000, camelcase: false });
  }
  return sdk;
}
async function createPayment({ rechargeNo, amountCents, subject }) {
  const result = await client().exec('alipay.trade.precreate', {
    notifyUrl: `${config.publicBaseUrl}/api/payments/alipay/notify`,
    bizContent: { out_trade_no: rechargeNo, total_amount: (amountCents / 100).toFixed(2), subject, timeout_express: '30m' },
  }, { validateSign: true });
  if (result.code !== '10000' || !result.qr_code) throw paymentError('支付宝下单失败，请稍后重试');
  return { mode: 'real', pay_url: `${config.payReturnBaseUrl}/app/recharge?no=${encodeURIComponent(rechargeNo)}`, qr_content: result.qr_code, out_trade_no: rechargeNo };
}
function verifyNotification(body) {
  if (!body || body.sign_type !== 'RSA2' || body.app_id !== config.alipay.appId) return false;
  if (config.alipay.sellerId && body.seller_id !== config.alipay.sellerId) return false;
  if (Object.values(body).some(v => typeof v !== 'string')) return false;
  // Express already decoded the form body; decoding again corrupts literal %xx.
  return client().checkNotifySignV2(body);
}
function amountInCents(value) {
  if (typeof value !== 'string' || !/^\d{1,10}(?:\.\d{1,2})?$/.test(value)) return NaN;
  const [yuan, decimal = ''] = value.split('.');
  return Number(yuan) * 100 + Number(decimal.padEnd(2, '0'));
}
module.exports = { createPayment, verifyNotification, amountInCents };
