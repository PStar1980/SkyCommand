const express = require('express');
const controller = require('../controllers/agentSessionController');
const { requireAuth } = require('../middleware/authMiddleware');
const { requirePermission } = require('../middleware/permissionMiddleware');

const router = express.Router();
router.use(requireAuth, requirePermission('AGENT_RUN'));
router.get('/', controller.list);
router.get('/:sessionId', controller.detail);
router.post('/:sessionId/runs', controller.continue);
router.post('/:sessionId/archive', controller.archive);
module.exports = router;
