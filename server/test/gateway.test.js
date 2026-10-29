const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const net = require('node:net');
const { once } = require('node:events');
const { randomUUID } = require('node:crypto');
const bcrypt = require('bcryptjs');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'resihub-gateway-'));
process.env.NODE_ENV = 'test';
process.env.DB_PATH = path.join(dir, 'gateway.db');
process.env.PAYMENT_MODE = 'mock';
process.env.MAIL_MODE = 'mock';
process.env.GATEWAY_ALLOW_PRIVATE_TARGETS = 'false';
const config = require('../src/config');
const db = require('../src/db');
const rentalsService = require('../src/services/static-rentals');
const { startGateway, stopGateway } = require('../src/gateway/start');
const { isPublicIp } = require('../src/gateway/network');
const userId = randomUUID(); let secret, username, rentalId;
const fixtures = []; let gateway; let gatewayPort; let target; let echo; let upstreamA; let upstreamB; let socks;
async function fixture(server) {
  const sockets = new Set(); server.on('connection', socket => { sockets.add(socket); socket.once('close', () => sockets.delete(socket)); socket.on('error', () => {}); });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const item = { server, port: server.address().port, sockets, requests: 0 }; fixtures.push(item); return item;
}
async function httpUpstream() {
  let item;
  const server = http.createServer((req, res) => {
    item.requests++;
    if (req.headers['proxy-authorization'] !== `Basic ${Buffer.from('upuser:uppass').toString('base64')}`) { res.writeHead(407).end(); return; }
    const url = new URL(req.url); const headers = { ...req.headers }; delete headers['proxy-authorization'];
    const outgoing = http.request(url, { method: req.method, headers }, response => { res.writeHead(response.statusCode, response.headers); response.pipe(res); });
    outgoing.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end(); }); req.pipe(outgoing);
  });
  server.on('connect', (req, client, head) => {
    item.requests++;
    if (req.headers['proxy-authorization'] !== `Basic ${Buffer.from('upuser:uppass').toString('base64')}`) { client.end('HTTP/1.1 407 Auth Required\r\n\r\n'); return; }
    const target = new URL(`http://${req.url}`);
    const outgoing = net.connect(Number(target.port), target.hostname.replace(/^\[|\]$/g, ''), () => { client.write('HTTP/1.1 200 Connection Established\r\n\r\n'); if (head.length) outgoing.write(head); client.pipe(outgoing).pipe(client); });
    const end = () => { outgoing.destroy(); client.destroy(); }; outgoing.on('error', end); client.on('error', end); client.on('close', end); outgoing.on('close', end);
  });
  item = await fixture(server); return item;
}
async function socksUpstream() {
  let item;
  const server = net.createServer(client => {
    let state = 'greeting'; let buffer = Buffer.alloc(0); let remote;
    const stop = () => { remote?.destroy(); client.destroy(); }; client.on('error', stop); client.on('close', stop);
    function parse(chunk) {
      buffer = Buffer.concat([buffer, chunk]);
      if (state === 'greeting') {
        if (buffer.length < 2 || buffer.length < 2 + buffer[1]) return;
        assert.equal(buffer[0], 5); assert.ok(buffer.subarray(2, 2 + buffer[1]).includes(2));
        buffer = buffer.subarray(2 + buffer[1]); client.write(Buffer.from([5, 2])); state = 'auth';
      }
      if (state === 'auth') {
        if (buffer.length < 2 || buffer.length < 3 + buffer[1]) return;
        const userSize = buffer[1]; const passSize = buffer[2 + userSize]; const size = 3 + userSize + passSize;
        if (buffer.length < size) return;
        assert.equal(buffer.subarray(2, 2 + userSize).toString(), 'upuser'); assert.equal(buffer.subarray(3 + userSize, size).toString(), 'uppass');
        buffer = buffer.subarray(size); client.write(Buffer.from([1, 0])); state = 'request';
      }
      if (state === 'request') {
        if (buffer.length < 5) return;
        const type = buffer[3]; const size = type === 1 ? 10 : type === 3 ? 7 + buffer[4] : 22;
        if (buffer.length < size) return;
        let host; if (type === 1) host = [...buffer.subarray(4, 8)].join('.'); else if (type === 3) host = buffer.subarray(5, size - 2).toString(); else return stop();
        const port = buffer.readUInt16BE(size - 2); buffer = buffer.subarray(size); state = 'connecting'; item.requests++;
        remote = net.connect(port, host, () => {
          client.off('data', parse); client.write(Buffer.from([5, 0, 0, 1, 127, 0, 0, 1, 0, 0]));
          if (buffer.length) remote.write(buffer); client.pipe(remote).pipe(client);
        });
        remote.on('error', stop); remote.on('close', stop);
      }
    }
    client.on('data', parse);
  });
  item = await fixture(server); return item;
}
function addIp(item, protocol = 'http', country = 'US', overrides = {}) {
  const row = { id: randomUUID(), host: '127.0.0.1', port: item.port, protocol, country, upstream_user: 'upuser', upstream_pass: 'uppass', created_at: Date.now(), ...overrides };
  db.prepare('INSERT INTO ip_pool(id,host,port,protocol,country,upstream_user,upstream_pass,created_at) VALUES(@id,@host,@port,@protocol,@country,@upstream_user,@upstream_pass,@created_at)').run(row); return row;
}
function proxyGet({ key = username, password = secret, url = `http://127.0.0.1:${target.port}/hello`, method = 'GET', body } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port: gatewayPort, method, path: url, headers: { 'proxy-authorization': `Basic ${Buffer.from(`${key}:${password}`).toString('base64')}`, ...(body ? { 'content-length': Buffer.byteLength(body) } : {}) } }, response => {
      const chunks = []; response.on('data', chunk => chunks.push(chunk)); response.on('end', () => resolve({ status: response.statusCode, body: Buffer.concat(chunks).toString(), headers: response.headers })); response.on('error', reject);
    });
    req.setTimeout(10000, () => req.destroy(new Error('test request timed out'))); req.on('error', reject); req.end(body);
  });
}
function connectTunnel({ key = username, password = secret } = {}) {
  return new Promise((resolve, reject) => {
    const socket = net.connect(gatewayPort, '127.0.0.1'); let data = Buffer.alloc(0);
    socket.setTimeout(10000, () => socket.destroy(new Error('test CONNECT timed out'))); socket.on('error', reject);
    socket.once('connect', () => socket.write(`CONNECT 127.0.0.1:${echo.port} HTTP/1.1\r\nHost: 127.0.0.1:${echo.port}\r\nProxy-Authorization: Basic ${Buffer.from(`${key}:${password}`).toString('base64')}\r\n\r\n`));
    function receive(chunk) { data = Buffer.concat([data, chunk]); const end = data.indexOf('\r\n\r\n'); if (end < 0) return; socket.off('data', receive); socket.pause(); const rest = data.subarray(end + 4); if (rest.length) socket.unshift(rest); resolve({ status: Number(data.toString().split(' ')[1]), socket }); }
    socket.on('data', receive);
  });
}
function echoBytes(socket, value) {
  return new Promise((resolve, reject) => {
    let received = Buffer.alloc(0); const onData = chunk => { received = Buffer.concat([received, chunk]); if (received.length >= Buffer.byteLength(value)) { socket.off('data', onData); resolve(received.toString()); } };
    socket.once('error', reject); socket.on('data', onData); socket.resume(); socket.write(value);
  });
}
before(async () => {
  db.prepare("INSERT INTO users(id,email,password_hash,nickname,created_at) VALUES(?,?,'unused','Gateway Test',?)").run(userId, 'gateway@example.test', Date.now());

  target = await fixture(http.createServer((req, res) => { const chunks = []; req.on('data', chunk => chunks.push(chunk)); req.on('end', () => { res.writeHead(200, { 'content-type': 'text/plain' }); res.end(req.method === 'POST' ? Buffer.concat(chunks) : 'hello-resihub'); }); }));
  echo = await fixture(net.createServer(socket => socket.pipe(socket)));
  upstreamA = await httpUpstream(); upstreamB = await httpUpstream(); socks = await socksUpstream();
  gateway = startGateway({ port: 0 }); await once(gateway, 'listening'); gatewayPort = gateway.address().port;
});
beforeEach(() => {
  db.exec('DELETE FROM static_rentals; DELETE FROM orders; DELETE FROM static_products; DELETE FROM ip_pool; DELETE FROM ledger; DELETE FROM usage_records; DELETE FROM entitlements;');
  db.prepare("UPDATE users SET status='active',balance_cents=100000 WHERE id=?").run(userId); config.allowPrivateTargets=true;
});
function rent(ip) {
  const productId=randomUUID();
  db.prepare("INSERT INTO static_products(id,name,country,protocol,duration_days,price_cents,created_at) VALUES(?,'Gateway static IP',?,?,30,100,?)").run(productId,ip.country,ip.protocol,Date.now());
  const result=rentalsService.purchase.immediate({userId,productId,quantity:1,key:randomUUID()}); const r=result.rentals[0]; secret=r.password;username=r.username;rentalId=r.id;return r;
}

after(async () => {
  stopGateway();
  for (const item of fixtures) { for (const socket of item.sockets) socket.destroy(); await new Promise(resolve => item.server.close(resolve)); }
  db.close(); fs.rmSync(dir, { recursive: true, force: true });
});
test('static HTTP forwards GET and POST without quota or additional balance deductions', async () => {
  rent(addIp(upstreamA)); const balance=db.prepare('SELECT balance_cents FROM users WHERE id=?').get(userId).balance_cents;
  assert.equal(db.prepare('SELECT COUNT(*) n FROM entitlements').get().n,0);
  assert.equal((await proxyGet()).body,'hello-resihub');
  assert.equal((await proxyGet({method:'POST',body:'static-body'})).body,'static-body');
  assert.equal(db.prepare('SELECT balance_cents FROM users WHERE id=?').get(userId).balance_cents,balance);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM usage_records').get().n,0);
});
test('CONNECT works through the assigned authenticated HTTP upstream',async()=>{
  rent(addIp(upstreamA));const result=await connectTunnel();assert.equal(result.status,200);
  assert.equal(await echoBytes(result.socket,'fixed-tunnel-data'),'fixed-tunnel-data');result.socket.destroy();
});
test('static SOCKS5 upstream supports HTTP and CONNECT',async()=>{
  rent(addIp(socks,'socks5'));assert.equal((await proxyGet()).body,'hello-resihub');
  const result=await connectTunnel();assert.equal(result.status,200);assert.equal(await echoBytes(result.socket,'socks-static'),'socks-static');result.socket.destroy();
});
test('each credential remains pinned to its assigned IP and cannot select another country/session',async()=>{
  rent(addIp(upstreamA,'http','US'));addIp(upstreamB,'http','JP');let a=upstreamA.requests,b=upstreamB.requests;
  for(let i=0;i<4;i++)assert.equal((await proxyGet()).status,200);
  assert.equal(upstreamA.requests-a,4);assert.equal(upstreamB.requests-b,0);
  assert.equal((await proxyGet({key:username+'-r-jp-s-example123'})).status,407);
  assert.equal((await proxyGet({password:'wrong-password'})).status,407);
});
test('a failed assigned upstream never falls back to another IP',async()=>{
  const bad=addIp({port:1});rent(bad);addIp(upstreamA);const a=upstreamA.requests;
  assert.equal((await proxyGet()).status,502);assert.equal(upstreamA.requests,a);
  assert.equal(db.prepare('SELECT fail_count FROM ip_pool WHERE id=?').get(bad.id).fail_count,1);
});
test('expired lease and disabled user, rental or upstream reject credentials',async()=>{
  const ip=addIp(upstreamA);rent(ip);
  db.prepare("UPDATE users SET status='disabled' WHERE id=?").run(userId);assert.equal((await proxyGet()).status,407);db.prepare("UPDATE users SET status='active' WHERE id=?").run(userId);
  db.prepare("UPDATE static_rentals SET status='disabled' WHERE id=?").run(rentalId);assert.equal((await proxyGet()).status,407);db.prepare("UPDATE static_rentals SET status='active' WHERE id=?").run(rentalId);
  db.prepare("UPDATE ip_pool SET status='disabled' WHERE id=?").run(ip.id);assert.equal((await proxyGet()).status,407);db.prepare("UPDATE ip_pool SET status='active' WHERE id=?").run(ip.id);
  db.prepare('UPDATE static_rentals SET expires_at=? WHERE id=?').run(Date.now()-1,rentalId);assert.equal((await proxyGet()).status,407);
});
test('disabling a rental interrupts its existing tunnel',async()=>{
  rent(addIp(upstreamA));const result=await connectTunnel();assert.equal(result.status,200);
  db.prepare("UPDATE static_rentals SET status='disabled' WHERE id=?").run(rentalId);
  const closed=once(result.socket,'close');result.socket.resume();result.socket.write('must-not-forward');await closed;
});
test('an idle tunnel is closed when its lease expires',async()=>{
  rent(addIp(upstreamA));const result=await connectTunnel();assert.equal(result.status,200);
  db.prepare('UPDATE static_rentals SET expires_at=? WHERE id=?').run(Date.now()-1,rentalId);
  result.socket.resume();await Promise.race([once(result.socket,'close'),new Promise((_,reject)=>{const timer=setTimeout(()=>reject(new Error('expired idle tunnel remained open')),2000);timer.unref();})]);
});
test('private and mapped IPv6 targets remain blocked by default',async()=>{
  rent(addIp(upstreamA));config.allowPrivateTargets=false;assert.equal((await proxyGet()).status,403);assert.equal((await connectTunnel()).status,403);
  for(const ip of ['127.0.0.1','10.0.0.1','169.254.169.254','172.16.0.1','192.168.0.1','100.64.0.1','::1','fc00::1','fe80::1','::ffff:127.0.0.1','::ffff:7f00:1'])assert.equal(isPublicIp(ip),false,ip);
  assert.equal(isPublicIp('8.8.8.8'),true);
});
function socksConnect({ key = username, password = secret, host = '127.0.0.1', port = echo.port, methods = [2] } = {}) {
  return new Promise((resolve, reject) => {
    const socket = net.connect(gatewayPort, '127.0.0.1'); let buffer = Buffer.alloc(0); let step = 'method';
    socket.setTimeout(10000, () => socket.destroy(new Error('test SOCKS5 timed out'))); socket.on('error', reject);
    const address = net.isIP(host) === 4 ? Buffer.from([1, ...host.split('.').map(Number)]) : Buffer.concat([Buffer.from([3, Buffer.byteLength(host)]), Buffer.from(host)]);
    const portBytes = Buffer.alloc(2); portBytes.writeUInt16BE(port);
    socket.once('connect', () => socket.write(Buffer.from([5, methods.length, ...methods])));
    socket.on('close', () => resolve({ step, closed: true }));
    function receive(chunk) {
      buffer = Buffer.concat([buffer, chunk]);
      if (step === 'method' && buffer.length >= 2) {
        if (buffer[1] !== 2) return resolve({ step, method: buffer[1] });
        buffer = buffer.subarray(2); step = 'auth';
        socket.write(Buffer.concat([Buffer.from([1, Buffer.byteLength(key)]), Buffer.from(key), Buffer.from([Buffer.byteLength(password)]), Buffer.from(password)]));
      }
      if (step === 'auth' && buffer.length >= 2) {
        if (buffer[1] !== 0) return resolve({ step, auth: buffer[1] });
        buffer = buffer.subarray(2); step = 'request'; socket.write(Buffer.concat([Buffer.from([5, 1, 0]), address, portBytes]));
      }
      if (step === 'request' && buffer.length >= 10) {
        socket.off('data', receive); socket.removeAllListeners('close'); socket.pause();
        const rest = buffer.subarray(10); if (rest.length) socket.unshift(rest); resolve({ step, reply: buffer[1], socket });
      }
    }
    socket.on('data', receive);
  });
}
test('SOCKS5 clients tunnel through the same gateway port to HTTP and SOCKS5 upstreams',async()=>{
  rent(addIp(upstreamA));let result=await socksConnect();assert.equal(result.reply,0);
  assert.equal(await echoBytes(result.socket,'socks5-client-http-upstream'),'socks5-client-http-upstream');result.socket.destroy();
  rent(addIp(socks,'socks5'));result=await socksConnect();assert.equal(result.reply,0);
  assert.equal(await echoBytes(result.socket,'socks5-client-socks-upstream'),'socks5-client-socks-upstream');result.socket.destroy();
});
test('SOCKS5 requires lease credentials and enforces target rules',async()=>{
  rent(addIp(upstreamA));
  assert.equal((await socksConnect({methods:[0]})).method,0xff);
  assert.equal((await socksConnect({password:'wrong-password'})).auth,1);
  db.prepare("UPDATE static_rentals SET status='disabled' WHERE id=?").run(rentalId);assert.equal((await socksConnect()).auth,1);
  db.prepare("UPDATE static_rentals SET status='active' WHERE id=?").run(rentalId);
  config.allowPrivateTargets=false;assert.equal((await socksConnect()).reply,2);assert.equal((await socksConnect({host:'localhost'})).reply,2,'domain targets are resolved and checked too');
});
test('disabling a rental interrupts its existing SOCKS5 tunnel',async()=>{
  rent(addIp(upstreamA));const result=await socksConnect();assert.equal(result.reply,0);
  db.prepare("UPDATE static_rentals SET status='disabled' WHERE id=?").run(rentalId);
  const closed=once(result.socket,'close');result.socket.resume();result.socket.write('must-not-forward');await closed;
});
