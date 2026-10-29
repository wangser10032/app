const router = require('express').Router();
const db = require('../db');
router.all('*', (req, res) => res.status(410).json({ error: { code: 'LEGACY_PRODUCT_RETIRED', message: '流量套餐已停售，请使用静态住宅 IP 产品' } }));
module.exports = router;
