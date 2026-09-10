const express = require('express');
const browserAutomationController = require('../controllers/browserAutomationController');
const { requireAuth } = require('../middleware/authMiddleware');
const { requirePermission } = require('../middleware/permissionMiddleware');

const router = express.Router();

router.use(requireAuth);
router.get('/runs', requirePermission('BROWSER_AUTOMATION_READ'), browserAutomationController.listRuns);
router.get('/runs/:workflowId/artifacts/:artifactId', requirePermission('BROWSER_AUTOMATION_READ'), browserAutomationController.getArtifact);
router.get('/runs/:workflowId', requirePermission('BROWSER_AUTOMATION_READ'), browserAutomationController.getRun);
router.get('/', requirePermission('BROWSER_AUTOMATION_READ'), browserAutomationController.listAutomations);
router.post('/:automationCode/run', requirePermission('BROWSER_AUTOMATION_RUN'), browserAutomationController.startAutomation);
router.get('/:automationCode', requirePermission('BROWSER_AUTOMATION_READ'), browserAutomationController.getAutomation);

module.exports = router;
