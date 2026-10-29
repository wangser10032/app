const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const db = require('../db');
const config = require('../config');
const { addLedger } = require('./ledger');
const { genNo, paginate, paged } = require('../utils');
const { fail } = require('../utils/errors');
const { z, countryValue, status } = require('../utils/validation');
const DAY = 86400000;
const credentialKey = () => crypto.createHash('sha256').update('resihub-static-credentials\0').update(config.proxyCredentialSecret || config.jwtSecret).digest();
function encryptPassword(secret) {
  const iv = crypto.randomBytes(12); const cipher = crypto.createCipheriv('aes-256-gcm', credentialKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), ciphertext.toString('base64url')].join(':');
}
function decryptPassword(value) {
  try {
    const [version, iv, tag, ciphertext] = value.split(':'); if (version !== 'v1') throw new Error('bad_version');
    const decipher = crypto.createDecipheriv('aes-256-gcm', credentialKey(), Buffer.from(iv, 'base64url')); decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(ciphertext, 'base64url')), decipher.final()]).toString('utf8');
  } catch { fail(503, 'CREDENTIAL_UNAVAILABLE', '代理凭据无法解密，请联系管理员检查凭据密钥'); }
}
function expireRentals() { db.prepare("UPDATE static_rentals SET status='expired' WHERE status IN ('active','disabled') AND expires_at<=?").run(Date.now()); }
const occupied = "EXISTS (SELECT 1 FROM static_rentals rental WHERE rental.ip_id=p.id AND rental.status IN ('active','disabled') AND rental.expires_at>?)";
function productFilter(product) {
  const clauses = ["p.status='active'", `NOT ${occupied}`, 'p.protocol=?']; const values = [Date.now(), product.protocol];
  for (const field of ['country', 'region', 'city', 'isp']) if (product[field]) { clauses.push(`LOWER(p.${field})=LOWER(?)`); values.push(product[field]); }
  return { where: clauses.join(' AND '), values };
}
function availableCount(product) { const f = productFilter(product); return db.prepare(`SELECT COUNT(*) n FROM ip_pool p WHERE ${f.where}`).get(...f.values).n; }
function productView(product) { return { ...product, available_ips: availableCount(product) }; }
function getProducts(includeDisabled = false) {
  expireRentals(); return db.prepare(`SELECT * FROM static_products ${includeDisabled ? '' : "WHERE status='active'"} ORDER BY sort,created_at,id`).all().map(productView);
}
function effectiveStatus(row) {
  if (row.expires_at <= Date.now() || row.status === 'expired') return 'expired';
  if (row.status === 'disabled') return 'disabled';
  return row.ip_status === 'active' ? 'active' : 'unavailable';
}
const rentalSelect = 'r.*,p.host ip_host,p.port ip_port,p.status ip_status,products.price_cents renew_price_cents,products.duration_days,products.status product_status';
const rentalJoin = 'FROM static_rentals r LEFT JOIN ip_pool p ON p.id=r.ip_id LEFT JOIN static_products products ON products.id=r.product_id';
function rentalRow(id, userId) { return db.prepare(`SELECT ${rentalSelect} ${rentalJoin} WHERE r.id=? ${userId ? 'AND r.user_id=?' : ''}`).get(...[id, ...(userId ? [userId] : [])]); }
function rentalView(row, revealPassword = true) {
  const view = { id: row.id, product_id: row.product_id, product_name: row.product_name, country: row.country, region: row.region, city: row.city, isp: row.isp, ip_host: row.ip_host || '', ip_port: row.ip_port || 0, protocol: row.protocol, proxy_host: config.publicGatewayHost, proxy_port: config.publicGatewayPort || config.gatewayPort, username: row.username, remark: row.remark, status: effectiveStatus(row), expires_at: row.expires_at, created_at: row.created_at, renew_price_cents: row.renew_price_cents || 0, duration_days: row.duration_days || 0, renewable: row.product_status === 'active' && row.ip_status === 'active' && row.status !== 'disabled' && isLatestRental(row) };
  if (revealPassword) view.password = decryptPassword(row.password_encrypted);
  if (row.user_email !== undefined) view.user_email = row.user_email;
  return view;
}
function isLatestRental(row) { return db.prepare('SELECT id FROM static_rentals WHERE ip_id=? ORDER BY rowid DESC LIMIT 1').get(row.ip_id)?.id === row.id; }
function listRentals(req, admin = false) {
  expireRentals(); const { page, pageSize, offset } = paginate(req); const clauses = ['1=1']; const values = [];
  if (!admin) { clauses.push('r.user_id=?'); values.push(req.user.id); }
  if (typeof req.query.country === 'string' && req.query.country) { clauses.push('UPPER(TRIM(r.country))=?'); values.push(req.query.country.trim().toUpperCase()); }
  if (typeof req.query.q === 'string' && req.query.q) { const q = `%${req.query.q.slice(0, 100)}%`; clauses.push('(r.product_name LIKE ? OR p.host LIKE ? OR r.username LIKE ? OR r.remark LIKE ? OR u.email LIKE ?)'); values.push(q, q, q, q, q); }
  const statusExpression = "CASE WHEN r.expires_at<=? OR r.status='expired' THEN 'expired' WHEN r.status='disabled' THEN 'disabled' WHEN p.status='active' THEN 'active' ELSE 'unavailable' END";
  if (typeof req.query.status === 'string' && req.query.status) { clauses.push(`${statusExpression}=?`); values.push(Date.now(), req.query.status); }
  const from = `${rentalJoin} JOIN users u ON u.id=r.user_id WHERE ${clauses.join(' AND ')}`;
  const rows = db.prepare(`SELECT ${rentalSelect},u.email user_email ${from} ORDER BY r.created_at DESC,r.id DESC LIMIT ? OFFSET ?`).all(...values, pageSize, offset);
  return paged(rows.map(row => { const view = rentalView(row, !admin); if (!admin) delete view.user_email; return view; }), db.prepare(`SELECT COUNT(*) n ${from}`).get(...values).n, page, pageSize);
}
function requestKey(req) { return z.string().trim().min(1, '必须提供 Idempotency-Key 请求头').max(120).parse(req.get('Idempotency-Key')); }
function addOrder({ userId, product, quantity, kind, requestKey, rentalId = '' }) {
  const id = crypto.randomUUID(); const now = Date.now(); const total = product.price_cents * quantity;
  if (!Number.isSafeInteger(total)) fail(400, 'VALIDATION_ERROR', '订单金额超出范围');
  addLedger({ userId, type: 'purchase', amountCents: -total, refType: 'order', refId: id, remark: `${kind === 'static_renewal' ? '续费' : '购买'}静态住宅 IP：${product.name} × ${quantity}` });
  db.prepare("INSERT INTO orders(id,order_no,user_id,package_id,package_name,traffic_mb,amount_cents,status,paid_at,created_at,request_key,kind,quantity,duration_days,product_id,rental_id) VALUES(?,?,?,'',?,0,?,'paid',?,?,?,?,?,?,?,?)").run(id, genNo('O'), userId, product.name, total, now, now, requestKey, kind, quantity, product.duration_days, product.id, rentalId);
  return db.prepare('SELECT * FROM orders WHERE id=?').get(id);
}
function orderRentals(order) { return db.prepare(`SELECT ${rentalSelect} ${rentalJoin} WHERE r.initial_order_id=? ORDER BY r.created_at,r.id`).all(order.id).map(row => rentalView(row)); }
const purchase = db.transaction(({ userId, productId, quantity, key }) => {
  expireRentals();
  const existing = db.prepare('SELECT * FROM orders WHERE user_id=? AND request_key=?').get(userId, key);
  if (existing) { if (existing.kind !== 'static_purchase' || existing.product_id !== productId || existing.quantity !== quantity) fail(409, 'CONFLICT', '请求标识已用于其他订单'); return { order: existing, rentals: orderRentals(existing) }; }
  const product = db.prepare('SELECT * FROM static_products WHERE id=?').get(productId);
  if (!product || product.status !== 'active') fail(409, 'PRODUCT_DISABLED', '产品不存在或已停售');
  const filter = productFilter(product); const ips = db.prepare(`SELECT p.* FROM ip_pool p WHERE ${filter.where} ORDER BY p.created_at,p.id LIMIT ?`).all(...filter.values, quantity);
  if (ips.length !== quantity) fail(409, 'OUT_OF_STOCK', '当前可售 IP 数量不足，请减少购买数量');
  const order = addOrder({ userId, product, quantity, kind: 'static_purchase', requestKey: key });
  const now = Date.now(); const insert = db.prepare('INSERT INTO static_rentals(id,user_id,product_id,initial_order_id,ip_id,product_name,country,region,city,isp,protocol,username,password_hash,password_encrypted,expires_at,created_at) VALUES(@id,@user_id,@product_id,@initial_order_id,@ip_id,@product_name,@country,@region,@city,@isp,@protocol,@username,@password_hash,@password_encrypted,@expires_at,@created_at)');
  for (const ip of ips) {
    const secret = crypto.randomBytes(18).toString('base64url');
    insert.run({ id: crypto.randomUUID(), user_id: userId, product_id: product.id, initial_order_id: order.id, ip_id: ip.id, product_name: product.name, country: ip.country, region: ip.region, city: ip.city, isp: ip.isp, protocol: ip.protocol, username: `sip_${crypto.randomBytes(10).toString('hex')}`, password_hash: bcrypt.hashSync(secret, 10), password_encrypted: encryptPassword(secret), expires_at: now + product.duration_days * DAY, created_at: now });
  }
  return { order, rentals: orderRentals(order) };
});
const renew = db.transaction(({ userId, rentalId, key }) => {
  expireRentals();
  const existing = db.prepare('SELECT * FROM orders WHERE user_id=? AND request_key=?').get(userId, key);
  if (existing) { if (existing.kind !== 'static_renewal' || existing.rental_id !== rentalId) fail(409, 'CONFLICT', '请求标识已用于其他订单'); return { order: existing, rental: rentalView(rentalRow(rentalId, userId)) }; }
  const row = rentalRow(rentalId, userId); if (!row) fail(404, 'NOT_FOUND', '租用 IP 不存在');
  if (row.status === 'disabled') fail(409, 'RENTAL_DISABLED', '该租约已停用，请联系管理员');
  if (!isLatestRental(row)) fail(409, 'IP_REALLOCATED', '该 IP 已重新分配，旧租约无法续费');
  if (row.ip_status !== 'active') fail(409, 'IP_UNAVAILABLE', '该 IP 暂不可用，无法续费');
  const product = db.prepare('SELECT * FROM static_products WHERE id=?').get(row.product_id);
  if (!product || product.status !== 'active') fail(409, 'PRODUCT_DISABLED', '产品已停售，无法续费');
  const other = db.prepare("SELECT id FROM static_rentals WHERE ip_id=? AND id<>? AND status IN ('active','disabled') AND expires_at>?").get(row.ip_id, row.id, Date.now());
  if (other) fail(409, 'IP_REALLOCATED', '该 IP 已重新分配，旧租约无法续费');
  const order = addOrder({ userId, product, quantity: 1, kind: 'static_renewal', requestKey: key, rentalId });
  db.prepare("UPDATE static_rentals SET expires_at=?,status='active' WHERE id=?").run(Math.max(Date.now(), row.expires_at) + product.duration_days * DAY, row.id);
  return { order, rental: rentalView(rentalRow(row.id, userId)) };
});
function summary(userId) {
  expireRentals(); const now = Date.now();
  return db.prepare("SELECT COUNT(*) static_ip_total,COALESCE(SUM(CASE WHEN r.status='active' AND r.expires_at>? AND p.status='active' THEN 1 ELSE 0 END),0) static_ip_active,COALESCE(SUM(CASE WHEN r.status='active' AND r.expires_at>? AND r.expires_at<=? AND p.status='active' THEN 1 ELSE 0 END),0) static_ip_expiring FROM static_rentals r LEFT JOIN ip_pool p ON p.id=r.ip_id WHERE r.user_id=?").get(now, now, now + 7 * DAY, userId);
}
const productFields = { name: z.string().trim().min(1).max(80), description: z.string().max(1000), country: countryValue, region: z.string().trim().max(100), city: z.string().trim().max(100), isp: z.string().trim().max(150), protocol: z.enum(['http', 'socks5']), duration_days: z.number().int().min(1).max(3650), price_cents: z.number().int().min(1).max(100000000), status, sort: z.number().int().min(-100000).max(100000) };
const createProductSchema = z.object({ ...productFields, description: productFields.description.default(''), country: productFields.country.default(''), region: productFields.region.default(''), city: productFields.city.default(''), isp: productFields.isp.default(''), protocol: productFields.protocol.default('http'), status: productFields.status.default('active'), sort: productFields.sort.default(0) }).strict();
const patchProductSchema = z.object(productFields).partial().strict();
module.exports = { encryptPassword, decryptPassword, expireRentals, availableCount, productView, getProducts, rentalRow, rentalView, listRentals, requestKey, purchase, renew, summary, isLatestRental, createProductSchema, patchProductSchema };
