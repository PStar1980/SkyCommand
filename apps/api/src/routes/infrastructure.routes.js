const express = require('express');
const infrastructureController = require('../controllers/infrastructureController');
const { requireAuth } = require('../middleware/authMiddleware');
const { requirePermission } = require('../middleware/permissionMiddleware');

const router = express.Router();

router.use(requireAuth);

router.get(
  '/providers/docker/overview',
  requirePermission('INFRASTRUCTURE_DOCKER_READ'),
  infrastructureController.getDockerOverview,
);

router.get(
  '/providers/docker/operations',
  requirePermission('INFRASTRUCTURE_DOCKER_READ'),
  infrastructureController.listDockerOperations,
);

router.post(
  '/providers/docker/projects/:projectName/actions',
  requirePermission('INFRASTRUCTURE_DOCKER_CONTROL'),
  infrastructureController.controlDockerComposeProject,
);

module.exports = router;
