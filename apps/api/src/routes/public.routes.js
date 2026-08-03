const express = require('express');
const publicMacroRoutes = require('./publicMacro.routes');

const router = express.Router();

router.get('/_health', (req, res) => {
  res.json({
    ok: true,
    service: 'SkyCommand Public API',
  });
});

router.use('/macro', publicMacroRoutes);

module.exports = router;
