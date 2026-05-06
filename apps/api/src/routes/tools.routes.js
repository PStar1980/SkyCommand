const express = require('express');
const toolsController = require('../controllers/toolsController');
const { requireAuth } = require('../middleware/authMiddleware');
const { requirePermission } = require('../middleware/permissionMiddleware');

const router = express.Router();

router.use(requireAuth);
router.use(requirePermission('CORE_VIEW_TOOLS'));

router.get('/', toolsController.listTools);
router.get('/:toolCode', toolsController.getTool);

module.exports = router;
