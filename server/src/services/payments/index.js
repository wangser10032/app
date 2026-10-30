const config = require('../../config');
const { mockToken, paymentError } = require('./shared');
const { channelSwitchedOn } = require('../settings');
// configured：商户参数齐全（模拟模式视为齐全）；switched_on：后台开关；两者都满足才对用户开放
function channels() {
  const a = config.alipay;
  const w = config.wepay;
  return [
    { key: 'alipay', name: '支付宝', configured: config.paymentMode === 'mock' || Boolean(a.appId && a.privateKey && a.publicKey) },
    { key: 'wechat', name: '微信支付', configured: config.paymentMode === 'mock' || Boolean(w.mchid && w.appid && w.serial && w.privateKey && w.apiv3Key && w.platformPublicKey && w.platformSerial) },
  ].map(c => { const switched_on = channelSwitchedOn(c.key); return { ...c, switched_on, enabled: c.configured && switched_on }; });
}
async function createPayment({ rechargeNo, amountCents, channel, subject }) {
  const target = channels().find(c => c.key === channel);
  if (target && !target.switched_on) throw paymentError('该支付方式暂不支持，请选择其他方式', 409);
  if (!target?.enabled) throw paymentError('该支付渠道尚未配置，请联系管理员');
  if (config.paymentMode === 'real') {
    const impl = channel === 'alipay' ? require('./alipay') : require('./wechat');
    return impl.createPayment({ rechargeNo, amountCents, channel, subject });
  }
  const payUrl = `${config.publicBaseUrl}/mock/pay/${encodeURIComponent(rechargeNo)}?token=${mockToken(rechargeNo)}`;
  return { mode: 'mock', pay_url: payUrl, qr_content: payUrl, out_trade_no: rechargeNo };
}
module.exports = { createPayment, channels };
