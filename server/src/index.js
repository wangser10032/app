const path = require('path');
const fs = require('fs');
const express = require('express');
const helmet = require('helmet');
const { ZodError } = require('zod');
const config = require('./config');
const db = require('./db');
const { stopGateway, startGateway } = require('./gateway/start');
const app = express();
app.disable('x-powered-by');
if (process.env.TRUST_PROXY !== undefined) {
  const hops = Number(process.env.TRUST_PROXY);
  if (!Number.isInteger(hops) || hops < 0 || hops > 10) throw new Error('TRUST_PROXY 必须是 0 至 10 的整数');
  app.set('trust proxy', hops === 0 ? false : hops);
}
app.use((req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
// Native payment mock is a development-only HTML page with inline controls.
app.use((req, res, next) => helmet({ contentSecurityPolicy: req.path.startsWith('/mock/pay/') ? { directives: { scriptSrc: ["'self'", "'unsafe-inline'"], styleSrc: ["'self'", "'unsafe-inline'"], upgradeInsecureRequests: null } } : { directives: { imgSrc: ["'self'", 'data:', 'blob:'], styleSrc: ["'self'", "'unsafe-inline'"], upgradeInsecureRequests: process.env.NODE_ENV === 'production' ? [] : null } }, crossOriginEmbedderPolicy: false })(req, res, next));
app.use(express.json({ limit: '2mb', verify: (req, res, buffer) => { req.rawBody = buffer; } }));
app.use(express.urlencoded({ extended: false, limit: '64kb' }));
app.get('/api/health', (req, res) => { db.prepare('SELECT 1').get(); res.json({ ok: true, service: 'resihub', mode: config.paymentMode }); });
app.use('/api/auth', require('./routes/auth'));
app.use('/api/packages', require('./routes/packages'));
app.use('/api/static-products', require('./routes/static-products'));
app.use('/api/docs', require('./routes/docs'));
app.use('/api/ip', require('./routes/ip'));
app.use('/api/me', require('./routes/me'));
app.use('/api/admin', require('./routes/admin'));
app.use('/api/payments', require('./routes/payments'));
app.use('/', require('./routes/mock-pay'));
app.use('/api', (req, res) => res.status(404).json({ error: { code: 'NOT_FOUND', message: '接口不存在' } }));
const webRoot = path.resolve(__dirname, '../../web/dist');
const adminRoot = path.resolve(__dirname, '../../admin/dist');
app.use('/admin', express.static(adminRoot, { index: false }));
app.get(['/admin', '/admin/*'], (req, res) => fs.existsSync(path.join(adminRoot, 'index.html')) ? res.sendFile(path.join(adminRoot, 'index.html')) : res.status(503).send('管理后台尚未构建'));
app.use(express.static(webRoot, { index: false }));
app.get('*', (req, res) => {
  if (req.path.startsWith('/mock/') || path.extname(req.path)) return res.status(404).send('Not Found');
  if (fs.existsSync(path.join(webRoot, 'index.html'))) return res.sendFile(path.join(webRoot, 'index.html'));
  res.status(503).send('用户前台尚未构建。API 已运行。');
});
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  let status = err.status || 500; let code = err.code || 'INTERNAL'; let message = err.message;
  if (err instanceof ZodError) { status = 400; code = 'VALIDATION_ERROR'; message = err.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('；'); }
  if (err.type === 'entity.parse.failed') { status = 400; code = 'VALIDATION_ERROR'; message = 'JSON 格式不正确'; }
  if (status >= 500) { console.error('[api]', req.method, req.path, err.code || err.name); message = status === 503 ? message : '服务暂时不可用，请稍后再试'; code = status === 503 ? 'SERVICE_UNAVAILABLE' : 'INTERNAL'; }
  res.status(status).json({ error: { code, message } });
});
let server;
function start() {
  server = app.listen(config.port, '0.0.0.0', () => console.log(`[api] listening on :${config.port}`));
  server.on('error', err => { console.error('[api]', err.message); process.exitCode = 1; stopGateway(); });
  const gateway = startGateway({ port: config.gatewayPort });
  gateway.once('error', () => { process.exitCode = 1; server.close(); stopGateway(); });
  return server;
}
function shutdown() { stopGateway(); server?.close(() => { db.close(); process.exit(0); }); const timer = setTimeout(() => process.exit(1), 10000); timer.unref(); }
if (require.main === module) { start(); process.once('SIGINT', shutdown); process.once('SIGTERM', shutdown); }
module.exports = { app, start, shutdown };
