const net = require('net');
const dns = require('dns').promises;
const config = require('../config');
function isPublicIp(ip) {
  ip = ip.toLowerCase().replace(/^\[|\]$/g, '');
  if (ip.startsWith('::ffff:')) {
    const tail = ip.slice(7);
    if (tail.includes('.')) return isPublicIp(tail);
    const parts = tail.split(':'); if (parts.length === 2) { const n = parseInt(parts[0], 16) * 65536 + parseInt(parts[1], 16); return isPublicIp([n >>> 24, n >>> 16 & 255, n >>> 8 & 255, n & 255].join('.')); }
    return false;
  }
  if (net.isIP(ip) === 4) {
    const [a, b, c] = ip.split('.').map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224 || a === 169 && b === 254 || a === 172 && b >= 16 && b <= 31 || a === 192 && (b === 168 || b === 0 && (c === 0 || c === 2) || b === 88 && c === 99) || a === 100 && b >= 64 && b <= 127 || a === 198 && (b === 18 || b === 19 || b === 51 && c === 100) || a === 203 && b === 0 && c === 113);
  }
  // Only globally routed IPv6 unicast (2000::/3), excluding documentation and 6to4.
  if (net.isIP(ip) === 6) return /^[23]/.test(ip) && !ip.startsWith('2001:db8:') && !ip.startsWith('2002:') && !ip.startsWith('2001:0:');
  return false;
}
async function resolveTarget(host, port) {
  host = host.replace(/^\[|\]$/g, '');
  if (!Number.isInteger(port) || port < 1 || port > 65535 || !host || host.length > 253) throw new Error('invalid_target');
  const records = net.isIP(host) ? [{ address: host }] : await dns.lookup(host, { all: true, verbatim: true });
  if (!records.length) throw new Error('target_not_found');
  const allowPrivate = config.allowPrivateTargets || process.env.GATEWAY_ALLOW_PRIVATE_TARGETS === 'true';
  if (!allowPrivate && records.some(row => !isPublicIp(row.address))) throw new Error('target_forbidden');
  return { host, ip: records[0].address, port };
}
function dial(host, port) {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host, port });
    const failed = err => { socket.destroy(); reject(err); };
    socket.setTimeout(10000, () => failed(new Error('upstream_timeout')));
    socket.once('error', failed);
    socket.once('connect', () => { socket.removeListener('error', failed); socket.setTimeout(0); socket.on('error', () => {}); resolve(socket); });
  });
}
function reader(socket) {
  let pending = Buffer.alloc(0); let ended; let waiter;
  const data = chunk => { pending = Buffer.concat([pending, chunk]); if (pending.length > 65536) finish(new Error('upstream_handshake_too_large')); else flush(); };
  const finish = err => { ended = err; if (waiter) { const task = waiter; waiter = null; task.reject(err); } };
  const flush = () => {
    if (!waiter) return;
    const count = typeof waiter.need === 'function' ? waiter.need(pending) : (pending.length >= waiter.need ? waiter.need : 0);
    if (!count) return;
    const task = waiter; waiter = null; const value = pending.subarray(0, count); pending = pending.subarray(count); task.resolve(value);
  };
  const onError = err => finish(err); const onClose = () => finish(new Error('upstream_closed'));
  socket.on('data', data); socket.on('error', onError); socket.on('close', onClose);
  return {
    read(need) { if (ended) return Promise.reject(ended); return new Promise((resolve, reject) => { waiter = { need, resolve, reject }; flush(); }); },
    release() { socket.pause(); socket.off('data', data); socket.off('error', onError); socket.off('close', onClose); if (pending.length) socket.unshift(pending); },
  };
}
async function tunnel(upstream, target) {
  const socket = await dial(upstream.host, upstream.port);
  const read = reader(socket); const timer = setTimeout(() => socket.destroy(new Error('upstream_timeout')), 10000);
  try {
    if (upstream.protocol === 'http') {
      const address = `${net.isIP(target.ip) === 6 ? `[${target.ip}]` : target.ip}:${target.port}`;
      const auth = upstream.upstream_user ? `Proxy-Authorization: Basic ${Buffer.from(`${upstream.upstream_user}:${upstream.upstream_pass}`).toString('base64')}\r\n` : '';
      socket.write(`CONNECT ${address} HTTP/1.1\r\nHost: ${address}\r\n${auth}Connection: keep-alive\r\n\r\n`);
      const head = await read.read(buffer => { const end = buffer.indexOf('\r\n\r\n'); return end < 0 ? 0 : end + 4; });
      if (!/^HTTP\/1\.[01] 200\b/.test(head.toString('latin1'))) throw new Error('upstream_connect_rejected');
    } else {
      const auth = Boolean(upstream.upstream_user); socket.write(Buffer.from(auth ? [5, 2, 0, 2] : [5, 1, 0]));
      const greeting = await read.read(2); if (greeting[0] !== 5 || ![0, 2].includes(greeting[1])) throw new Error('socks_method_rejected');
      if (greeting[1] === 2) {
        const user = Buffer.from(upstream.upstream_user); const pass = Buffer.from(upstream.upstream_pass);
        if (!user.length || user.length > 255 || pass.length > 255) throw new Error('socks_credentials_invalid');
        socket.write(Buffer.concat([Buffer.from([1, user.length]), user, Buffer.from([pass.length]), pass]));
        const reply = await read.read(2); if (reply[0] !== 1 || reply[1] !== 0) throw new Error('socks_auth_rejected');
      }
      // Use the already-validated numeric address to avoid upstream DNS rebinding.
      let destination;
      if (net.isIP(target.ip) === 4) destination = Buffer.from([1, ...target.ip.split('.').map(Number)]);
      else { const name = Buffer.from(target.ip); destination = Buffer.concat([Buffer.from([3, name.length]), name]); }
      socket.write(Buffer.concat([Buffer.from([5, 1, 0]), destination, Buffer.from([target.port >>> 8, target.port & 255])]));
      const reply = await read.read(4); if (reply[0] !== 5 || reply[1] !== 0) throw new Error('socks_connect_rejected');
      if (reply[3] === 1) await read.read(6);
      else if (reply[3] === 4) await read.read(18);
      else if (reply[3] === 3) { const length = await read.read(1); await read.read(length[0] + 2); }
      else throw new Error('socks_bad_reply');
    }
    read.release(); return socket;
  } catch (error) { socket.destroy(); throw error; }
  finally { clearTimeout(timer); }
}
module.exports = { isPublicIp, resolveTarget, dial, tunnel };
