const http = require('http');
const net = require('net');
const bcrypt = require('bcryptjs');
const { Transform } = require('stream');
const db = require('../db');
const config = require('../config');
const { resolveTarget, dial, tunnel } = require('./network');
let server;
const sockets = new Set(); const active = new Map(); const attempts = new Map();
const errorBody = error => JSON.stringify({ error });
function reject(res, status, error) {
  const body = errorBody(error);
  if (res instanceof http.ServerResponse) { if (res.headersSent) return res.destroy(); res.writeHead(status, { 'Content-Type': 'application/json', ...(status === 407 ? { 'Proxy-Authenticate': 'Basic realm="ResiHub"' } : {}) }); res.end(body); }
  else if (!res.destroyed) res.end(`HTTP/1.1 ${status} ${status === 407 ? 'Proxy Authentication Required' : 'Bad Gateway'}\r\nContent-Type: application/json\r\nContent-Length: ${Buffer.byteLength(body)}\r\nConnection: close\r\n${status === 407 ? 'Proxy-Authenticate: Basic realm="ResiHub"\r\n' : ''}\r\n${body}`);
}
async function authenticate(req) {
  const auth = /^Basic ([A-Za-z0-9+/=]+)$/i.exec(req.headers['proxy-authorization'] || '');
  if (!auth || auth[1].length > 1024) { countAttempt(req.socket.remoteAddress); throw new Error('auth_failed'); }
  const credential = Buffer.from(auth[1], 'base64').toString(); const separator = credential.indexOf(':');
  if (separator < 1) { countAttempt(req.socket.remoteAddress); throw new Error('auth_failed'); }
  return authorize(req.socket.remoteAddress, credential.slice(0, separator), credential.slice(separator + 1));
}
function countAttempt(address) {
  const now = Date.now(); let bucket = attempts.get(address);
  if (!bucket || bucket.until < now) { bucket = { count: 0, until: now + 60000 }; attempts.set(address, bucket); }
  if (++bucket.count > 240) throw new Error('rate_limited');
  if (attempts.size > 5000) for (const [key, value] of attempts) if (value.until < now) attempts.delete(key);
}
// HTTP Basic 与 SOCKS5 用户名/密码共用：限速、租约/用户/节点状态校验与每用户并发上限
async function authorize(address, username, secret) {
  countAttempt(address); const now = Date.now();
  if (!/^sip_[a-f0-9]{20}$/.test(username) || Buffer.byteLength(secret) > 72) throw new Error('auth_failed');
  const key = db.prepare("SELECT r.*,u.status user_status,p.status ip_status FROM static_rentals r JOIN users u ON u.id=r.user_id JOIN ip_pool p ON p.id=r.ip_id WHERE r.username=?").get(username);
  if (!key || key.status !== 'active' || key.expires_at <= now || key.user_status !== 'active' || key.ip_status !== 'active' || !await bcrypt.compare(secret, key.password_hash)) throw new Error('auth_failed');
  const count = active.get(key.user_id) || 0;
  if (count >= (config.gatewayMaxConnections || 20)) throw new Error('connection_limit');
  active.set(key.user_id, count + 1);
  let released = false;
  return { key, release() { if (!released) { released = true; active.set(key.user_id, Math.max(0, (active.get(key.user_id) || 1) - 1)); } } };
}
function choose(context) {
  const upstream = db.prepare("SELECT p.* FROM ip_pool p JOIN static_rentals r ON r.ip_id=p.id JOIN users u ON u.id=r.user_id WHERE r.id=? AND r.status='active' AND r.expires_at>? AND p.status='active' AND u.status='active'").get(context.key.id, Date.now());
  if (!upstream) throw new Error('auth_failed'); return upstream;
}
function upstreamFailed(id) { db.prepare("UPDATE ip_pool SET fail_count=fail_count+1,last_check_at=?,status=CASE WHEN fail_count+1>=5 THEN 'disabled' ELSE status END WHERE id=?").run(Date.now(), id); }
async function connectUpstream(context, target, connect) {
  const upstream = choose(context);
  try {
    const socket = connect || upstream.protocol === 'socks5' ? await tunnel(upstream, target) : await dial(upstream.host, upstream.port);
    db.prepare('UPDATE ip_pool SET last_ok_at=?,fail_count=0 WHERE id=?').run(Date.now(), upstream.id); return { socket, upstream };
  } catch (error) { upstreamFailed(upstream.id); throw error; }
}
function metering(context) {
  let flushed = false;
  const valid = () => Boolean(db.prepare("SELECT r.id FROM static_rentals r JOIN users u ON u.id=r.user_id JOIN ip_pool p ON p.id=r.ip_id WHERE r.id=? AND r.status='active' AND r.expires_at>? AND u.status='active' AND p.status='active' AND r.password_hash=? AND r.ip_id=?").get(context.key.id, Date.now(), context.key.password_hash, context.key.ip_id));
  function guard() { return new Transform({ transform(chunk, encoding, done) {
    try { if (!valid()) return done(new Error('rental_inactive')); this.push(chunk); done(); } catch (error) { done(error); }
  } }); }
  const incoming=guard(), outgoing=guard();
  const timer=setInterval(()=>{ if(flushed) return; try { if(valid()) return; } catch {} incoming.destroy(new Error('rental_inactive')); outgoing.destroy(new Error('rental_inactive')); },500); timer.unref();
  return { incoming,outgoing,flush(){if(flushed)return;flushed=true;clearInterval(timer);context.release();} };
}
function cleanHeaders(headers) {
  const connectionFields = String(headers.connection || '').split(',').map(s => s.trim().toLowerCase());
  const banned = new Set(['proxy-authorization', 'proxy-authenticate', 'proxy-connection', 'connection', 'keep-alive', 'te', 'trailer', 'transfer-encoding', 'upgrade', ...connectionFields]);
  return Object.fromEntries(Object.entries(headers).filter(([key]) => !banned.has(key.toLowerCase())));
}
async function handleHttp(req, res) {
  let context; let socket;
  req.pause();
  try {
    context = await authenticate(req);
    if (res.destroyed || req.destroyed) { context.release(); return; }
    let targetUrl; try { targetUrl = new URL(req.url); } catch { throw new Error('invalid_target'); }
    if (targetUrl.protocol !== 'http:' || targetUrl.username || targetUrl.password) throw new Error('invalid_target');
    const target = await resolveTarget(targetUrl.hostname, Number(targetUrl.port || 80));
    const connected = await connectUpstream(context, target, false); socket = connected.socket;
    const { upstream } = connected;
    if (res.destroyed || req.destroyed) { socket.destroy(); context.release(); return; }
    const meters = metering(context, upstream);
    const agent = new http.Agent({ keepAlive: false }); agent.createConnection = (options, callback) => { callback(null, socket); return socket; };
    const absolute = new URL(targetUrl); absolute.hostname = net.isIP(target.ip) === 6 ? `[${target.ip}]` : target.ip;
    const headers = { ...cleanHeaders(req.headers), host: targetUrl.host, connection: 'close' };
    if (upstream.protocol === 'http' && upstream.upstream_user) headers['proxy-authorization'] = `Basic ${Buffer.from(`${upstream.upstream_user}:${upstream.upstream_pass}`).toString('base64')}`;
    const outgoing = http.request({ method: req.method, path: upstream.protocol === 'http' ? absolute.toString() : `${targetUrl.pathname}${targetUrl.search}`, headers, agent, host: upstream.host, port: upstream.port }, response => {
      res.writeHead(response.statusCode || 502, { ...cleanHeaders(response.headers), connection: 'close' });
      response.pipe(meters.incoming).pipe(res);
      response.on('error', teardown);
    });
    let finished = false;
    function teardown(error) { if (finished) return; finished = true; if (error && !res.headersSent) reject(res, 502, 'upstream_failed'); outgoing.destroy(); socket.destroy(); meters.incoming.destroy(); meters.outgoing.destroy(); meters.flush(); agent.destroy(); if (error && res.headersSent) res.destroy(); }
    meters.incoming.on('error', teardown); meters.outgoing.on('error', teardown); outgoing.on('error', teardown); req.on('aborted', () => teardown()); req.on('error', teardown); res.on('close', () => teardown());
    outgoing.setTimeout(60000, () => teardown(new Error('upstream_timeout')));
    req.pipe(meters.outgoing).pipe(outgoing); req.resume(); socket.resume();
  } catch (error) { socket?.destroy(); context?.release(); reject(res, ['auth_failed', 'rental_inactive'].includes(error.message) ? 407 : error.message === 'rate_limited' || error.message === 'connection_limit' ? 429 : error.message === 'target_forbidden' ? 403 : 502, error.message === 'auth_failed' || error.message === 'rental_inactive' || error.message === 'target_forbidden' ? error.message : 'upstream_failed'); }
}
async function handleConnect(req, client, head) {
  let context; let remote;
  client.pause();
  try {
    context = await authenticate(req);
    const match = /^(\[[^\]]+\]|[^:]+):(\d+)$/.exec(req.url); if (!match) throw new Error('invalid_target');
    const target = await resolveTarget(match[1], Number(match[2]));
    const connection = await connectUpstream(context, target, true); remote = connection.socket;
    if (client.destroyed) { context.release(); remote.destroy(); return; }
    bridge(context, client, connection, 'HTTP/1.1 200 Connection Established\r\n\r\n', head);
  } catch (error) { remote?.destroy(); context?.release(); reject(client, ['auth_failed', 'rental_inactive'].includes(error.message) ? 407 : ['rate_limited', 'connection_limit'].includes(error.message) ? 429 : error.message === 'target_forbidden' ? 403 : 502, ['auth_failed', 'rental_inactive', 'target_forbidden'].includes(error.message) ? error.message : 'upstream_failed'); }
}
// CONNECT 与 SOCKS5 共用的双向隧道：租约失效时由 metering 中断，空闲 120 秒关闭
function bridge(context, client, { socket: remote, upstream }, greeting, head) {
  const meters = metering(context, upstream); let closed = false;
  const teardown = () => { if (closed) return; closed = true; client.destroy(); remote.destroy(); meters.incoming.destroy(); meters.outgoing.destroy(); meters.flush(); };
  client.on('error', teardown); client.on('close', teardown); remote.on('error', teardown); remote.on('close', teardown); meters.incoming.on('error', teardown); meters.outgoing.on('error', teardown);
  client.setTimeout(120000, teardown); remote.setTimeout(120000, teardown);
  client.write(greeting);
  if (head.length) meters.outgoing.write(head);
  client.pipe(meters.outgoing).pipe(remote); remote.pipe(meters.incoming).pipe(client); client.resume(); remote.resume();
}
// 按需读取固定字节数的 SOCKS5 握手解析器；detach() 交还已读但未消费的数据
function reader(socket) {
  let buffer = Buffer.alloc(0), wanted = 0, waiting = null;
  const flush = () => { if (waiting && buffer.length >= wanted) { const out = buffer.subarray(0, wanted); buffer = buffer.subarray(wanted); const done = waiting; waiting = null; done.resolve(out); } };
  const onData = chunk => { buffer = Buffer.concat([buffer, chunk]); if (buffer.length > 16384) { socket.destroy(); return; } flush(); };
  const onEnd = () => { if (waiting) { const done = waiting; waiting = null; done.reject(new Error('socks_closed')); } };
  socket.on('data', onData); socket.on('close', onEnd); socket.resume();
  return {
    read(n) { return new Promise((resolve, reject) => { wanted = n; waiting = { resolve, reject }; if (socket.destroyed) onEnd(); else flush(); }); },
    detach() { socket.off('data', onData); socket.off('close', onEnd); socket.pause(); return buffer; },
  };
}
const SOCKS_REPLY = { target_forbidden: 2, invalid_target: 4, target_not_found: 4, ENOTFOUND: 4, command: 7, address_type: 8 };
async function handleSocks(client) {
  let context; let remote; const input = reader(client);
  const reply = code => { if (!client.destroyed) client.end(Buffer.from([5, code, 0, 1, 0, 0, 0, 0, 0, 0])); };
  client.setTimeout(15000, () => client.destroy());
  try {
    const [, methods] = await input.read(2);
    if (!(await input.read(methods)).includes(2)) { client.end(Buffer.from([5, 0xff])); return; }
    client.write(Buffer.from([5, 2]));
    const [, userSize] = await input.read(2); const user = (await input.read(userSize)).toString();
    const [passSize] = await input.read(1); const pass = (await input.read(passSize)).toString();
    try { context = await authorize(client.remoteAddress, user, pass); } catch { client.end(Buffer.from([1, 1])); return; }
    client.write(Buffer.from([1, 0]));
    const [version, command, , type] = await input.read(4);
    let host;
    if (type === 1) host = [...await input.read(4)].join('.');
    else if (type === 3) { const [size] = await input.read(1); host = (await input.read(size)).toString(); }
    else if (type === 4) { const raw = await input.read(16); host = Array.from({ length: 8 }, (_, i) => raw.readUInt16BE(i * 2).toString(16)).join(':'); }
    else throw new Error('address_type');
    const port = (await input.read(2)).readUInt16BE(0);
    if (version !== 5 || command !== 1) throw new Error('command');
    const target = await resolveTarget(host, port);
    const connection = await connectUpstream(context, target, true); remote = connection.socket;
    if (client.destroyed) { context.release(); remote.destroy(); return; }
    const head = input.detach(); client.setTimeout(0);
    bridge(context, client, connection, Buffer.from([5, 0, 0, 1, 0, 0, 0, 0, 0, 0]), head);
  } catch (error) { input.detach(); remote?.destroy(); context?.release(); reply(SOCKS_REPLY[error.message] || SOCKS_REPLY[error.code] || 1); }
}
function startGateway({ port = config.gatewayPort } = {}) {
  if (server) return server;
  const proxy = http.createServer({ maxHeaderSize: 16384, requestTimeout: 60000, headersTimeout: 15000 }, (req, res) => { handleHttp(req, res); });
  proxy.on('connect', (req, socket, head) => { handleConnect(req, socket, head); });
  proxy.on('clientError', (error, socket) => socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n'));
  proxy.setTimeout(120000);
  // 同一端口同时提供 HTTP/HTTPS(CONNECT) 与 SOCKS5：按首字节分流，0x05 为 SOCKS5
  server = net.createServer({ pauseOnConnect: true }, socket => {
    sockets.add(socket); socket.on('error', () => {}); socket.once('close', () => sockets.delete(socket));
    socket.setTimeout(15000, () => socket.destroy());
    socket.once('data', chunk => {
      socket.setTimeout(0);
      if (chunk[0] === 5) { socket.pause(); socket.unshift(chunk); handleSocks(socket); return; }
      // HTTP 服务器直接从底层句柄读取，unshift 的数据它看不到；交接后把首块数据重新派发给它的解析器
      proxy.emit('connection', socket); socket.emit('data', chunk);
    });
    socket.resume();
  });
  server.on('error', error => { console.error('[gateway]', error.message); process.exitCode = 1; });
  server.listen(port, '0.0.0.0', () => console.log(`[gateway] listening on :${port}`)); return server;
}
function stopGateway() { for (const socket of sockets) socket.destroy(); server?.close(); server = null; active.clear(); attempts.clear(); }
module.exports = { startGateway, stopGateway };
