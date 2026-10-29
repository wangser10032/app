// Local development only: an HTTP upstream proxy, never exposed on 0.0.0.0.
const http = require('http');
const net = require('net');
const portArg = process.argv.indexOf('--port');
const port = portArg >= 0 ? Number(process.argv[portArg + 1]) : 18080;
const server = http.createServer((req, res) => {
  let url; try { url = new URL(req.url); } catch { res.writeHead(400).end(); return; }
  if (url.protocol !== 'http:') { res.writeHead(400).end(); return; }
  const headers = { ...req.headers }; delete headers['proxy-authorization']; delete headers['proxy-connection'];
  const outgoing = http.request(url, { method: req.method, headers }, upstream => { res.writeHead(upstream.statusCode, upstream.headers); upstream.pipe(res); });
  outgoing.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end(); }); req.pipe(outgoing);
});
server.on('connect', (req, client, head) => {
  const match = /^(\[[^\]]+\]|[^:]+):(\d+)$/.exec(req.url); if (!match) return client.destroy();
  const socket = net.connect(Number(match[2]), match[1].replace(/^\[|\]$/g, ''), () => { client.write('HTTP/1.1 200 Connection Established\r\n\r\n'); if (head.length) socket.write(head); client.pipe(socket).pipe(client); });
  const end = () => { client.destroy(); socket.destroy(); }; socket.on('error', end); client.on('error', end); client.on('close', end); socket.on('close', end);
});
server.listen(port, '127.0.0.1', () => console.log(`Development upstream http://127.0.0.1:${port}`));
