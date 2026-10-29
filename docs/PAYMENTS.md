# 支付与对账

余额单位统一为整数分。充值成功只增加余额；购买或续费静态住宅 IP 再从余额扣款，写入订单、IP 租约和账单。金额与账单在同一个 SQLite 事务内更新。

## 当前可验证状态

本机 Linux 开发容器使用 `PAYMENT_MODE=mock`。支付宝与微信两个入口均可创建充值单，生成带 HMAC 凭证的模拟收银台链接，确认成功后自动刷新余额；不会发生真实扣款。模拟接口在真实模式与生产环境中关闭。

已用本地生成的 RSA 密钥、微信 AES-GCM 加密通知进行自动回调测试，包括合法通知、篡改、错误金额、错误商户、重复通知和迟到通知。尚未使用真实商户账号完成下单、扫码支付和实际结算验证。

## 支付宝真实渠道

实现 `alipay.trade.precreate` 当面付，使用官方 `alipay-sdk`，请求 RSA2 签名并验证响应签名。异步通知经官方 `checkNotifySignV2` 验签后，校验 `app_id`、可选 `seller_id`、充值单、渠道及 `total_amount`。只有 `TRADE_SUCCESS` / `TRADE_FINISHED` 入账。浏览器返回页只跳转到充值状态页面，不负责入账。

环境变量：`ALIPAY_APP_ID`、`ALIPAY_PRIVATE_KEY`、`ALIPAY_PUBLIC_KEY`、`ALIPAY_SELLER_ID`（建议配置）、`ALIPAY_GATEWAY`。密钥支持 PEM 文本、转义换行或 PEM 文件路径；生产推荐挂载只读文件。正式网关为 `https://openapi.alipay.com/gateway.do`，开发示例保留沙箱配置，迁移时须切换。

通知地址：`https://站点域名/api/payments/alipay/notify`。

## 微信支付真实渠道

实现 API v3 Native 下单。商户私钥对请求签名，使用受信任的微信支付平台公钥/平台证书验证响应和通知（包括序列号/公钥 ID 及 5 分钟时间窗），再用 API v3 密钥 AES-256-GCM 解密通知。校验商户号、AppID、订单号、人民币币种、整数分金额和成功状态后入账。

环境变量：`WEPAY_MCHID`、`WEPAY_APPID`、`WEPAY_SERIAL`（商户证书序列号）、`WEPAY_PRIVATE_KEY`（商户私钥）、`WEPAY_APIV3_KEY`（32 字节）、`WEPAY_PLATFORM_PUBLIC_KEY`（微信支付平台公钥/平台证书）、`WEPAY_PLATFORM_SERIAL`（匹配的 `PUB_KEY_ID_...` 或平台证书序列号）。商户证书不能充当微信支付平台验签证书。平台公钥/证书轮换后应同步更新配置并重启服务；本版本未实现自动下载轮换。

通知地址：`https://站点域名/api/payments/wechat/notify`。服务器应保持系统时间同步。

## 入账与异常

- 渠道缺少配置时不提供可点击充值选项，服务端也拒绝下单，真实支付不会降级为模拟支付。
- 重复通知不重复加钱，数据库为充值账单提供唯一约束。
- 经过验签、商户和金额校验的真实成功通知，可恢复本地已标失败或过期的充值单，避免网络超时或人工误标造成付款后未入账。
- 人工到账仅供管理员核对商户交易后使用，必须确认金额；会记录操作审计。不能将已支付单改为失败。
- 本版本未实现自动退款、退款回调、自动商户主动查单、财务结算报表或发票。通知丢失时需由管理员核账补入，后续 agent 可继续扩展。
- 正式开通收款需要有效商户资质、渠道产品权限、可公开访问的 HTTPS 域名和真实密钥。将真实充值标为失败不会自动撤销商户侧交易。

接口与状态参见 [CONTRACT.md](CONTRACT.md)。当前实现优先于契约中早期的模拟回调定义：`mock/confirm` 额外要求收银台链接中的 `token`。

## 官方资料

- [支付宝当面付预创建接口](https://developer.alibaba.com/docs/api.htm?apiId=862&docType=4)
- [微信支付签名及验签](https://pay.wechatpay.cn/doc/v3/merchant/4012365352)
- [微信支付平台证书验签](https://pay.wechatpay.cn/doc/v3/merchant/4013053420)

测试：在容器的 `/workspace/server` 执行 `npm test`。测试数据库独立于运营数据库。
