const express = require('express');
const agentRunController = require('../controllers/agentRunController');
const { requireAuth } = require('../middleware/authMiddleware');
const { requirePermission } = require('../middleware/permissionMiddleware');

const router = express.Router();
router.use(requireAuth);
router.post('/:scopeId/stop', requirePermission('AGENT_ROOT_STOP'), agentRunController.stopScope);

module.exports = router;
