const db = require('../db');
// 站点设置：支付渠道开关以 '1'/'0' 保存；接入说明为后台编写的 Markdown，留空时使用默认模板。
const KEYS = ['site_name', 'announcement', 'pay_alipay_enabled', 'pay_wechat_enabled', 'docs_markdown'];
const DEFAULTS = { pay_alipay_enabled: '1', pay_wechat_enabled: '1', docs_markdown: '' };
const DEFAULT_DOCS = `## 查看代理账号

在「静态住宅 → 已购 IP」中点击「查看账号密码」，复制代理地址、用户名和密码。每组凭据只连接其绑定的固定 IP。

## 接入示例

代理地址：\`{{gateway}}\`。同一个地址和端口同时支持 HTTP、HTTPS 与 SOCKS5：

- HTTP 客户端选择 HTTP 代理，访问 HTTPS 网站时自动通过 CONNECT 隧道；
- SOCKS5 客户端选择 SOCKS5，填写同一组用户名和密码。

\`\`\`bash
# HTTP / HTTPS
curl --proxy http://{{gateway}} \\
  --proxy-user '代理用户名:代理密码' \\
  https://example.com

# SOCKS5
curl --proxy socks5h://{{gateway}} \\
  --proxy-user '代理用户名:代理密码' \\
  https://example.com
\`\`\`

## 租期与续费

按 IP 数量和租期计费，购买后固定分配，到期停止连接。在已购 IP 列表中点击续费，余额足够时延长原 IP 的租期。已到期且被重新分配的 IP 无法恢复，需重新购买。

## 连接异常

- **407 认证失败**：检查代理账号密码、IP 到期时间与账号状态。
- **502 上游不可用**：该固定 IP 暂时无法连接，请联系管理员。系统不会将其自动切换为其他 IP。
`;
const getSettings = () => ({ ...DEFAULTS, ...Object.fromEntries(db.prepare(`SELECT key,value FROM settings WHERE key IN (${KEYS.map(() => '?').join(',')})`).all(...KEYS).map(r => [r.key, r.value])) });
const channelSwitchedOn = key => getSettings()[`pay_${key}_enabled`] !== '0';
const docsMarkdown = () => getSettings().docs_markdown || DEFAULT_DOCS;
function setSettings(data) {
  db.transaction(() => {
    const put = db.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value');
    for (const [key, value] of Object.entries(data)) put.run(key, String(value));
  })();
  return getSettings();
}
module.exports = { getSettings, setSettings, channelSwitchedOn, docsMarkdown, DEFAULT_DOCS };
