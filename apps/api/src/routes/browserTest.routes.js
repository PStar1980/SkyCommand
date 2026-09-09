const express = require('express');
const browserTestController = require('../controllers/browserTestController');
const { requireAuth } = require('../middleware/authMiddleware');
const { requirePermission } = require('../middleware/permissionMiddleware');

const router = express.Router();

// A report-view ticket is created only through an authenticated BROWSER_TEST_READ request.
// The scoped, short-lived ticket then lets the Playwright report load its own relative
// data/* attachments in a normal browser tab without exposing the user's session token.
router.get('/report-view/:ticket/', browserTestController.getReportViewIndex);
router.get('/report-view/:ticket/data/:fileName', browserTestController.getReportViewData);

router.use(requireAuth);

router.get('/runs', requirePermission('BROWSER_TEST_READ'), browserTestController.listRuns);
router.post('/runs/:workflowId/artifacts/:artifactId/report-view', requirePermission('BROWSER_TEST_READ'), browserTestController.createReportView);
router.get('/runs/:workflowId/artifacts/:artifactId', requirePermission('BROWSER_TEST_READ'), browserTestController.getArtifact);
router.get('/runs/:workflowId', requirePermission('BROWSER_TEST_READ'), browserTestController.getRun);
router.get('/', requirePermission('BROWSER_TEST_READ'), browserTestController.listTests);
router.post('/:testCode/run', requirePermission('BROWSER_TEST_RUN'), browserTestController.startTest);
router.get('/:testCode', requirePermission('BROWSER_TEST_READ'), browserTestController.getTest);

module.exports = router;
