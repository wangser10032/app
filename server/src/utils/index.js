const crypto = require('crypto');

// 业务单号：前缀 + yyyyMMddHHmmss + 4 位随机
function genNo(prefix) {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  const ts = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
  return `${prefix}${ts}${crypto.randomInt(1000, 10000)}`;
}

function paginate(req, defSize = 20) {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const pageSize = Math.min(100, Math.max(1, parseInt(req.query.page_size, 10) || defSize));
  return { page, pageSize, offset: (page - 1) * pageSize };
}

const paged = (items, total, page, pageSize) => ({ items, total, page, page_size: pageSize });

const round2 = (n) => Math.round(n * 100) / 100;

module.exports = { genNo, paginate, paged, round2 };
