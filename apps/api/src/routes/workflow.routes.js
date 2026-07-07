const express = require('express');
const workflowController = require('../controllers/workflowController');
const { requireAuth } = require('../middleware/authMiddleware');
const { requireAnyPermission } = require('../middleware/permissionMiddleware');

const router = express.Router();

router.use(requireAuth);

router.get(
  '/definitions',
  requireAnyPermission(['WORKFLOW_READ', 'TEMPORAL_WORKFLOW_READ', 'WORKER_SCHEDULE_READ']),
  workflowController.listDefinitions,
);

router.get(
  '/builder/catalog',
  requireAnyPermission(['WORKFLOW_WRITE', 'WORKFLOW_READ', 'TEMPORAL_WORKFLOW_READ']),
  workflowController.getBuilderCatalog,
);

router.post(
  '/definitions',
  requireAnyPermission(['WORKFLOW_WRITE']),
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
  '/runs/:workflowRunRecordId',
  requireAnyPermission(['WORKFLOW_READ', 'TEMPORAL_WORKFLOW_READ', 'WORKER_SCHEDULE_READ']),
  workflowController.getRun,
);


router.post(
  '/runs/:workflowRunRecordId/cancel',
  requireAnyPermission(['WORKFLOW_CANCEL', 'TEMPORAL_WORKFLOW_CANCEL', 'WORKER_SCHEDULE_RUN']),
  workflowController.cancelRun,
);

router.post(
  '/runs/:workflowRunRecordId/terminate',
  requireAnyPermission(['WORKFLOW_CANCEL', 'TEMPORAL_WORKFLOW_TERMINATE', 'WORKER_ADMIN']),
  workflowController.terminateRun,
);

router.post(
  '/runs/:workflowRunRecordId/retry',
  requireAnyPermission(['WORKFLOW_START', 'TEMPORAL_WORKFLOW_START', 'WORKER_SCHEDULE_RUN']),
  workflowController.retryRun,
);


router.get(
  '/definitions/:workflowCode/manage',
  requireAnyPermission(['WORKFLOW_WRITE', 'WORKFLOW_READ']),
  workflowController.getManagedDefinition,
);

router.patch(
  '/definitions/:workflowCode',
  requireAnyPermission(['WORKFLOW_WRITE']),
  workflowController.updateDefinition,
);

router.post(
  '/definitions/:workflowCode/archive',
  requireAnyPermission(['WORKFLOW_WRITE']),
  workflowController.archiveDefinition,
);

router.post(
  '/definitions/:workflowCode/clone',
  requireAnyPermission(['WORKFLOW_WRITE']),
  workflowController.cloneDefinition,
);

router.post(
  '/definitions/:workflowCode/versions',
  requireAnyPermission(['WORKFLOW_WRITE']),
  workflowController.createVersion,
);


router.put(
  '/definitions/:workflowCode/graph',
  requireAnyPermission(['WORKFLOW_WRITE']),
  workflowController.replaceDefinitionGraph,
);

router.delete(
  '/definitions/:workflowCode',
  requireAnyPermission(['WORKFLOW_WRITE']),
  workflowController.deleteDefinition,
);

router.get(
  '/definitions/:workflowCode',
  requireAnyPermission(['WORKFLOW_READ', 'TEMPORAL_WORKFLOW_READ', 'WORKER_SCHEDULE_READ']),
  workflowController.getDefinition,
);

router.post(
  '/definitions/:workflowCode/start',
  requireAnyPermission(['WORKFLOW_START', 'TEMPORAL_WORKFLOW_START', 'WORKER_SCHEDULE_RUN']),
  workflowController.startWorkflow,
);

module.exports = router;
