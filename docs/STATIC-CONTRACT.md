# 静态住宅代理业务契约（2026-10-28）

本契约取代旧流量套餐设计。平台只按固定 IP 数量与租期销售静态住宅代理，不销售流量包、不按字节扣款。历史余额、充值、账单及旧订单保留，旧流量额度不转换为 IP。

## 数据与交易

新增 `static_products` 与 `static_rentals`，现有 `ip_pool` 作为待分配库存。每个有效租约独占一个上游节点，在到期前即便被管理员禁用也不提前转卖。购买与续费在 SQLite 事务内完成库存校验、余额扣减、订单与账单、租约变更，须支持 `Idempotency-Key`，禁止超卖或重复扣款。

产品字段：`id,name,description,country,region,city,isp,protocol,duration_days,price_cents,sort,status,available_ips`。金额为每 IP 每个租期的整数分。地域/运营商筛选为空表示不限，协议为 `http|socks5`。可售数由符合条件、启用且未被占用的真实节点计算。

租约字段：`id,product_id,product_name,country,region,city,isp,ip_host,ip_port,protocol,proxy_host,proxy_port,username,password,remark,status,expires_at,created_at,renew_price_cents,duration_days`。状态为 `active|expired|unavailable|disabled`。`ip_host/ip_port` 为固定上游地址说明，用户接入实际使用 `proxy_host/proxy_port` 与本租约凭证。上游主账户和密码不可返回给用户。

租约密码以 bcrypt 验证，另使用独立稳定密钥 AES-GCM 加密保存供本人查看/复制/导出。后台列表不返回 password、hash 或密文。网站登录凭证与代理租约凭证分离。

## 用户接口

| 方法 | 路径 | 输入/输出 |
| --- | --- | --- |
| GET | `/api/static-products` | 公开 `{items:product[]}`，仅启用产品 |
| GET | `/api/me/static-ips` | `q,country,status,page,page_size`，标准分页租约列表 |
| GET | `/api/me/static-ip-filters` | `{countries:[{code,count}]}`，仅当前用户真实已购租约的非空国家，跨分页和状态，不受当前搜索或地区筛选限制 |
| POST | `/api/me/static-orders` | `{product_id,quantity:1..100}` 与 `Idempotency-Key` → 201 `{order,rentals}` |
| PATCH | `/api/me/static-ips/:id` | `{remark}` → `{rental}`，仅本人 |
| POST | `/api/me/static-ips/:id/renew` | `{}` 与 `Idempotency-Key` → `{order,rental}`，从较晚的当前时间或到期时间延长产品租期 |
| GET | `/api/me/summary` | `{balance_cents,static_ip_total,static_ip_active,static_ip_expiring,site_name,announcement,gateway_endpoint,recent_static_ips}` |

过期后若 IP 已分配给其他新租约，旧租约不得续费。禁用的租约不可自行续费绕过管理。产品停用、上游不可用或余额不足时不扣款。订单新增 `kind=static_purchase|static_renewal|legacy`、`quantity,duration_days,product_id`，保留既有订单号、名称快照与金额字段。

邮箱账号、余额充值、支付宝/微信回调、订单与账单接口保留。旧的流量购买入口关闭；旧前端流量路由跳转到静态住宅页面，不再呈现流量额度、用量或密钥管理。

## 后台接口

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET/POST | `/api/admin/static-products` | `{items}` / 创建 `{product}` |
| PATCH/DELETE | `/api/admin/static-products/:id` | 产品编辑/无历史引用时删除；有引用则停用 |
| GET | `/api/admin/static-ips` | 标准分页，附 `user_email`，不返回秘密 |
| PATCH | `/api/admin/static-ips/:id` | `{status:active|disabled,expires_at?,remark?}` → `{rental}`；不能启用与其他租约冲突的 IP |

IP 资源原有导入、CRUD 与 TCP 检测保留，列表附 `assigned_to`（邮箱）、`lease_expires_at`、`is_allocated`。分配中不得更改接入地址、协议及上游认证，不得删除有租赁历史的节点，可停用。

用户列表以 `static_ip_count` 替代流量。运营概览保留用户、充值、订单、节点及待支付计数；新增 `total_static_ips,active_static_ips,available_static_ips,expiring_static_ips`（7 天内），移除流量图表。设置仅提供站点名称和公告，停止赠送流量。

## 网关

租约用户名/密码只连接该租约绑定的 IP，不做随机轮询、地域后缀选路或失败切换。支持 HTTP/CONNECT 和 HTTP/SOCKS5 上游；继续防止未授权开放代理、内网目标访问与连接数滥用。到期、禁用账户/租约/节点会停止接入与现有连接。没有流量包检查或字节扣费。

## 前台界面

侧栏保留总览、静态住宅、订单与账单、接入说明。移除流量购买、流量包、流量用量、充值及账号设置侧栏入口；充值和账号菜单移至右上。总览显示静态 IP 简表与简短计数，静态住宅页包含定价/已购 IP、地区/状态/搜索、备注、凭证详情、复制/导出、到期与续费。

视觉保留清晰的业务表格结构，采用白底、冷灰背景、深灰蓝操作和单色 Logo，导航选中态使用浅灰蓝。地区选项从当前用户真实租约生成，不写死国家列表，没有数据时仅保留“所有地区”。正常中文字号，不使用营销口号、英文装饰标签、插画、大数字统计卡或无业务意义的引导区。没有自动续费、会员、邀请或登录历史接口时，不添加对应虚假操作。
