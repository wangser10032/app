const router = require('express').Router();
const config = require('../config');
const { docsMarkdown } = require('../services/settings');
// 接入说明：后台编写的 Markdown（留空用默认模板），{{gateway}} 替换为用户实际使用的代理地址
router.get('/', (req, res) => res.json({ markdown: docsMarkdown().split('{{gateway}}').join(`${config.publicGatewayHost}:${config.publicGatewayPort || config.gatewayPort}`) }));
module.exports = router;
