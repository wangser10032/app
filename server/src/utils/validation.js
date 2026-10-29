const { z } = require('zod');
const email = z.string().trim().toLowerCase().email('邮箱格式不正确').max(254);
// bcrypt truncates at 72 bytes; reject rather than silently accepting a suffix.
const password = z.string().min(10, '密码至少 10 位').max(72, '密码过长').refine(v => Buffer.byteLength(v) <= 72, '密码最多 72 字节');
const countryValue = z.string().trim().toUpperCase().regex(/^$|^[A-Z]{2}$/, '国家代码应为两位字母');
const country = countryValue.default('');
const status = z.enum(['active', 'disabled']);
module.exports = { z, email, password, country, countryValue, status };
