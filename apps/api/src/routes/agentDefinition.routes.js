const express = require('express');
const agentController = require('../controllers/agentController');
const { requireAuth } = require('../middleware/authMiddleware');
const { requirePermission } = require('../middleware/permissionMiddleware');

const router = express.Router();
router.use(requireAuth);

router.get('/', requirePermission('AGENT_READ'), agentController.listAgents);
router.post('/', requirePermission('AGENT_MANAGE'), agentController.createAgent);
router.get('/:definitionId', requirePermission('AGENT_READ'), agentController.getAgent);
router.patch('/:definitionId', requirePermission('AGENT_MANAGE'), agentController.updateAgent);
router.post('/:definitionId/versions', requirePermission('AGENT_MANAGE'), agentController.createAgentVersion);

module.exports = router;
