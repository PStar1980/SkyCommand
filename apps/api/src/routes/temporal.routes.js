const express = require('express');
const temporalController = require('../controllers/temporalController');
const { requireAuth } = require('../middleware/authMiddleware');
const { requireAnyPermission } = require('../middleware/permissionMiddleware');

const router = express.Router();

router.use(requireAuth);

router.get(
  '/health',
  requireAnyPermission(['TEMPORAL_WORKFLOW_READ', 'WORKER_SCHEDULE_READ']),
  temporalController.getHealth,
);

router.get(
  '/workflow-definitions',
  requireAnyPermission(['TEMPORAL_WORKFLOW_READ', 'WORKER_SCHEDULE_READ']),
  temporalController.listWorkflowDefinitions,
);

router.get(
  '/workflows',
  requireAnyPermission(['TEMPORAL_WORKFLOW_READ', 'WORKER_SCHEDULE_READ']),
  temporalController.listWorkflows,
);

router.get(
  '/workflows/:workflowId',
  requireAnyPermission(['TEMPORAL_WORKFLOW_READ', 'WORKER_SCHEDULE_READ']),
  temporalController.getWorkflow,
);

router.post(
  '/workflows/fred-ingestion/start',
  requireAnyPermission(['TEMPORAL_WORKFLOW_START', 'WORKER_SCHEDULE_RUN', 'INGESTION_RUN_FRED']),
  temporalController.startFredIngestionWorkflow,
);

router.post(
  '/workflow-definitions/:workflowCode/start',
  requireAnyPermission(['TEMPORAL_WORKFLOW_START', 'WORKER_SCHEDULE_RUN', 'INGESTION_RUN_FRED']),
  temporalController.startWorkflowFromDefinition,
);

router.post(
  '/workflows/:workflowId/cancel',
  requireAnyPermission(['TEMPORAL_WORKFLOW_CANCEL', 'WORKER_SCHEDULE_RUN']),
  temporalController.cancelWorkflow,
);

router.post(
  '/workflows/:workflowId/terminate',
  requireAnyPermission(['TEMPORAL_WORKFLOW_TERMINATE', 'WORKER_ADMIN']),
  temporalController.terminateWorkflow,
);

module.exports = router;
