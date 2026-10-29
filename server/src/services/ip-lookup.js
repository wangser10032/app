const { isPublicIp } = require('../gateway/network');
// 访客 IP 归属查询：ipinfo.io 为主、ipapi.co 备用；按 IP 缓存 6 小时，失败时只返回 IP。
const TTL = 6 * 3600000; const cache = new Map();
const normalize = ip => String(ip || '').replace(/^::ffff:(?=\d+\.)/i, '');
const isp = org => String(org || '').replace(/^AS\d+\s+/i, '').slice(0, 120);
async function getJson(url) {
  const res = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': 'ResiHub/1.0' }, signal: AbortSignal.timeout(3500) });
  if (!res.ok) throw new Error(`lookup_${res.status}`); return res.json();
}
const providers = [
  async ip => { const d = await getJson(`https://ipinfo.io/${encodeURIComponent(ip)}/json`); const [lat, lon] = String(d.loc || '').split(',').map(Number); return { country: d.country || '', region: d.region || '', city: d.city || '', isp: isp(d.org), lat, lon }; },
  async ip => { const d = await getJson(`https://ipapi.co/${encodeURIComponent(ip)}/json/`); if (d.error) throw new Error('lookup_failed'); return { country: d.country_code || '', region: d.region || '', city: d.city || '', isp: isp(d.org), lat: d.latitude, lon: d.longitude }; },
];
async function lookup(raw) {
  const ip = normalize(raw);
  if (!isPublicIp(ip)) return { ip, local: true };
  const hit = cache.get(ip);
  if (hit && hit.at > Date.now() - TTL) return hit.value;
  let value = { ip };
  for (const provider of providers) {
    try { const geo = await provider(ip); value = { ip, ...geo, lat: Number.isFinite(geo.lat) ? geo.lat : null, lon: Number.isFinite(geo.lon) ? geo.lon : null }; break; } catch {}
  }
  if (value.country) { if (cache.size > 5000) cache.delete(cache.keys().next().value); cache.set(ip, { at: Date.now(), value }); }
  return value;
}
module.exports = { lookup };
