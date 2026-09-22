const express = require('express');
const agentInteractionController = require('../controllers/agentInteractionController');
const { requireAuth } = require('../middleware/authMiddleware');
const { requirePermission } = require('../middleware/permissionMiddleware');

const router = express.Router();
router.use(requireAuth);
router.use(requirePermission('AGENT_RUN'));

router.get('/', agentInteractionController.list);
router.get('/:interactionId', agentInteractionController.detail);
router.post('/:interactionId/decision', agentInteractionController.decide);

module.exports = router;
