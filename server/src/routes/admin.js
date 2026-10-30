const express = require('express');
const bcrypt = require('bcryptjs');
const net = require('net');
const { randomUUID } = require('crypto');
const db = require('../db');
const { route, fail } = require('../utils/errors');
const { z, password, country, countryValue, status } = require('../utils/validation');
const { authRequired, adminRequired, fields } = require('../middleware/auth');
const { paginate, paged } = require('../utils');
const rentals = require('../services/static-rentals');
const { getSettings, setSettings, DEFAULT_DOCS } = require('../services/settings');
const { channels } = require('../services/payments');
const config = require('../config');
const { getStats } = require('../services/stats');
const { addLedger } = require('../services/ledger');
const recharge = require('../services/recharge');
const router = express.Router();
router.use(authRequired, adminRequired);
db.exec('CREATE TABLE IF NOT EXISTS audit_logs(id TEXT PRIMARY KEY,admin_id TEXT NOT NULL,action TEXT NOT NULL,target_id TEXT NOT NULL,detail TEXT NOT NULL,created_at INTEGER NOT NULL)');
function audit(req, action, target, detail = {}) { db.prepare('INSERT INTO audit_logs VALUES(?,?,?,?,?,?)').run(randomUUID(), req.user.id, action, target, JSON.stringify(detail), Date.now()); }
function tableList(req, { table, select = 't.*', join = '', filters = {}, search = [] }) {
  const { page, pageSize, offset } = paginate(req);
  const clauses = ['1=1']; const params = [];
  for (const [query, column] of Object.entries(filters)) if (typeof req.query[query] === 'string' && req.query[query]) { clauses.push(`${column}=?`); params.push(req.query[query]); }
  if (typeof req.query.q === 'string' && req.query.q && search.length) { const q = `%${req.query.q.slice(0, 100)}%`; clauses.push(`(${search.map(f => `${f} LIKE ?`).join(' OR ')})`); params.push(...search.map(() => q)); }
  const from = `${table} t ${join} WHERE ${clauses.join(' AND ')}`;
  return paged(db.prepare(`SELECT ${select} FROM ${from} ORDER BY t.created_at DESC,t.id DESC LIMIT ? OFFSET ?`).all(...params, pageSize, offset), db.prepare(`SELECT COUNT(*) n FROM ${from}`).get(...params).n, page, pageSize);
}
router.get('/stats', (req, res) => res.json(getStats()));
router.get('/users', (req, res) => {
  const result = tableList(req, { table: 'users', select: fields.split(',').map(f => `t.${f}`).join(','), filters: { status: 't.status' }, search: ['t.email', 't.nickname'] });
  rentals.expireRentals();
  result.items = result.items.map(user => ({ ...user, static_ip_count: db.prepare("SELECT COUNT(*) n FROM static_rentals WHERE user_id=? AND status IN ('active','disabled') AND expires_at>?").get(user.id, Date.now()).n }));
  res.json(result);
});
router.patch('/users/:id', route(async (req, res) => {
  const body = z.object({ status: status.optional(), nickname: z.string().trim().max(60).optional(), password: password.optional() }).strict().parse(req.body);
  const user = db.prepare('SELECT * FROM users WHERE id=?').get(req.params.id);
  if (!user) fail(404, 'NOT_FOUND', '用户不存在');
  if (body.status === 'disabled' && user.id === req.user.id) fail(409, 'FORBIDDEN', '不能停用当前管理员账号');
  const data = { ...body };
  if (body.password) { data.password_hash = await bcrypt.hash(body.password, 12); delete data.password; }
  db.transaction(() => {
    const entries = Object.entries(data);
    if (entries.length) db.prepare(`UPDATE users SET ${entries.map(([key]) => `${key}=?`).join(',')}${body.password || body.status ? ',token_version=token_version+1' : ''} WHERE id=?`).run(...entries.map(([, value]) => value), user.id);
    audit(req, 'user.update', user.id, { fields: Object.keys(body), status: body.status });
  })();
  res.json({ user: db.prepare(`SELECT ${fields} FROM users WHERE id=?`).get(user.id) });
}));
router.post('/users/:id/adjust', route((req, res) => {
  const body = z.object({ amount_cents: z.number().int().min(-100000000).max(100000000).refine(v => v !== 0), remark: z.string().trim().min(1, '请填写调整原因').max(500) }).parse(req.body);
  const entry = db.transaction(() => {
    const row = addLedger({ userId: req.params.id, type: 'adjust', amountCents: body.amount_cents, refType: 'admin', refId: req.user.id, remark: body.remark });
    audit(req, 'balance.adjust', req.params.id, body); return row;
  })();
  res.json({ balance_cents: entry.balance_after_cents });
}));
router.get('/recharges', (req, res) => res.json(tableList(req, { table: 'recharges', select: 't.*,u.email user_email', join: 'JOIN users u ON u.id=t.user_id', filters: { status: 't.status', channel: 't.channel' }, search: ['u.email', 't.recharge_no'] })));
for (const action of ['mark-paid', 'mark-failed']) router.post(`/recharges/:id/${action}`, route((req, res) => {
  const body = z.object({ remark: z.string().trim().max(500).optional() }).parse(req.body || {});
  const row = db.prepare('SELECT * FROM recharges WHERE id=?').get(req.params.id);
  if (!row) fail(404, 'NOT_FOUND', '充值单不存在');
  const result = db.transaction(() => {
    const opts = { source: 'manual', channel: row.channel, outTradeNo: `MANUAL-${row.id}`, raw: { admin_id: req.user.id, remark: body.remark || '' } };
    const output = action === 'mark-paid' ? recharge.markRechargePaid(row.recharge_no, opts) : recharge.markRechargeFailed(row.recharge_no, opts);
    audit(req, `recharge.${action}`, row.id, body); return output;
  })();
  res.json(result);
}));
router.get('/orders', (req, res) => res.json(tableList(req, { table: 'orders', select: 't.*,u.email user_email', join: 'JOIN users u ON u.id=t.user_id', filters: { status: 't.status' }, search: ['u.email', 't.order_no', 't.package_name'] })));
router.all(['/packages', '/packages/:id', '/usage', '/keys'], (req, res) => res.status(410).json({ error: { code: 'LEGACY_PRODUCT_RETIRED', message: '旧流量功能已停用，请管理静态住宅 IP' } }));
router.get('/static-products', route((req, res) => res.json({ items: rentals.getProducts(true) })));
router.post('/static-products', route((req, res) => {
  const body = rentals.createProductSchema.parse(req.body); const id = randomUUID();
  const product = db.transaction(() => {
    db.prepare('INSERT INTO static_products(id,name,description,country,region,city,isp,protocol,duration_days,price_cents,sort,status,created_at) VALUES(@id,@name,@description,@country,@region,@city,@isp,@protocol,@duration_days,@price_cents,@sort,@status,@created_at)').run({ ...body, id, created_at: Date.now() });
    audit(req, 'static_product.create', id); return rentals.productView(db.prepare('SELECT * FROM static_products WHERE id=?').get(id));
  })();
  res.status(201).json({ product });
}));
router.patch('/static-products/:id', route((req, res) => {
  const body = rentals.patchProductSchema.parse(req.body); const entries = Object.entries(body);
  const product = db.transaction(() => {
    if (!db.prepare('SELECT id FROM static_products WHERE id=?').get(req.params.id)) fail(404, 'NOT_FOUND', '产品不存在');
    if (entries.length) db.prepare(`UPDATE static_products SET ${entries.map(([key]) => `${key}=?`).join(',')} WHERE id=?`).run(...entries.map(([, value]) => value), req.params.id);
    audit(req, 'static_product.update', req.params.id, { fields: Object.keys(body) }); return rentals.productView(db.prepare('SELECT * FROM static_products WHERE id=?').get(req.params.id));
  })();
  res.json({ product });
}));
router.delete('/static-products/:id', route((req, res) => {
  db.transaction(() => {
    if (db.prepare('SELECT id FROM static_rentals WHERE product_id=? LIMIT 1').get(req.params.id) || db.prepare('SELECT id FROM orders WHERE product_id=? LIMIT 1').get(req.params.id)) fail(409, 'CONFLICT', '产品已有租赁历史，请使用停用操作');
    if (!db.prepare('DELETE FROM static_products WHERE id=?').run(req.params.id).changes) fail(404, 'NOT_FOUND', '产品不存在');
    audit(req, 'static_product.delete', req.params.id);
  }).immediate();
  res.status(204).end();
}));
router.get('/static-ips', route((req, res) => res.json(rentals.listRentals(req, true))));
router.patch('/static-ips/:id', route((req, res) => {
  const body = z.object({ status: status.optional(), expires_at: z.number().int().min(0).max(8640000000000000).optional(), remark: z.string().trim().max(500).optional() }).strict().parse(req.body);
  const rental = db.transaction(() => {
    rentals.expireRentals(); const current = rentals.rentalRow(req.params.id); if (!current) fail(404, 'NOT_FOUND', '租约不存在');
    const expiry = body.expires_at ?? current.expires_at;
    const nextStatus = body.status || current.status;
    if (nextStatus === 'active' || nextStatus === 'disabled') {
      if (expiry > Date.now()) {
        if (!rentals.isLatestRental(current) || db.prepare("SELECT id FROM static_rentals WHERE ip_id=? AND id<>? AND status IN ('active','disabled') AND expires_at>?").get(current.ip_id, current.id, Date.now())) fail(409, 'IP_REALLOCATED', 'IP 已分配给其他租约，不能启用或延长旧租约');
      } else if (body.status === 'active') fail(409, 'RENTAL_EXPIRED', '启用租约前请先设置未来的到期时间');
    }
    const data = { ...body }; if (expiry <= Date.now()) data.status = 'expired';
    const entries = Object.entries(data);
    if (entries.length) db.prepare(`UPDATE static_rentals SET ${entries.map(([key]) => `${key}=?`).join(',')} WHERE id=?`).run(...entries.map(([, value]) => value), current.id);
    audit(req, 'static_rental.update', current.id, { before: { status: current.status, expires_at: current.expires_at, remark: current.remark }, after: data });
    return rentals.rentalView(rentals.rentalRow(current.id), false);
  }).immediate();
  res.json({ rental });
}));
const host = z.string().trim().min(1).max(253).refine(v => net.isIP(v) || /^(?=.{1,253}$)(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/.test(v), '上游应为 IP 或域名');
const ipFields = { host, port: z.number().int().min(1).max(65535), protocol: z.enum(['http', 'socks5']), upstream_user: z.string().max(255), upstream_pass: z.string().max(255), country: countryValue, region: z.string().max(100), city: z.string().max(100), isp: z.string().max(150), status };
const ipSchema = z.object({ ...ipFields, protocol: ipFields.protocol.default('http'), upstream_user: ipFields.upstream_user.default(''), upstream_pass: ipFields.upstream_pass.default(''), country, region: ipFields.region.default(''), city: ipFields.city.default(''), isp: ipFields.isp.default(''), status: status.default('active') }).strict();
const ipPatchSchema = z.object(ipFields).partial().strict();
function insertIp(body) {
  const id = randomUUID();
  try { db.prepare('INSERT INTO ip_pool(id,host,port,protocol,upstream_user,upstream_pass,country,region,city,isp,status,created_at) VALUES(@id,@host,@port,@protocol,@upstream_user,@upstream_pass,@country,@region,@city,@isp,@status,@created_at)').run({ ...body, id, created_at: Date.now() }); }
  catch (err) { if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') fail(409, 'CONFLICT', '相同地址与端口的上游已存在'); throw err; }
  return db.prepare('SELECT * FROM ip_pool WHERE id=?').get(id);
}
router.get('/ips', (req, res) => {
  rentals.expireRentals();
  const result = tableList(req, { table: 'ip_pool', select: 't.*,u.email assigned_to,r.expires_at lease_expires_at,CASE WHEN r.id IS NULL THEN 0 ELSE 1 END is_allocated', join: `LEFT JOIN static_rentals r ON r.ip_id=t.id AND r.status IN ('active','disabled') AND r.expires_at>${Date.now()} LEFT JOIN users u ON u.id=r.user_id`, filters: { status: 't.status', country: 't.country' }, search: ['t.host', 't.country', 't.region', 't.city', 't.isp'] });
  result.items = result.items.map(row => ({ ...row, is_allocated: Boolean(row.is_allocated) })); res.json(result);
});
router.post('/ips', route((req, res) => {
  const row = insertIp(ipSchema.parse(req.body)); audit(req, 'ip.create', row.id); res.status(201).json({ ip: row });
}));
router.post('/ips/import', route((req, res) => {
  const body = z.object({ text: z.string().min(1).max(1000000), protocol: z.enum(['http', 'socks5']).default('http'), country }).parse(req.body);
  const lines = body.text.split(/\r?\n/); if (lines.length > 5000) fail(400, 'VALIDATION_ERROR', '单次最多导入 5,000 行');
  const output = { added: 0, skipped: 0, errors: [] };
  db.transaction(() => {
    lines.forEach((line, index) => {
      line = line.trim(); if (!line || line.startsWith('#')) return;
      try {
        let data;
        if (line.includes(',')) {
          const [host, port, protocol, upstream_user, upstream_pass, country, region, city, isp] = line.split(',').map(v => v.trim());
          data = { host, port: Number(port), protocol: protocol || body.protocol, upstream_user, upstream_pass, country: country || body.country, region, city, isp };
        } else {
          const match = /^(\[[^\]]+\]|[^:]+):(\d+)(?::([^:]*):(.*))?$/.exec(line);
          if (!match) throw new Error('应为 host:port:user:pass 或逗号分隔格式');
          data = { host: match[1].replace(/^\[|\]$/g, ''), port: Number(match[2]), upstream_user: match[3], upstream_pass: match[4], protocol: body.protocol, country: body.country };
        }
        insertIp(ipSchema.parse(data)); output.added++;
      } catch (err) { output.skipped++; output.errors.push({ line: index + 1, reason: err.issues?.[0]?.message || err.message }); }
    });
    audit(req, 'ip.import', '', { added: output.added, skipped: output.skipped });
  })();
  res.json(output);
}));
const tcpCheck = (row) => new Promise(resolve => {
  const socket = net.connect({ host: row.host, port: row.port }); let ended = false;
  const done = (ok) => { if (ended) return; ended = true; socket.destroy(); resolve(ok); };
  socket.setTimeout(3000, () => done(false)); socket.once('connect', () => done(true)); socket.once('error', () => done(false));
});
let checking = false;
router.post('/ips/check', route(async (req, res) => {
  const body = z.object({ ids: z.array(z.string().uuid()).max(500).optional() }).parse(req.body || {});
  if (checking) fail(409, 'CONFLICT', 'IP 检测正在进行，请稍后再试');
  const rows = body.ids ? (body.ids.length ? db.prepare(`SELECT * FROM ip_pool WHERE id IN (${body.ids.map(() => '?').join(',')})`).all(...body.ids) : []) : db.prepare("SELECT * FROM ip_pool WHERE status='active' ORDER BY last_check_at LIMIT 500").all();
  checking = true; const output = { checked: rows.length, ok: 0, failed: 0 }; let cursor = 0;
  try {
    await Promise.all(Array.from({ length: Math.min(10, rows.length) }, async () => {
      while (cursor < rows.length) {
        const row = rows[cursor++]; const good = await tcpCheck(row); const now = Date.now();
        if (good) { output.ok++; db.prepare('UPDATE ip_pool SET last_check_at=?,last_ok_at=?,fail_count=0 WHERE id=?').run(now, now, row.id); }
        else { output.failed++; db.prepare("UPDATE ip_pool SET last_check_at=?,fail_count=fail_count+1,status=CASE WHEN fail_count+1>=5 THEN 'disabled' ELSE status END WHERE id=?").run(now, row.id); }
      }
    }));
    audit(req, 'ip.check', '', output); res.json(output);
  } finally { checking = false; }
}));
router.patch('/ips/:id', route((req, res) => {
  const body = ipPatchSchema.parse(req.body); const entries = Object.entries(body);
  const ip = db.transaction(() => {
    const old = db.prepare('SELECT * FROM ip_pool WHERE id=?').get(req.params.id); if (!old) fail(404, 'NOT_FOUND', 'IP 不存在');
    const allocated = db.prepare("SELECT id FROM static_rentals WHERE ip_id=? AND status IN ('active','disabled') AND expires_at>? LIMIT 1").get(old.id, Date.now());
    if (allocated && ['host', 'port', 'protocol', 'upstream_user', 'upstream_pass'].some(field => body[field] !== undefined && body[field] !== old[field])) fail(409, 'IP_ALLOCATED', '分配中的静态 IP 不能更改地址、协议或上游认证');
    try { if (entries.length) db.prepare(`UPDATE ip_pool SET ${entries.map(([key]) => `${key}=?`).join(',')} WHERE id=?`).run(...entries.map(([, value]) => value), req.params.id); }
    catch (err) { if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') fail(409, 'CONFLICT', '相同地址与端口的上游已存在'); throw err; }
    audit(req, 'ip.update', req.params.id, { fields: Object.keys(body) }); return db.prepare('SELECT * FROM ip_pool WHERE id=?').get(req.params.id);
  }).immediate();
  res.json({ ip });
}));
router.delete('/ips/:id', route((req, res) => {
  db.transaction(() => {
    if (db.prepare('SELECT id FROM static_rentals WHERE ip_id=? LIMIT 1').get(req.params.id)) fail(409, 'IP_HAS_RENTAL_HISTORY', '节点已有租赁历史，不能删除；可使用停用操作');
    if (!db.prepare('DELETE FROM ip_pool WHERE id=?').run(req.params.id).changes) fail(404, 'NOT_FOUND', 'IP 不存在');
    audit(req, 'ip.delete', req.params.id);
  }).immediate();
  res.status(204).end();
}));
const adminSettings = () => { const s = getSettings(); return { site_name: s.site_name || '', announcement: s.announcement || '', pay_alipay_enabled: s.pay_alipay_enabled !== '0', pay_wechat_enabled: s.pay_wechat_enabled !== '0', docs_markdown: s.docs_markdown || DEFAULT_DOCS, docs_default: DEFAULT_DOCS, gateway: `${config.publicGatewayHost}:${config.publicGatewayPort || config.gatewayPort}`, channels: channels().map(({ key, name, configured }) => ({ key, name, configured })) }; };
router.get('/settings', (req, res) => res.json({ settings: adminSettings() }));
router.put('/settings', route((req, res) => {
  const body = z.object({ site_name: z.string().trim().min(1).max(60).optional(), announcement: z.string().max(2000).optional(), pay_alipay_enabled: z.boolean().optional(), pay_wechat_enabled: z.boolean().optional(), docs_markdown: z.string().max(50000, '接入说明最多 50000 字').optional() }).strict().parse(req.body);
  const data = Object.fromEntries(Object.entries(body).map(([key, value]) => [key, typeof value === 'boolean' ? (value ? '1' : '0') : value]));
  // 与默认模板相同则存空值，之后模板更新仍然生效
  if (typeof data.docs_markdown === 'string' && data.docs_markdown.trim() === DEFAULT_DOCS.trim()) data.docs_markdown = '';
  db.transaction(() => { setSettings(data); audit(req, 'settings.update', '', { fields: Object.keys(body) }); })();
  res.json({ settings: adminSettings() });
}));
module.exports = router;
