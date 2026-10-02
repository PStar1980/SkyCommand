const express = require('express');
const assistantIntegrationController = require('../controllers/assistantIntegrationController');
const { requireAssistantIntegration } = require('../middleware/assistantIntegrationMiddleware');

const router = express.Router();

router.use(requireAssistantIntegration);
router.get('/capabilities', assistantIntegrationController.getCapabilities);
router.get('/openapi.json', assistantIntegrationController.getOpenApi);
router.get('/managed-codex', assistantIntegrationController.getManagedCodexStatus);
router.get('/managed-codex/diagnostics', assistantIntegrationController.getManagedCodexDiagnostics);
router.post('/managed-codex/enrollments', assistantIntegrationController.startManagedCodexEnrollment);
router.post('/managed-codex/enrollments/:enrollmentId/reconcile', assistantIntegrationController.reconcileManagedCodexEnrollment);
router.post('/managed-codex/account/refresh', assistantIntegrationController.refreshManagedCodexAccount);
router.post('/managed-codex/account/logout', assistantIntegrationController.logoutManagedCodexAccount);
router.post('/managed-codex/runtime-lifecycle', assistantIntegrationController.startManagedCodexLifecycle);
router.get('/managed-codex/runtime-lifecycle/:operationId', assistantIntegrationController.getManagedCodexLifecycle);
router.post('/workflow-runs', assistantIntegrationController.startWorkflowExecution);
router.get(
  '/workflow-runs/:workflowRunRecordId',
  assistantIntegrationController.getWorkflowExecutionRun,
);
router.post('/orchestrator-refresh/runs', assistantIntegrationController.startOrchestratorRefresh);
router.get(
  '/orchestrator-refresh/runs/:operationId',
  assistantIntegrationController.getOrchestratorRefresh,
);
router.post('/runtime-refresh/runs', assistantIntegrationController.startDevRuntimeRefresh);
router.get(
  '/runtime-refresh/runs/:operationId',
  assistantIntegrationController.getDevRuntimeRefresh,
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
