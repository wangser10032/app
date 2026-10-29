// 模拟收银台页面 GET /mock/pay/:no（基线实现；支付 agent 可美化）
const express = require('express');
const router = express.Router();
const { verifyMockToken } = require('../services/payments/shared');

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

router.get('/mock/pay/:no', async (req, res) => {
  const config = require('../config');
  if (config.paymentMode === 'real' || config.production) {
    return res.status(404).send('Not Found');
  }
  if (!verifyMockToken(req.params.no, req.query.token)) return res.status(403).send('无效的模拟收银台凭证');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Cache-Control', 'no-store');
  const rechargeService = require('../services/recharge');
  const recharge = await rechargeService.getByNo(req.params.no);
  if (!recharge) return res.status(404).send('充值单不存在');
  const amount = (recharge.amount_cents / 100).toFixed(2);
  const channelName = { alipay: '支付宝', wechat: '微信支付', manual: '人工' }[recharge.channel] || recharge.channel;
  const done = recharge.status !== 'pending';
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  if (done) {
    const label = recharge.status === 'paid' ? '✅ 已支付' : '❌ 已关闭';
    return res.send(`<!doctype html><html lang="zh"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>ResiHub 收银台</title>
<body style="font-family:system-ui;background:#fafaf9;display:flex;align-items:center;justify-content:center;height:100vh;margin:0">
  <div style="background:#fff;border-radius:24px;box-shadow:0 10px 40px rgba(0,0,0,.06);padding:48px 64px;text-align:center">
    <div style="font-size:40px">${label}</div>
    <p style="color:#78716c">单号 ${esc(recharge.recharge_no)}</p>
  </div>
</body></html>`);
  }
  res.send(`<!doctype html><html lang="zh"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>ResiHub 模拟收银台</title>
<body style="font-family:system-ui;background:#fafaf9;display:flex;align-items:center;justify-content:center;height:100vh;margin:0">
  <div style="background:#fff;border-radius:24px;box-shadow:0 10px 40px rgba(0,0,0,.06);padding:32px 20px;text-align:center;width:min(360px,calc(100vw - 80px))">
    <div style="font-weight:700;font-size:18px;color:#1c1917;margin-bottom:8px">ResiHub 模拟收银台</div>
    <div style="color:#78716c;font-size:13px;margin-bottom:16px">充值单号 ${esc(recharge.recharge_no)}</div>
    <div style="font-size:36px;font-weight:800;color:#1c1917">¥${amount}</div>
    <div style="color:#78716c;font-size:13px;margin:8px 0 28px">支付渠道：${esc(channelName)}（模拟环境）</div>
    <div id="msg" style="height:20px;color:#16a34a;font-size:14px"></div>
    <div style="display:flex;gap:12px;justify-content:center;margin-top:8px">
      <button id="pay-success" style="background:#0e7490;color:#fff;border:0;border-radius:999px;padding:12px 20px;font-size:15px;font-weight:600;cursor:pointer">模拟支付成功</button>
      <button id="pay-fail" style="background:#fff;color:#78716c;border:1px solid #e7e5e4;border-radius:999px;padding:12px 20px;font-size:15px;cursor:pointer">模拟失败</button>
    </div>
  </div>
<script>
async function pay(result){
  const token = new URLSearchParams(location.search).get('token');
  const r = await fetch('/api/payments/mock/confirm',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({recharge_no:${JSON.stringify(recharge.recharge_no)},token,result})});
  const d = await r.json().catch(()=>({}));
  const el = document.getElementById('msg');
  if(r.ok){ el.style.color = result==='success' ? '#16a34a' : '#dc2626'; el.textContent = result==='success' ? '支付成功！可关闭本页回到平台查看余额' : '已标记为支付失败'; setTimeout(()=>location.reload(), 1200); }
  else { el.style.color = '#dc2626'; el.textContent = (d.error&&d.error.message)||'操作失败'; }
}
document.getElementById('pay-success').addEventListener('click',()=>pay('success'));
document.getElementById('pay-fail').addEventListener('click',()=>pay('fail'));
</script>
</body></html>`);
});

module.exports = router;
