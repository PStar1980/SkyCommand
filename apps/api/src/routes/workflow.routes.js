const express = require('express');
const workflowController = require('../controllers/workflowController');
const { requireAuth } = require('../middleware/authMiddleware');
const { requireAnyPermission } = require('../middleware/permissionMiddleware');

const router = express.Router();

router.use(requireAuth);


router.get(
  '/worker-health',
  requireAnyPermission(['WORKFLOW_READ', 'TEMPORAL_WORKFLOW_READ', 'WORKER_SCHEDULE_READ']),
  workflowController.getWorkerHealth,
);

router.get(
  '/definitions',
  requireAnyPermission(['WORKFLOW_READ', 'TEMPORAL_WORKFLOW_READ', 'WORKER_SCHEDULE_READ']),
  workflowController.listDefinitions,
);

router.get(
  '/builder/catalog',
  requireAnyPermission(['WORKFLOW_CREATE', 'WORKFLOW_CHANGE', 'WORKFLOW_READ', 'TEMPORAL_WORKFLOW_READ']),
  workflowController.getBuilderCatalog,
);

router.post(
  '/definitions',
  requireAnyPermission(['WORKFLOW_CREATE']),
  workflowController.createDefinition,
);


router.get(
  '/approvals',
  requireAnyPermission(['WORKFLOW_APPROVAL_READ', 'WORKFLOW_READ', 'TEMPORAL_WORKFLOW_READ']),
  workflowController.listApprovals,
);

router.post(
  '/approvals/:approvalRequestId/decision',
  requireAnyPermission(['WORKFLOW_APPROVAL_DECIDE']),
  workflowController.decideApproval,
);

router.post(
  '/approvals/:approvalRequestId/approve',
  requireAnyPermission(['WORKFLOW_APPROVAL_DECIDE']),
  workflowController.approveApproval,
);

router.post(
  '/approvals/:approvalRequestId/reject',
  requireAnyPermission(['WORKFLOW_APPROVAL_DECIDE']),
  workflowController.rejectApproval,
);

router.get(
  '/runs',
  requireAnyPermission(['WORKFLOW_READ', 'TEMPORAL_WORKFLOW_READ', 'WORKER_SCHEDULE_READ']),
  workflowController.listRuns,
);

router.get(
  '/runs/active',
  requireAnyPermission(['WORKFLOW_READ', 'TEMPORAL_WORKFLOW_READ', 'WORKER_SCHEDULE_READ']),
  workflowController.listActiveRuns,
);

router.get(
  '/runs/:workflowRunRecordId/telemetry',
  requireAnyPermission(['WORKFLOW_READ', 'TEMPORAL_WORKFLOW_READ', 'WORKER_SCHEDULE_READ']),
  workflowController.getRunTelemetry,
);

router.get(
  '/runs/:workflowRunRecordId',
  requireAnyPermission(['WORKFLOW_READ', 'TEMPORAL_WORKFLOW_READ', 'WORKER_SCHEDULE_READ']),
  workflowController.getRun,
);


router.post(
  '/runs/:workflowRunRecordId/cancel',
  requireAnyPermission(['WORKFLOW_RUN']),
  workflowController.cancelRun,
);

router.post(
  '/runs/:workflowRunRecordId/terminate',
  requireAnyPermission(['WORKFLOW_RUN']),
  workflowController.terminateRun,
);

router.post(
  '/runs/:workflowRunRecordId/retry',
  requireAnyPermission(['WORKFLOW_RUN']),
  workflowController.retryRun,
);

router.post(
  '/runs/:workflowRunRecordId/nodes/:nodeKey/retry',
  requireAnyPermission(['WORKFLOW_RUN']),
  workflowController.retryNode,
);


router.get(
  '/definitions/:workflowCode/manage',
  requireAnyPermission(['WORKFLOW_CHANGE']),
  workflowController.getManagedDefinition,
);

router.patch(
  '/definitions/:workflowCode',
  requireAnyPermission(['WORKFLOW_CHANGE']),
  workflowController.updateDefinition,
);

router.post(
  '/definitions/:workflowCode/archive',
  requireAnyPermission(['WORKFLOW_CHANGE']),
  workflowController.archiveDefinition,
);

router.post(
  '/definitions/:workflowCode/clone',
  requireAnyPermission(['WORKFLOW_CREATE']),
  workflowController.cloneDefinition,
);

router.post(
  '/definitions/:workflowCode/versions',
  requireAnyPermission(['WORKFLOW_CHANGE']),
  workflowController.createVersion,
);


router.post(
  '/definitions/:workflowCode/drafts',
  requireAnyPermission(['WORKFLOW_CHANGE']),
  workflowController.createDraftVersion,
);

router.put(
  '/definitions/:workflowCode/versions/:workflowVersionId/graph',
  requireAnyPermission(['WORKFLOW_CHANGE']),
  workflowController.saveDraftGraph,
);

router.post(
  '/definitions/:workflowCode/versions/:workflowVersionId/publish',
  requireAnyPermission(['WORKFLOW_CHANGE']),
  workflowController.publishDraftVersion,
);

router.delete(
  '/definitions/:workflowCode/versions/:workflowVersionId',
  requireAnyPermission(['WORKFLOW_CHANGE']),
  workflowController.discardDraftVersion,
);


router.put(
  '/definitions/:workflowCode/graph',
  requireAnyPermission(['WORKFLOW_CHANGE']),
  workflowController.replaceDefinitionGraph,
);

router.delete(
  '/definitions/:workflowCode',
  requireAnyPermission(['WORKFLOW_CHANGE']),
  workflowController.deleteDefinition,
);

router.get(
  '/definitions/:workflowCode',
  requireAnyPermission(['WORKFLOW_READ', 'TEMPORAL_WORKFLOW_READ', 'WORKER_SCHEDULE_READ']),
  workflowController.getDefinition,
);

router.post(
  '/definitions/:workflowCode/start',
  requireAnyPermission(['WORKFLOW_RUN']),
  workflowController.startWorkflow,
);

module.exports = router;
