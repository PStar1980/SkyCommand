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
  '/runs',
  requireAnyPermission(['WORKFLOW_READ', 'TEMPORAL_WORKFLOW_READ', 'WORKER_SCHEDULE_READ']),
  workflowController.listRuns,
);

router.get(
  '/runs/:workflowRunRecordId',
  requireAnyPermission(['WORKFLOW_READ', 'TEMPORAL_WORKFLOW_READ', 'WORKER_SCHEDULE_READ']),
  workflowController.getRun,
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
