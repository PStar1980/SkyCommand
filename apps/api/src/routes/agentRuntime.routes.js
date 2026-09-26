const express = require('express');
const agentController = require('../controllers/agentController');
const managedCodexController = require('../controllers/managedCodexController');
const { requireAuth } = require('../middleware/authMiddleware');
const { requirePermission } = require('../middleware/permissionMiddleware');

const router = express.Router();
router.use(requireAuth);

router.get('/', requirePermission('AGENT_RUNTIME_READ'), agentController.listRuntimes);
router.get('/managed-codex', requirePermission('AGENT_RUNTIME_READ'), managedCodexController.getStatus);
router.post('/managed-codex/enrollments', requirePermission('AGENT_RUNTIME_MANAGE'), managedCodexController.startEnrollment);
router.post('/managed-codex/enrollments/:enrollmentId/reconcile', requirePermission('AGENT_RUNTIME_MANAGE'), managedCodexController.reconcileEnrollment);
router.post('/managed-codex/account/refresh', requirePermission('AGENT_RUNTIME_MANAGE'), managedCodexController.refreshAccount);
router.post('/managed-codex/account/logout', requirePermission('AGENT_RUNTIME_MANAGE'), managedCodexController.logout);
router.post('/', requirePermission('AGENT_RUNTIME_MANAGE'), agentController.createRuntime);
router.post('/:runtimeId/installations', requirePermission('AGENT_RUNTIME_MANAGE'), agentController.createInstallation);
router.post('/installations/:installationId/accounts', requirePermission('AGENT_RUNTIME_MANAGE'), agentController.createAccount);
router.post('/capability-profiles', requirePermission('AGENT_RUNTIME_MANAGE'), agentController.createCapabilityProfile);

module.exports = router;
