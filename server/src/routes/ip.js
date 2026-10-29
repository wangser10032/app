const router = require('express').Router();
const rateLimit = require('express-rate-limit');
const { route } = require('../utils/errors');
const { lookup } = require('../services/ip-lookup');
// 首页「当前 IP 检测」：返回访问者自己的 IP 与归属地。经 Nginx 时依赖 TRUST_PROXY 取得真实来源。
router.get('/', rateLimit({ windowMs: 60000, limit: 30, standardHeaders: true, legacyHeaders: false }), route(async (req, res) => res.json(await lookup(req.ip))));
module.exports = router;
