# 登录与邮件验证码的人机验证

平台注册、验证码登录与重置密码在发送邮箱验证码前展示 5 位图形验证码；密码登录（包括管理后台）提交时验证图形验证码。邮箱验证码成功签发后，后续提交无需重复解图。

## 接口

- `GET /api/auth/captcha?purpose=register|login|reset` 返回 `{id,image,expires_at}`。`image` 是 196 × 60 的 PNG data URL；不区分大小写，有效期 5 分钟，响应使用 `Cache-Control: no-store`。
- `POST /api/auth/send-code` 在原请求中增加 `captcha: {id,answer}`，用途须与 `purpose` 一致。
- `POST /api/auth/login` 在原请求中增加相同 `captcha` 对象，使用 `purpose=login` 的图片。
- 图形验证码缺失返回 HTTP 400 `CAPTCHA_REQUIRED`；错误、用途不匹配、请求 IP 不匹配或重放返回 `CAPTCHA_INVALID`；超时返回 `CAPTCHA_EXPIRED`。
- 无论后续邮箱发送或密码验证是否成功，已尝试过的图片都需要重新获取。客户端应在请求失败后刷新图片并清空图形输入；更换验证用途时也须重新获取。

## 服务端保护

答案随机生成，仅以带服务器密钥的 HMAC 保存到 SQLite `human_challenges`，请求 IP 同样哈希保存。PNG 只有像素，没有 SVG 文本、隐藏答案或开发模式答案字段。图形挑战绑定用途与请求 IP，一次尝试即销毁；SQLite 事务保证并发请求不能复用。

每个 IP 每分钟最多生成 30 张图片，同时仍受认证路由每 15 分钟 60 次请求限制。过期记录在生成下一张时清理，活跃挑战总数限制为 5,000。该实现用于少量用户的基础防刷，不依赖第三方服务或密钥；它不等同于专门的风险识别服务。

已有数据库启动时自动新增挑战表，不修改用户、订单或账单记录。反向代理部署应保留正确的 `TRUST_PROXY` 配置，确保 `req.ip` 表示真实客户端。开发环境即使关闭邮箱验证码，也不能无验证直接注册；未提供邮箱 code 时需要一个 `purpose=register` 的有效图片答案。

## 验证

在 Linux 开发容器运行 `cd /workspace/server && npm test`。验证码与注册/登录集成测试使用独立临时数据库和 `MAIL_MODE=mock`，不发送真实邮件；仅在测试进程中替换随机数生成器来得到已知答案，生产接口没有测试绕过。
