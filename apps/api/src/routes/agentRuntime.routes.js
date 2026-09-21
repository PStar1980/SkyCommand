const express = require('express');
const agentController = require('../controllers/agentController');
const { requireAuth } = require('../middleware/authMiddleware');
const { requirePermission } = require('../middleware/permissionMiddleware');

const router = express.Router();
router.use(requireAuth);

router.get('/', requirePermission('AGENT_RUNTIME_READ'), agentController.listRuntimes);
router.post('/', requirePermission('AGENT_RUNTIME_MANAGE'), agentController.createRuntime);
router.post('/:runtimeId/installations', requirePermission('AGENT_RUNTIME_MANAGE'), agentController.createInstallation);
router.post('/installations/:installationId/accounts', requirePermission('AGENT_RUNTIME_MANAGE'), agentController.createAccount);
router.post('/capability-profiles', requirePermission('AGENT_RUNTIME_MANAGE'), agentController.createCapabilityProfile);

module.exports = router;
