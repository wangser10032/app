# Linux 容器与部署

## 已完成的本机环境

`resihub-dev` 在 Docker Desktop 的 Linux 引擎中运行。`D:\workspace\proxy-platform` 挂载到 `/workspace`，三个项目的 `node_modules` 使用独立 Linux 命名卷。Windows 只编辑代码，编译和运行均在 Linux 内完成。

容器启动执行 `deploy/run-dev.sh`：按 lockfile 摘要检查依赖 → 初始化本机配置 → 构建用户前台/后台 → 启动 API 和代理网关。主进程退出自动重启，健康检查会真实请求 `/api/health`。

| 服务 | 本机入口 |
| --- | --- |
| 用户前台 | http://127.0.0.1:8080/ |
| 管理后台 | http://127.0.0.1:8080/admin/ |
| HTTP 代理网关 | 127.0.0.1:3128 |
| 可选用户前台 Vite | 5173，需单独启动 |
| 可选后台 Vite | 5174，需单独启动 |

开发端口仅绑定宿主机 `127.0.0.1`，不将模拟支付和开发邮件接口暴露到局域网/公网。当前没有真实住宅资源，网关需上架可用上游后才能产生真实住宅出口。

初始化脚本会生成随机 JWT 与本机管理员密码、开启注册邮箱验证码，将登录资料保存到项目 `.local/ACCESS.md`。该目录和 `.env` 不进入 Git 或生产镜像。已有非默认管理员密码不会被覆盖。模拟邮件会在页面显示开发验证码；模拟支付明确不产生真实扣款。

## 容器维护（由维护 agent 执行）

Windows PowerShell：

```powershell
.\deploy\dev.ps1 up
.\deploy\dev.ps1 ps
.\deploy\dev.ps1 logs
.\deploy\dev.ps1 shell
.\deploy\dev.ps1 restart
```

`up` 在镜像不存在时先构建。若修改了 `Dockerfile.dev`，执行 `dev.ps1 build` 后再 `up`。Linux/macOS 使用 `sh deploy/dev.sh up` 等对应子命令。不要使用 `destroy` 处理普通启动问题，它会删除 Linux 依赖卷。

源文件修改后需要重启容器以重新构建前台与后台；维护 agent 也可在容器内分别执行 `npm run build` 并重启 API。需要热更新调试时，在 `web` 或 `admin` 中单独运行 `npm run dev`；日常访问仍推荐统一的 8080 入口。

验证：

```bash
docker exec resihub-dev sh -lc 'cd /workspace/server && npm test'
docker exec resihub-dev sh -lc 'cd /workspace/server && npm audit --omit=dev'
docker exec resihub-dev sh -lc 'cd /workspace/web && npm run build'
docker exec resihub-dev sh -lc 'cd /workspace/admin && npm run build'
```

API 和网关日志为容器标准输出。测试创建隔离临时数据库，不改动本机运营库。

## Linux 生产配置

提供 `deploy/Dockerfile` 多阶段 Node 22 镜像，前后台编译后统一托管。运行时使用 `node` 用户，应用只读根文件系统，SQLite 持久卷可写；私钥只读挂载到 `/run/secrets`。前台不包含商户私钥。

`deploy/docker-compose.prod.yml` 编排应用与 Caddy HTTPS。正式部署由维护 agent 在获得服务器访问与有效域名/邮件/商户配置后执行：

1. 从 `.env.production.example` 准备 `.env.production`，替换占位域名、随机 JWT、管理员、SMTP 与支付配置。密钥放入受保护的 `deploy/secrets/`，使容器的 UID 1000 可读。
2. 核实域名解析、服务器 80/443 与计划使用的代理端口、回调公网可达；代理认证链路的加密/受控网络方案也须部署。
3. 运行下列命令并验证邮件、真实付款、住宅资源与重启持久性。

```bash
docker compose --env-file deploy/.env.production -f deploy/docker-compose.prod.yml up -d --build
docker compose --env-file deploy/.env.production -f deploy/docker-compose.prod.yml ps
docker compose --env-file deploy/.env.production -f deploy/docker-compose.prod.yml logs --tail=100
```

生产配置强制真实邮件、邮箱验证、真实支付模式与 HTTPS 地址。未配置的支付渠道不可用；不能用模拟模式冒充正式收款。`GATEWAY_EXTERNAL_PORT` 可改变公网端口并同步展示地址；`TRUST_PROXY=1` 对应应用前唯一一层 Caddy。

Caddy 只处理网站 HTTPS，不自动为标准 HTTP 代理网关提供 TLS。本机已验证的是 Linux 容器环境，不代表远程服务器、真实 SMTP、商户结算或住宅 IP 已验收。

## 备份与恢复

使用 SQLite 在线备份，支持 `.env` 中自定义的 `DB_PATH`：

```bash
docker exec resihub-dev sh -lc 'cd /workspace/server && npm run backup -- /workspace/server/data/backups/resihub.db'
```

生产镜像中：

```bash
docker compose --env-file deploy/.env.production -f deploy/docker-compose.prod.yml exec app npm run backup -- /app/server/data/backups/resihub.db
```

备份文件必须与原数据库不同。恢复由维护 agent 先停止写入、保留当前备份和版本，再恢复目标数据卷与权限，并验证余额、账单、订单、登录及网关；不要在运行中直接覆盖数据库。定时异地备份与恢复演练属于正式服务器上线工作。

完整业务说明见 [项目 README](../README.md)、[运营说明](../docs/OPERATIONS.md)、[支付说明](../docs/PAYMENTS.md) 和 [网关说明](../docs/GATEWAY.md)。
