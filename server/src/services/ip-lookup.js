const net = require('net');
const { isPublicIp } = require('../gateway/network');
// 访客 IP 归属地：中国大陆及港澳台用离线库 ip2region（中文、运营商更准确），其余地区用 ipinfo.io，ipapi.co 备用。
// 结果按 IP 缓存 6 小时；查询失败时只返回 IP。
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

// 省级行政区（去掉省/市/自治区等后缀）→ 省会经纬度，用于地球上的访客位置
const PROVINCES = { 北京: [116.4, 39.9], 天津: [117.2, 39.13], 上海: [121.47, 31.23], 重庆: [106.55, 29.56], 河北: [114.51, 38.04], 山西: [112.55, 37.87], 内蒙古: [111.75, 40.84], 辽宁: [123.43, 41.8], 吉林: [125.32, 43.82], 黑龙江: [126.53, 45.8], 江苏: [118.8, 32.06], 浙江: [120.16, 30.27], 安徽: [117.23, 31.82], 福建: [119.3, 26.08], 江西: [115.86, 28.68], 山东: [117.12, 36.65], 河南: [113.62, 34.75], 湖北: [114.31, 30.59], 湖南: [112.94, 28.23], 广东: [113.26, 23.13], 广西: [108.37, 22.82], 海南: [110.2, 20.04], 四川: [104.07, 30.57], 贵州: [106.63, 26.65], 云南: [102.83, 24.88], 西藏: [91.13, 29.65], 陕西: [108.94, 34.34], 甘肃: [103.83, 36.06], 青海: [101.78, 36.62], 宁夏: [106.23, 38.49], 新疆: [87.62, 43.83], 香港: [114.17, 22.32], 澳门: [113.55, 22.2], 台湾: [121.56, 25.04] };
const SPECIAL = { 香港: 'HK', 澳门: 'MO', 台湾: 'TW' };
const CARRIERS = { 电信: '中国电信', 联通: '中国联通', 移动: '中国移动', 铁通: '中国铁通', 广电: '中国广电', 教育网: '中国教育网' };
const shortName = name => String(name || '').replace(/(壮族自治区|回族自治区|维吾尔自治区|特别行政区|自治区|省|市)$/, '');
const clean = value => (!value || value === '0' ? '' : String(value));
let v4, v6;
function mainland(ip) {
  try {
    const IP2Region = require('ip2region').default;
    const db = net.isIP(ip) === 6 ? (v6 = v6 || new IP2Region()) : (v4 = v4 || new IP2Region({ disableIpv6: true }));
    const hit = db.search(ip);
    if (!hit || hit.country !== '中国') return null;
    const province = clean(hit.province), key = shortName(province), city = clean(hit.city), point = PROVINCES[key];
    return { country: SPECIAL[key] || 'CN', region: SPECIAL[key] || shortName(city) === key ? '' : province, city: SPECIAL[key] ? '' : city, isp: CARRIERS[clean(hit.isp)] || clean(hit.isp), lat: point ? point[1] : null, lon: point ? point[0] : null };
  } catch { return null; }
}

async function lookup(raw) {
  const ip = normalize(raw);
  if (!isPublicIp(ip)) return { ip, local: true };
  const hit = cache.get(ip);
  if (hit && hit.at > Date.now() - TTL) return hit.value;
  let value = { ip };
  const cn = mainland(ip);
  if (cn) value = { ip, ...cn };
  else for (const provider of providers) {
    try { const geo = await provider(ip); value = { ip, ...geo, lat: Number.isFinite(geo.lat) ? geo.lat : null, lon: Number.isFinite(geo.lon) ? geo.lon : null }; break; } catch {}
  }
  if (value.country) { if (cache.size > 5000) cache.delete(cache.keys().next().value); cache.set(ip, { at: Date.now(), value }); }
  return value;
}
module.exports = { lookup };
