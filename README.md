# ResiHub 静态住宅代理

面向小规模用户的静态住宅 IP 销售平台，按 **IP 数量与租期** 计费。包含邮箱账号、支付宝/微信充值、余额、购买与续费订单、账单、固定 IP 分配、用户前台和管理后台。不销售流量套餐，不按字节扣费。

## 当前访问

- 用户前台：[http://127.0.0.1:8080/](http://127.0.0.1:8080/)
- 静态住宅：[http://127.0.0.1:8080/app/static](http://127.0.0.1:8080/app/static)
- 管理后台：[http://127.0.0.1:8080/admin/](http://127.0.0.1:8080/admin/)
- 代理接入：`127.0.0.1:3128`

管理员凭据保存在被 Git 忽略的 `.local/ACCESS.md`。开发启动会生成随机密码与密钥，保留已有非默认密码。

当前在本机 Docker 的 Linux 容器运行，邮件与支付仍为明确标注的模拟环境。没有内置真实住宅节点，不会把演示 IP 或服务器出口当成住宅资源。真实节点与产品配置好后，可在后台上架销售；库存来自实际空闲节点。

## 业务流程

1. 管理后台录入 HTTP/SOCKS5 上游节点与供应商认证信息。
2. 创建静态产品，设置国家、地区、运营商、协议、每个 IP 的租期及价格。
3. 用户充值余额，按数量购买产品；系统在一个事务内扣余额、写订单账单、分配独占固定 IP。
4. 已购 IP 列表提供接入凭据、备注、状态、到期时间、复制和导出；续费延长原 IP 租期。
5. 网关始终转发到对应固定节点，不会随机轮换或失败后换用其他 IP；租约到期或停用后停止访问。

侧栏仅有总览、静态住宅、订单与账单和接入说明。充值与账户菜单在右上角，账号设置和安全操作从账户菜单进入。

## 架构

`web/` 和 `admin/` 为 React/TypeScript 静态应用，由 `server/` 的 Express API 同源托管。SQLite WAL 保存用户、余额、充值、订单、账单、IP 库存和租约。HTTP/CONNECT 代理网关支持 HTTP 与 SOCKS5 上游，固定绑定租约，保留认证、到期、并发限制及私网目标保护。

供应商主密码不向用户公开。租约凭据以 bcrypt 校验并以 AES-GCM 加密存储，使用独立稳定的 `PROXY_CREDENTIAL_SECRET`；备份时需同时妥善保留这个密钥。不要随 JWT 轮换而更改代理凭据加密密钥。

旧流量套餐停售，旧前端地址跳转静态住宅页。数据库迁移保留历史余额、充值、账单和订单，不把旧额度自动转换为 IP。

## 容器维护

现有 `resihub-dev` 启动时自动检查依赖、初始化本机配置、构建前后台并运行 API/网关。Windows 维护脚本：

```powershell
.\deploy\dev.ps1 up
.\deploy\dev.ps1 restart
.\deploy\dev.ps1 logs
```

Linux 开发宿主使用 `sh deploy/dev.sh up`。统一访问 8080，不依赖单独启动 Vite。生产 Linux 的多阶段镜像、Caddy 和 Compose 见 [部署说明](deploy/README.md)。

验证与在线备份：

```bash
docker exec resihub-dev sh -lc 'cd /workspace/server && npm test'
docker exec resihub-dev sh -lc 'cd /workspace/server && npm run backup -- /workspace/server/data/backups/resihub.db'
```

## 说明

- [静态业务接口](docs/STATIC-CONTRACT.md)
- [运营说明](docs/OPERATIONS.md)
- [代理网关](docs/GATEWAY.md)
- [支付接入](docs/PAYMENTS.md)
- [本次验收](docs/VERIFICATION.md)

公网正式部署、真实 SMTP、支付宝/微信商户支付及实际住宅出口，需要对应服务配置并实际验收。当前可运行的本机版本不代表这些外部服务已经上线。
