const config = require('../../config');
const { mockToken, paymentError } = require('./shared');
function channels() {
  const a = config.alipay;
  const w = config.wepay;
  return [
    { key: 'alipay', name: '支付宝', enabled: config.paymentMode === 'mock' || Boolean(a.appId && a.privateKey && a.publicKey) },
    { key: 'wechat', name: '微信支付', enabled: config.paymentMode === 'mock' || Boolean(w.mchid && w.appid && w.serial && w.privateKey && w.apiv3Key && w.platformPublicKey && w.platformSerial) },
  ];
}
async function createPayment({ rechargeNo, amountCents, channel, subject }) {
  if (!channels().some(c => c.key === channel && c.enabled)) throw paymentError('该支付渠道尚未配置，请联系管理员');
  if (config.paymentMode === 'real') {
    const impl = channel === 'alipay' ? require('./alipay') : require('./wechat');
    return impl.createPayment({ rechargeNo, amountCents, channel, subject });
  }
  const payUrl = `${config.publicBaseUrl}/mock/pay/${encodeURIComponent(rechargeNo)}?token=${mockToken(rechargeNo)}`;
  return { mode: 'mock', pay_url: payUrl, qr_content: payUrl, out_trade_no: rechargeNo };
}
module.exports = { createPayment, channels };
