const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const int = (v, d) => { const n = parseInt(v, 10); return Number.isFinite(n) ? n : d; };
const trimSlash = (s) => String(s || '').replace(/\/+$/, '');
const serverRoot = path.join(__dirname, '..');

const config = {
  production: process.env.NODE_ENV === 'production',
  port: int(process.env.PORT, 8080),
  gatewayPort: int(process.env.GATEWAY_PORT, 3128),
  publicGatewayPort: int(process.env.PUBLIC_GATEWAY_PORT, int(process.env.GATEWAY_PORT, 3128)),
  allowPrivateTargets: process.env.GATEWAY_ALLOW_PRIVATE_TARGETS === 'true',
  gatewayMaxConnections: int(process.env.GATEWAY_MAX_CONNECTIONS, 20),
  publicBaseUrl: trimSlash(process.env.PUBLIC_BASE_URL) || `http://localhost:${int(process.env.PORT, 8080)}`,
  publicGatewayHost: process.env.PUBLIC_GATEWAY_HOST || '127.0.0.1',
  jwtSecret: process.env.JWT_SECRET || 'dev-insecure-secret-change-me',
  proxyCredentialSecret: process.env.PROXY_CREDENTIAL_SECRET || process.env.JWT_SECRET || 'dev-insecure-secret-change-me',
  dbPath: process.env.DB_PATH
    ? (path.isAbsolute(process.env.DB_PATH) ? process.env.DB_PATH : path.join(serverRoot, process.env.DB_PATH))
    : path.join(serverRoot, 'data/resihub.db'),
  mailMode: process.env.MAIL_MODE === 'smtp' ? 'smtp' : 'mock',
  smtp: {
    host: process.env.SMTP_HOST || '',
    port: int(process.env.SMTP_PORT, 465),
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
    from: process.env.SMTP_FROM || 'ResiHub <no-reply@example.com>',
  },
  registerRequireCode: (process.env.REGISTER_REQUIRE_CODE || 'false') === 'true',
  paymentMode: process.env.PAYMENT_MODE === 'real' ? 'real' : 'mock',
  payReturnBaseUrl: trimSlash(process.env.PAY_RETURN_BASE_URL) || 'http://localhost:5173',
  alipay: {
    appId: process.env.ALIPAY_APP_ID || '',
    privateKey: process.env.ALIPAY_PRIVATE_KEY || '',
    publicKey: process.env.ALIPAY_PUBLIC_KEY || '',
    sellerId: process.env.ALIPAY_SELLER_ID || '',
    gateway: process.env.ALIPAY_GATEWAY || 'https://openapi.alipay.com/gateway.do',
  },
  wepay: {
    mchid: process.env.WEPAY_MCHID || '',
    appid: process.env.WEPAY_APPID || '',
    serial: process.env.WEPAY_SERIAL || '',
    privateKey: process.env.WEPAY_PRIVATE_KEY || '',
    apiv3Key: process.env.WEPAY_APIV3_KEY || '',
    platformPublicKey: process.env.WEPAY_PLATFORM_PUBLIC_KEY || '',
    platformSerial: process.env.WEPAY_PLATFORM_SERIAL || '',
  },
};

if (!['mock', 'real', undefined].includes(process.env.PAYMENT_MODE)) throw new Error('PAYMENT_MODE 必须为 mock 或 real');
if (!['mock', 'smtp', undefined].includes(process.env.MAIL_MODE)) throw new Error('MAIL_MODE 必须为 mock 或 smtp');
if (config.production) {
  const invalid = [];
  if (config.jwtSecret.length < 32 || /change-me|insecure|example|replace/i.test(config.jwtSecret) || new Set(config.jwtSecret).size < 10) invalid.push('JWT_SECRET 必须为至少32位随机字符串');
  if (config.proxyCredentialSecret.length < 32 || /change-me|insecure|replace/i.test(config.proxyCredentialSecret)) invalid.push('PROXY_CREDENTIAL_SECRET 必须为至少32位稳定随机密钥');
  if (config.mailMode !== 'smtp' || !config.smtp.host || !config.smtp.user || !config.smtp.pass) invalid.push('配置真实 SMTP');
  if (!config.registerRequireCode) invalid.push('REGISTER_REQUIRE_CODE=true');
  if (config.paymentMode !== 'real') invalid.push('PAYMENT_MODE=real');
  if (!/^https:\/\//.test(config.publicBaseUrl) || !/^https:\/\//.test(config.payReturnBaseUrl)) invalid.push('PUBLIC_BASE_URL 与 PAY_RETURN_BASE_URL 必须使用 HTTPS');
  if (config.allowPrivateTargets) invalid.push('生产网关禁止 GATEWAY_ALLOW_PRIVATE_TARGETS=true');
  if (invalid.length) throw new Error(`生产配置不完整：${invalid.join('；')}`);
}

module.exports = config;
