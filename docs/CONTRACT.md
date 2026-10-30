# ResiHub 住宅代理售卖平台 · 全局开发契约 v1

> **当前业务已改为静态住宅 IP 租赁。** 本文以下内容仅保留历史设计记录，当前实现与接口以 [STATIC-CONTRACT.md](STATIC-CONTRACT.md) 为准。流量套餐、流量计费、池内随机路由均已停用。

## 2026-10-28 已实现修订

以下修订优先于本文早期设计草案；后续维护以实际代码、测试及专门文档为准。

- 用户前台、后台及全部核心接口已落地。React Router 已升级至 7.18.4，Zod 已升级至 4.6.7；PATCH 使用独立无默认值 schema，不能再复用带 create 默认值的 schema。
- 界面采用冷白、海军蓝及蓝绿色强调；前后台同源统一从 8080 托管。
- 本机开发容器启动自动检查依赖、构建两套前端并启动 API/网关，健康检查真实调用 `/api/health`。管理员密码与 JWT 自动随机生成，资料保存在不进入 Git 的 `.local/ACCESS.md`，不再使用固定开发管理员密码。生产首次初始化仍必须提供有效管理员配置。
- 网站新密码至少 10 字符且不超过 72 个 UTF-8 字节。改密/停用使旧 JWT 失效；验证码哈希存储，包含单次使用与尝试上限。
- 新增 `PATCH /api/auth/me` 与 `PATCH /api/me/profile` 更新昵称。`POST /api/me/orders` 接受 `Idempotency-Key` 防止重试重复扣费。
- `POST /api/payments/mock/confirm` 必须携带充值链接的 HMAC `token`，且生产/真实模式禁用。两个真实渠道已实现签名、商户与金额校验；已验签真实成功通知可以恢复本地失败/过期单，重复通知不重复入账。详见 [PAYMENTS.md](PAYMENTS.md)。
- 网关流量按 chunk 实时精确扣减，额度耗尽、账号或凭证失效时断开，不再允许当前连接无限超额；不按每连接保留两位小数。普通 HTTP 计正文、CONNECT 计隧道双向字节。详见 [GATEWAY.md](GATEWAY.md)。
- 生产镜像、Caddy 编排、在线备份及配置校验已提供。当前验收范围为本机 Docker Linux 可运行版本；真实商户/SMTP/住宅资源与远程服务器尚未验证，不能据此宣称公网正式运营。

> **本文件是所有并行开发 Agent 的唯一事实来源（Single Source of Truth）。**
> 任何模块间的依赖（数据库表、API 形状、函数签名、挂载点）都以本文件为准。
> 开发环境为 Windows，但**代码必须兼容 Linux 生产环境**：只用跨平台 API、路径用 `path.join`、不写死盘符、不依赖 shell 特性。

---

## 0. 项目概述与技术栈

**ResiHub** 是一个面向少量用户的住宅代理（Residential Proxy）售卖平台：

- 用户邮箱注册/登录（支持密码登录与邮箱验证码登录）
- 余额体系：支付宝 / 微信扫码充值 → 余额（账单流水）
- 用余额购买流量套餐（Package）→ 获得流量包（Entitlement，有额度与有效期）
- 用户创建代理密钥（Proxy Key，用户名+密码），通过 **HTTP 代理网关**使用住宅 IP
- 网关按流量计费：从用户流量包中扣减，并记录用量明细
- 管理后台：用户/充值/订单/套餐/IP 池/用量/系统设置

| 组件 | 技术栈 | 目录 | 开发端口 | 生产说明 |
|---|---|---|---|---|
| 后端 API | Node.js 20+ / Express 4 / CommonJS / better-sqlite3 / zod | `server/` | 8080 | systemd 或 docker |
| 代理网关 | Node.js 原生 http/net（与后端同进程，不同端口） | `server/src/gateway/` | 3128 | 需放行防火墙 |
| 用户前台 | React 18 + TypeScript + Vite 5 + TailwindCSS 3 + react-router 6 | `web/` | 5173(dev) | 构建为静态文件，由后端 `/` 托管 |
| 管理后台 | 同上（独立 Vite 应用） | `admin/` | 5174(dev) | 构建为静态文件，由后端 `/admin` 托管 |
| 数据库 | SQLite（better-sqlite3，WAL 模式） | `server/data/resihub.db` | — | 少量用户完全够用 |

**通用约定**

- 所有金额一律用**整数分**（`*_cents`），展示层 ÷100 保留两位小数，前缀 `¥`。
- 所有时间为 **Unix 毫秒时间戳**（INTEGER）。
- 所有 ID 为 `crypto.randomUUID()` 生成的 TEXT UUID。
- 订单号：`O` + yyyyMMddHHmmss + 4 位随机；充值号：`R` + 同规则。
- 列表接口统一分页：`?page=1&page_size=20` → 响应 `{ items, total, page, page_size }`。
- 成功响应直接返回资源 JSON；错误统一 `4xx/5xx` + `{ "error": { "code": "...", "message": "中文提示" } }`。
- 错误码枚举：`VALIDATION_ERROR / UNAUTHORIZED / FORBIDDEN / NOT_FOUND / EMAIL_EXISTS / CODE_INVALID / CODE_EXPIRED / NO_ENOUGH_BALANCE / PACKAGE_DISABLED / KEY_LIMIT / RATE_LIMITED / INTERNAL`。
- 鉴权：`Authorization: Bearer <JWT>`；JWT payload `{ uid, role }`；有效期 remember ? 30d : 7d。
- 角色枚举：`user` / `admin`。
- 服务端代码风格：CommonJS，`require`，无构建步骤。

---

## 1. 数据库 Schema（SQLite，server/src/db/schema.sql）

```sql
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  nickname TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL DEFAULT 'user',            -- user | admin
  status TEXT NOT NULL DEFAULT 'active',        -- active | disabled
  balance_cents INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  last_login_at INTEGER
);

CREATE TABLE IF NOT EXISTS email_codes (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  code TEXT NOT NULL,                            -- 6 位数字
  purpose TEXT NOT NULL,                         -- register | login | reset
  expires_at INTEGER NOT NULL,                   -- 10 分钟有效
  used_at INTEGER,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS packages (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  traffic_mb INTEGER NOT NULL,
  price_cents INTEGER NOT NULL,
  duration_days INTEGER NOT NULL DEFAULT 30,
  status TEXT NOT NULL DEFAULT 'active',        -- active | disabled
  sort INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS recharges (
  id TEXT PRIMARY KEY,
  recharge_no TEXT UNIQUE NOT NULL,
  user_id TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  channel TEXT NOT NULL,                         -- alipay | wechat | manual
  status TEXT NOT NULL DEFAULT 'pending',       -- pending | paid | failed | expired
  pay_url TEXT NOT NULL DEFAULT '',
  qr_content TEXT NOT NULL DEFAULT '',
  out_trade_no TEXT NOT NULL DEFAULT '',
  paid_at INTEGER,
  created_at INTEGER NOT NULL,
  meta TEXT NOT NULL DEFAULT '{}'               -- 支付回调原始数据 JSON
);

CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  order_no TEXT UNIQUE NOT NULL,
  user_id TEXT NOT NULL,
  package_id TEXT NOT NULL,
  package_name TEXT NOT NULL,                    -- 快照，防止套餐后续被改
  traffic_mb INTEGER NOT NULL,
  amount_cents INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'paid',          -- paid | cancelled | refunded
  paid_at INTEGER,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS entitlements (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  order_id TEXT,                                 -- gift/admin 来源可为 NULL
  source TEXT NOT NULL DEFAULT 'order',         -- order | gift | admin
  quota_mb REAL NOT NULL,
  used_mb REAL NOT NULL DEFAULT 0,
  expires_at INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',        -- active | exhausted | expired
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS ledger (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  type TEXT NOT NULL,                            -- recharge | purchase | adjust
  amount_cents INTEGER NOT NULL,                 -- 正=入账，负=出账
  balance_after_cents INTEGER NOT NULL,
  ref_type TEXT NOT NULL DEFAULT '',             -- recharge | order | admin
  ref_id TEXT NOT NULL DEFAULT '',
  remark TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS proxy_keys (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  username TEXT UNIQUE NOT NULL,                 -- 网关认证用户名，如 rh_a1b2c3d4
  password_hash TEXT NOT NULL,                   -- bcrypt
  label TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active',        -- active | disabled
  country_filter TEXT NOT NULL DEFAULT '',       -- 空为不限；如 US/JP/DE
  created_at INTEGER NOT NULL,
  last_used_at INTEGER
);

CREATE TABLE IF NOT EXISTS ip_pool (
  id TEXT PRIMARY KEY,
  host TEXT NOT NULL,
  port INTEGER NOT NULL,
  protocol TEXT NOT NULL DEFAULT 'http',        -- http | socks5
  upstream_user TEXT NOT NULL DEFAULT '',
  upstream_pass TEXT NOT NULL DEFAULT '',
  country TEXT NOT NULL DEFAULT '',
  region TEXT NOT NULL DEFAULT '',
  city TEXT NOT NULL DEFAULT '',
  isp TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active',        -- active | disabled
  fail_count INTEGER NOT NULL DEFAULT 0,
  last_ok_at INTEGER,
  last_check_at INTEGER,
  created_at INTEGER NOT NULL,
  UNIQUE(host, port)
);

CREATE TABLE IF NOT EXISTS usage_records (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  key_id TEXT NOT NULL,
  ip_id TEXT NOT NULL,
  bytes_in INTEGER NOT NULL DEFAULT 0,
  bytes_out INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_usage_user ON usage_records(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_ledger_user ON ledger(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_recharge_user ON recharges(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_ip_country ON ip_pool(country, status);
```

**首次启动种子数据**（`db/index.js` 初始化时若 `users` 表为空则执行 `db/seed.js`）：

- 管理员：`admin@resihub.local` / `Admin@123456`（role=admin，README 中注明必须修改）。
- 套餐：体验包 1GB ¥9.9(990)/30天；基础包 10GB ¥69(6900)/30天；标准包 50GB ¥299(29900)/30天；大额包 200GB ¥999(99900)/30天。
- settings 默认值：`site_name="ResiHub"`、`announcement=""`、`register_gift_mb="0"`。

**settings 允许的 key**（白名单）：`site_name`、`announcement`、`register_gift_mb`。

**核心业务规则（必须一致实现）**

- 注册成功：若 `settings.register_gift_mb > 0`，自动创建一条 `entitlements(source='gift')`，不写 ledger。
- 购买套餐（POST /api/me/orders）：单事务内校验余额 → 扣余额 → 写 `orders(paid)` → 写 `entitlements(source='order', expires_at=now+duration_days*86400e3)` → 写 `ledger(type='purchase', 负金额, balance_after)`。
- 充值成功（markRechargePaid）：幂等（已 paid 直接返回）；事务内 `recharges.status=paid, paid_at, out_trade_no` → `users.balance_cents += amount` → `ledger(type='recharge', 正金额, ref_type='recharge', ref_id=recharge.id)`。
- 余额调整（管理员）：事务内改余额 + `ledger(type='adjust', 正负金额, ref_type='admin', remark)`。
- 流量扣减（consumeTraffic）：按 `status='active' AND expires_at>now AND used_mb<quota_mb` 的 entitlements 以 `expires_at ASC` 顺序扣；扣完后 `used_mb>=quota_mb` 置 `status='exhausted'`；过期置 `expired`（查询时顺带修正）。
- hasActiveQuota：上述有效 entitlements 的 `SUM(quota_mb-used_mb) > 0`。

---

## 2. 服务端内部模块契约（跨 Agent 依赖的函数签名）

### 2.1 `src/services/usage.js`（后端核心实现，网关调用）

```js
// 返回用户流量额度汇总（含过期状态修正）
getQuotaSummary(userId) ->
  { quota_total_mb, quota_used_mb, remaining_mb, active_count }
// 是否还有可用流量（网关建连前检查）
hasActiveQuota(userId) -> boolean
// 记录并扣减流量（网关连接结束时调用）；bytes 为双向总字节数
// mb = bytes / (1024*1024)，保留 2 位小数
consumeTraffic(userId, bytes) -> { ok: true, recorded_mb, remaining_mb }
// 写入 usage_records 明细
recordUsage({ userId, keyId, ipId, bytesIn, bytesOut }) -> void
// 注册赠送流量
addGiftEntitlement(userId, mb, remark) -> void
```

### 2.2 `src/services/recharge.js`（后端核心实现，支付模块调用）

```js
createRecharge(userId, amountCents, channel) -> rechargeRow   // 生成 recharge_no，status=pending
getByNo(rechargeNo) -> rechargeRow | null
markRechargePaid(rechargeNo, { outTradeNo, channel, source, raw }) -> { ok, already, recharge }
  // source: 'mock' | 'alipay' | 'wechat' | 'manual'；幂等；raw 存入 meta
markRechargeFailed(rechargeNo, { source, raw }) -> { ok }
```

### 2.3 `src/services/ledger.js`

```js
addLedger({ userId, type, amountCents, refType, refId, remark }) -> ledgerRow
  // 事务内：更新 users.balance_cents 并写流水，返回 balance_after
```

### 2.4 `src/middleware/auth.js`

```js
signToken(user, remember) -> string             // { uid, role }
authRequired    // express 中间件：校验 Bearer，req.user = { id, email, role, status,... }；禁用用户 401
adminRequired   // express 中间件：非 admin 403
```

### 2.5 `src/services/payments/index.js`（支付模块入口，后端核心只 import 不修改）

```js
createPayment({ rechargeNo, amountCents, channel, subject }) ->
  Promise<{ mode: 'mock'|'real', pay_url: string, qr_content: string, out_trade_no: string }>
  // mock 模式：pay_url = `${PUBLIC_BASE_URL}/mock/pay/${rechargeNo}`，qr_content 同 pay_url
  // real 模式：alipay → 当面付 precreate 的二维码串；wechat → Native 下单 code_url
  //           pay_url = 前端收银页 `${PAY_RETURN_BASE_URL}/app/recharge?no=${rechargeNo}`
```

### 2.6 `src/gateway/start.js`（网关模块入口，后端核心只 import 不修改）

```js
startGateway({ port }) -> http.Server   // 独立监听 GATEWAY_PORT；失败抛错
stopGateway() -> void
```

### 2.7 主入口挂载点（`src/index.js`，后端核心实现）

```js
app.use('/api/payments', require('./routes/payments'));   // 支付相关路由（含回调）
app.use('/', require('./routes/mock-pay'));               // 模拟收银台页面 GET /mock/pay/:no
if (fs.existsSync(path.join(__dirname, 'gateway/start.js'))) {
  const { startGateway } = require('./gateway/start');
  startGateway({ port: config.gatewayPort });
}
// 静态托管：web/dist 挂 '/'（SPA fallback 到 web/index.html，但排除 /api、/admin、/mock）；
// admin/dist 挂 '/admin'（SPA fallback 到 admin/index.html）
```

---

## 3. REST API 全量契约

前缀 `/api`。除标注 `公开` 外均需 `authRequired`；标注 `admin` 的需 `adminRequired`。

### 认证（公开，需限流）

| 方法 | 路径 | 请求体 | 响应 |
|---|---|---|---|
| GET | /api/auth/captcha?purpose=register\|login\|reset | 无 | `{id,image,expires_at}`；PNG 图形验证码，有效期 5 分钟，响应不含答案 |
| POST | /api/auth/register | `{email, password, nickname?, code?, captcha?}` | 201 `{token, user}`；默认验证受人机验证保护的邮箱 code；关闭邮箱验证且未传 code 时仍须 captcha |
| POST | /api/auth/login | `{email, password, remember?, captcha:{id,answer}}` | `{token, user}`；图形验证失败为 400，账号或密码失败为 `UNAUTHORIZED` |
| POST | /api/auth/login-code | `{email, code, remember?}` | `{token, user}` |
| POST | /api/auth/send-code | `{email, purpose: register\|login\|reset, captcha:{id,answer}}` | `{ok, dev_code?}`（dev_code 仅 MAIL_MODE=mock 时返回）；图形验证在发送前消费 |
| POST | /api/auth/reset-password | `{email, code, password}` | `{ok}` |
| GET | /api/auth/me | — | `{user}` |
| POST | /api/auth/change-password | `{old_password, new_password}` | `{ok}` |

`user` 对象：`{id, email, nickname, role, status, balance_cents, created_at, last_login_at}`（不含 password_hash）。

### 公开套餐

| GET | /api/packages | → `{items:[{id,name,description,traffic_mb,price_cents,duration_days,sort}]}`（仅 active，按 sort 升序） |
|---|---|---|

### 用户侧（authRequired）

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | /api/me/summary | `{balance_cents, quota_total_mb, quota_used_mb, remaining_mb, active_entitlements, proxy_keys, site_name, announcement, gateway_endpoint}`（gateway_endpoint=`PUBLIC_GATEWAY_HOST:GATEWAY_PORT`） |
| GET | /api/me/transactions?type?&page&page_size | 账单流水 `items:[{id,type,amount_cents,balance_after_cents,remark,ref_type,ref_id,created_at}]` |
| GET | /api/me/entitlements | `items:[{id,source,package_name?,quota_mb,used_mb,remaining_mb,expires_at,status,created_at}]`（关联 orders 取 package_name，gift 来源则为 "注册赠送" 等） |
| GET | /api/me/orders?status?&page | `items:[{id,order_no,package_name,traffic_mb,amount_cents,status,paid_at,created_at}]` |
| POST | /api/me/orders | `{package_id}` → 201 `{order}`；余额不足 `NO_ENOUGH_BALANCE`；套餐停用 `PACKAGE_DISABLED` |
| GET | /api/me/recharges?status?&page | `items:[{id,recharge_no,amount_cents,channel,status,pay_url,qr_content,paid_at,created_at}]` |
| POST | /api/me/recharges | `{amount_cents(1000~1000000), channel: alipay\|wechat}` → 201 `{recharge_no, amount_cents, channel, status, pay_url, qr_content, mode}` |
| GET | /api/me/recharges/:no | `{recharge}`（轮询支付状态用） |
| GET | /api/me/usage?page&page_size | `items:[{id, key_username, ip_host, ip_country, bytes_in, bytes_out, created_at}]` + `summary:{ week:[{date:'MM-DD', mb}], total_mb }`（近 7 天按日聚合） |
| GET | /api/me/coverage | `{countries:[{country, count}]}`（IP 池中 active 且 country 非空） |
| GET | /api/me/keys | `items:[{id,username,label,status,country_filter,created_at,last_used_at}]`（**不返回密码**） |
| POST | /api/me/keys | `{label?, country_filter?}` → 201 `{key:{id,username,password,label,...}}`，**password 明文仅此一次返回**；每用户上限 10 个，超出 `KEY_LIMIT` |
| PATCH | /api/me/keys/:id | `{label?, status?, country_filter?, password?}`（password 重置后明文返回）→ `{key}` |
| DELETE | /api/me/keys/:id | 204 |

### 管理侧（authRequired + adminRequired）

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | /api/admin/stats | `{user_count, today_new_users, recharge_total_cents, recharge_today_cents, order_count, ip_active, ip_total, key_count, traffic_mb_today, pending_recharge_count, traffic_week:[{date,mb}], recharge_week:[{date,cents}]}` |
| GET | /api/admin/users?q?&status?&page | q 模糊匹配 email/nickname；`items: user[]` + 每项附 `remaining_mb` |
| PATCH | /api/admin/users/:id | `{status?, nickname?, password?}` → `{user}` |
| POST | /api/admin/users/:id/adjust | `{amount_cents(正负), remark}` → `{balance_cents}` |
| GET | /api/admin/recharges?status?&channel?&q?&page | `items: recharge[]` + 附 `user_email` |
| POST | /api/admin/recharges/:id/mark-paid | `{remark?}` → 走 markRechargePaid(source='manual') |
| POST | /api/admin/recharges/:id/mark-failed | `{remark?}` |
| GET | /api/admin/orders?q?&status?&page | 附 user_email |
| GET/POST | /api/admin/packages | POST 体 `{name,description,traffic_mb,price_cents,duration_days,sort?,status?}` |
| PATCH/DELETE | /api/admin/packages/:id | 删除为物理删除（无引用时）；有订单引用则返回 409 `NOT_FOUND`→ 改用停用 |
| GET | /api/admin/ips?q?&country?&status?&page | `items: ipRow[]` |
| POST | /api/admin/ips | `{host,port,protocol?,upstream_user?,upstream_pass?,country?,region?,city?,isp?}` → 201；重复 host:port → 409 |
| POST | /api/admin/ips/import | `{text, protocol?, country?}` 逐行解析：逗号分隔 `host,port,protocol,upstream_user,upstream_pass,country,region,city,isp` 或冒号分隔 `host:port:user:pass`（无逗号时）；→ `{added, skipped, errors:[{line, reason}]}` |
| PATCH | /api/admin/ips/:id | `{status?, country?, region?, city?, isp?, upstream_user?, upstream_pass?, protocol?}` |
| DELETE | /api/admin/ips/:id | 204 |
| POST | /api/admin/ips/check | `{ids?: string[]}` 不传则检测全部 active；对每条做 TCP connect（3s 超时），更新 last_check_at / last_ok_at / fail_count（成功清零，失败 +1；≥5 自动 disabled）→ `{checked, ok, failed}` |
| GET | /api/admin/usage?page&page_size | 全部用量，附 user_email / key_username |
| GET | /api/admin/keys?q?&page | 附 user_email |
| GET/PUT | /api/admin/settings | GET → `{settings:{key:value}}`；PUT `{site_name?, announcement?, register_gift_mb?}` |

### 支付与模拟收银台（支付模块负责）

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | /api/payments/config | 公开。`{mode, channels:[{key:'alipay',name:'支付宝'},{key:'wechat',name:'微信支付'}]}` |
| POST | /api/payments/mock/confirm | 仅 mock。`{recharge_no, result:'success'\|'fail'}` → `{ok}`；success 走 markRechargePaid(source='mock') |
| POST | /api/payments/alipay/notify | 公开（支付宝服务器回调）。form-urlencoded；验签 → markRechargePaid(source='alipay')；响应纯文本 `success` |
| GET | /api/payments/alipay/return | 公开。302 重定向到 `${PAY_RETURN_BASE_URL}/app/recharge?no=...` |
| POST | /api/payments/wechat/notify | 公开（微信服务器回调）。JSON + 微信 V3 验签/解密 → markRechargePaid(source='wechat')；响应 `{code:'SUCCESS'}` |
| GET | /mock/pay/:no | 公开（仅 mock 模式）。HTML 模拟收银台：显示充值单号、金额、渠道、橙色主题，两个按钮「模拟支付成功」「模拟失败」调用 mock/confirm 后提示并关闭 |

---

## 4. 代理网关行为契约（server/src/gateway/）

- 独立 HTTP 服务器，监听 `GATEWAY_PORT`（默认 3128），**标准 HTTP 代理协议**：
  - 支持 `CONNECT host:port`（HTTPS 目标，TLS 透传）。
  - 支持绝对 URI 的普通请求（`GET http://example.com/ HTTP/1.1`，HTTP 目标）。
- **认证**：`Proxy-Authorization: Basic base64(username:password)`。
  - username 支持后缀语法：`<key_username>-r-<REGION>`（临时国家过滤，小写/大写均可）与 `<key_username>-s-<SESSION>`（粘性会话），可组合：`rh_ab12cd34-r-us-s-abc123`。解析用正则：`/^(.*?)(?:-r-([A-Za-z0-9]{2,4}))?(?:-s-([A-Za-z0-9]{4,32}))?$/`。
  - 校验：proxy_keys 中存在 username、bcrypt 比对 password、key.status=active、所属 user.status=active、`hasActiveQuota(user)`。任一失败 → `407` + 响应体 JSON `{"error":"auth_failed"}`（无额度时 `{"error":"no_active_quota"}`）。
- **上游选择**：从 `ip_pool` 中 `status='active'` 且 country 匹配过滤条件（key.country_filter 或 username 后缀，忽略大小写）的行中选取：
  - 粘性会话：内存 `Map<sessionId, {ipId, expireAt}>`，TTL 30 分钟，过期或该 IP 不可用时重选并刷新。
  - 非粘性：随机轮询（内存游标 round-robin）。
- **上游转发**：
  - `protocol='http'`：对 HTTPS 目标向上游发 `CONNECT`；对 HTTP 目标用绝对 URI 转发；上游认证用 `Proxy-Authorization: Basic`。
  - `protocol='socks5'`：实现最小 SOCKS5 握手（支持用户名/密码子协商，CONNECT 命令），见 RFC 1928。
  - 上游连接失败：当前 IP `fail_count+1`（≥5 自动 disabled），换下一个候选重试，最多 3 次；全部失败 → `502` + `{"error":"upstream_failed"}`。
- **流量计费**：双向字节数统计（客户→上游为 bytes_out，上游→客户为 bytes_in，按网关视角即可），连接结束时调用 `recordUsage` + `consumeTraffic`（用量即使超额也如实记录；中途额度耗尽不断开当前连接，仅影响后续连接）。同时更新 proxy_keys.last_used_at。
- **性能**：使用 `net`/`http` 原生模块与 stream pipe；不缓存响应体。
- 测试辅助：`server/scripts/dev-upstream.js` —— 一个本地模拟上游代理（HTTP 代理协议，可选 `--port 18080`），真实转发请求到目标站点，用于没有真实住宅 IP 时的全链路演示。
- 文档：`docs/GATEWAY.md` 说明架构、会话语法、错误码。

---

## 5. 前端设计规范（web 与 admin 一致）

- **品牌**：ResiHub；主色橙 `#f97316`（hover `#ea580c`），背景 `#fafaf9`（stone-50），卡片白色 `rounded-2xl border border-stone-100 shadow-sm`，正文 stone-900，辅助文字 stone-500。整体风格参考 MiyaIP：暖白 + 橙色、圆角卡片、简洁。
- 全站中文；图标用 lucide-react；时间显示 `YYYY-MM-DD HH:mm`（dayjs）。
- axios 实例：baseURL `/api`，token 存 localStorage `resihub_token`，401 时清除并跳登录页。
- 开发代理：`vite.config.ts` 中 `server.proxy: { '/api': 'http://localhost:8080', '/mock': 'http://localhost:8080' }`；admin 的 `base: '/admin/'`，web 的 `base: '/'`。
- 登录/注册页：仿参考图左右分栏 —— 左侧品牌区（橙白渐变、Logo、卖点列表），右侧表单卡片；Tab 切换「密码登录 / 验证码登录」；橙色主按钮。

### 5.1 用户前台 `web/` 页面清单

| 路由 | 内容 |
|---|---|
| `/` | 落地页：导航栏（Logo/登录/注册）、Hero（大标题+CTA）、4 个特性卡（真实住宅IP/灵活套餐/余额计费/多协议网关）、套餐价格预览（GET /api/packages）、页脚 |
| `/login` `/register` `/forgot` | 见上；注册含验证码发送（60s 倒计时）、昵称 |
| `/app` | 布局：左侧边栏（Logo、概览/套餐购买/充值/我的订单/账单明细/流量包/代理密钥/使用文档/账号设置）+ 顶栏（余额徽标、公告铃铛、用户菜单退出）。子页： |
| `/app`（概览） | 统计卡：余额、可用流量、进行中流量包数、今日流量；公告条；网关地址卡片（复制按钮） |
| `/app/packages` | 套餐卡片列表 → 购买确认弹窗（展示扣费金额与余额）→ 成功提示 |
| `/app/recharge` | 金额预设（¥10/¥30/¥50/¥100/自定义，min ¥10）+ 渠道选择（支付宝/微信，GET /api/payments/config）→ 提交 → 弹窗展示二维码（qr_content 用 `qrcode` 库渲染）+「打开收银台」链接（pay_url，mock 模式）+ 每 2s 轮询 GET /api/me/recharges/:no，paid 后刷新余额 |
| `/app/orders` | 订单表格 + 状态徽标 |
| `/app/transactions` | 账单表格：类型（充值/购买/调整徽标）、金额（+绿/−红）、变动后余额、备注、时间 |
| `/app/entitlements` | 流量包卡片：进度条（used/quota）、剩余、到期时间、状态徽标 |
| `/app/keys` | 密钥列表；新建 → 弹窗一次性展示 username/password（复制按钮 + 警告只显示一次）；行操作：启停/重置密码/删除；国家过滤下拉（GET /api/me/coverage） |
| `/app/docs` | 使用文档页：网关地址、认证方式、curl/Python/Go 示例代码、粘性会话与国家过滤语法、计费说明、常见错误（407/502） |
| `/app/settings` | 修改昵称、修改密码 |

### 5.2 管理后台 `admin/` 页面清单（路由前缀 `/admin`）

| 路由 | 内容 |
|---|---|
| `/admin/login` | 同风格登录页；非 admin 角色登录后显示 403 页 |
| `/admin`（仪表盘） | 统计卡：用户数（今日新增）、充值总额（今日）、订单数、IP 池 active/total、今日流量、待处理充值（角标）；recharts 双折线图：近 7 天流量(mb) 与充值额(元) |
| `/admin/users` | 表格（邮箱/昵称/角色/余额/剩余流量/状态/注册时间）+ 搜索；操作：启停、余额调整弹窗（金额正负+备注）、重置密码 |
| `/admin/recharges` | 状态 Tab 过滤；操作：标记已支付/标记失败（人工对账） |
| `/admin/orders` | 订单表格 |
| `/admin/packages` | 套餐 CRUD（弹窗表单）+ 启停 |
| `/admin/ips` | 工具栏：添加 IP 弹窗、批量导入弹窗（textarea + 协议/国家默认值）、一键检测、筛选（国家/状态）；表格：host:port、协议、地理位置、状态徽标、fail_count、最近检测；行操作：启停/检测/删除 |
| `/admin/usage` | 全站用量表格 |
| `/admin/keys` | 全站密钥只读表格 |
| `/admin/settings` | site_name / announcement / register_gift_mb 表单 |

---

## 6. 环境变量（server/.env.example 为准）

见 `server/.env.example`。后端 `src/config.js` 用 dotenv 读取并导出 camelCase 常量：`port, gatewayPort, publicBaseUrl, publicGatewayHost, jwtSecret, dbPath, mailMode, smtp{...}, registerRequireCode, paymentMode, payReturnBaseUrl, alipay{appId,privateKey,publicKey,gateway}, wepay{mchid,appid,serial,privateKey,apiv3Key}`。

---

## 7. 文件所有权（并行开发防冲突，严格遵守）

| Agent | 可写（OWNERS） | 禁止触碰 |
|---|---|---|
| 后端核心 | `server/src/index.js, config.js, db/**, middleware/**, routes/{auth,packages,me,admin}.js, services/{mail,ledger,recharge,usage,stats,settings}.js, utils/**` | `services/payments/**, routes/payments.js, routes/mock-pay.js, gateway/**, web/, admin/, docs/` |
| 支付模块 | `server/src/services/payments/**, server/src/routes/payments.js, server/src/routes/mock-pay.js, docs/PAYMENTS.md`，必要时可小幅修订 `server/.env.example` 注释与 package.json 支付依赖 | 其余所有 |
| 代理网关 | `server/src/gateway/**, server/scripts/dev-upstream.js, docs/GATEWAY.md` | 其余所有（usage/recharge 等服务按契约签名 **直接 require**，不实现） |
| 用户前台 | `web/**` | 其余所有 |
| 管理后台 | `admin/**` | 其余所有 |

> 三个后端 Agent 共享 `server/package.json`（已预装依赖）。**不要改动它**，也不要重复 `npm install`（已由主控完成）。若确需新依赖，先尝试用现有依赖解决。
> 若依赖其他 Agent 未完成的模块：**按契约签名 require 并编码**（懒加载 `require` 放进函数体内即可通过语法检查），不得自行实现对方模块的副本。

---

## 8. 各组件验收标准

- **后端核心**：`node --check` 全部文件通过；以临时 DB 路径真实启动成功（payments/gateway 不存在也能启动，挂载处有 existsSync 守卫）；curl 完成 注册→登录→summary→购套餐→账单 演示。
- **支付模块**：`node --check` 通过；mock 模式收银台页面可访问、confirm 幂等；real 模式代码完整、SDK 懒加载（未配置时绝不崩溃）、验签逻辑有注释与文档。
- **网关**：`node --check` 通过；用注入假依赖的方式自测：假 upstream + 假 usage 服务，CONNECT 与普通 GET 两条路径跑通；dev-upstream.js 可独立运行。
- **前台/后台**：`npm run build` 通过、无 TS 错误；页面齐全；API 调用路径与第 3 节完全一致；空数据/加载态/错误态都有处理。
