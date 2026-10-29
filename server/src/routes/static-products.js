const router = require('express').Router();
const { route } = require('../utils/errors');
router.get('/', route((req, res) => res.json({ items: require('../services/static-rentals').getProducts() })));
module.exports = router;
