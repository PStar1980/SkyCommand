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
