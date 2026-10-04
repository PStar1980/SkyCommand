const express = require('express');
const agentRunController = require('../controllers/agentRunController');
const { requireAuth } = require('../middleware/authMiddleware');
const { requireAnyPermission, requirePermission } = require('../middleware/permissionMiddleware');

const router = express.Router();
router.use(requireAuth);

router.post('/', requirePermission('AGENT_RUN'), agentRunController.admit);
router.get('/options', requirePermission('AGENT_RUN'), agentRunController.options);
router.get('/', requirePermission('AGENT_RUN'), agentRunController.list);
router.get('/:runId', requirePermission('AGENT_RUN'), agentRunController.detail);
router.get('/:runId/events', requirePermission('AGENT_RUN'), agentRunController.events);
router.get('/:runId/result', requirePermission('AGENT_RUN'), agentRunController.result);
router.post('/:runId/cancel', requireAnyPermission(['AGENT_RUN_CANCEL_OWN', 'AGENT_RUN_CANCEL_PROJECT']), agentRunController.cancel);
router.post('/:runId/recover', requirePermission('AGENT_RUN'), agentRunController.recover);
router.get('/:runId/authority-residue', requirePermission('AGENT_RUN'), agentRunController.authorityResidue);
router.post('/:runId/reconcile-authority-residue', requirePermission('AGENT_RUN'), agentRunController.reconcileAuthorityResidue);
router.get('/:runId/continuation-result-revalidation', requirePermission('AGENT_RUN'), agentRunController.continuationResultRevalidation);
router.post('/:runId/revalidate-continuation-result', requirePermission('AGENT_RUN'), agentRunController.revalidateContinuationResult);
router.post('/:runId/release-runtime-hold', requirePermission('AGENT_RUN'), agentRunController.releaseRuntimeHold);

module.exports = router;
