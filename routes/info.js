'use strict';

const express = require('express');
const router = express.Router();

router.get('/tokushou', function(req, res) {
    res.render('info/tokushou', { title: '特定商取引法に関する表示' });
});

router.get('/shikinkessai', function(req, res) {
    res.render('info/shikinkessai', { title: '資金決済法に関する表示' });
});

module.exports = router;
