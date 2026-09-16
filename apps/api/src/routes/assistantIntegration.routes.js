const express = require('express');
const assistantIntegrationController = require('../controllers/assistantIntegrationController');
const { requireAssistantIntegration } = require('../middleware/assistantIntegrationMiddleware');

const router = express.Router();

router.use(requireAssistantIntegration);
router.get('/capabilities', assistantIntegrationController.getCapabilities);
router.get('/openapi.json', assistantIntegrationController.getOpenApi);
router.get('/database-upgrade/plan', assistantIntegrationController.getDatabaseUpgradePlan);
router.post(
  '/database-upgrade/apply-requests',
  assistantIntegrationController.createDatabaseUpgradeApplyRequest,
);
router.get(
  '/browser-automation-runs/:workflowId/artifacts/:artifactId',
  assistantIntegrationController.getArtifact,
);
router.get('/browser-automation-runs/:workflowId', assistantIntegrationController.getRun);
router.get('/browser-automations', assistantIntegrationController.listAutomations);
router.get('/browser-automations/:automationCode', assistantIntegrationController.getAutomation);
router.post(
  '/browser-automations/:automationCode/runs',
  assistantIntegrationController.startAutomation,
);
router.post(
  '/development-promotion/runs',
  assistantIntegrationController.startDevelopmentPromotion,
);

module.exports = router;
