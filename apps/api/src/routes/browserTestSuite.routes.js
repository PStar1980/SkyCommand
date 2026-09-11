const express = require('express');
const controller = require('../controllers/browserTestSuiteController');
const { requireAuth } = require('../middleware/authMiddleware');
const { requirePermission } = require('../middleware/permissionMiddleware');

const router = express.Router();
router.use(requireAuth);
router.get('/runs', requirePermission('BROWSER_TEST_SUITE_READ'), controller.listRuns);
router.get('/runs/:workflowId', requirePermission('BROWSER_TEST_SUITE_READ'), controller.getRun);
router.get('/', requirePermission('BROWSER_TEST_SUITE_READ'), controller.listSuites);
router.post('/:suiteCode/run', requirePermission('BROWSER_TEST_SUITE_RUN'), controller.startSuite);
router.get('/:suiteCode', requirePermission('BROWSER_TEST_SUITE_READ'), controller.getSuite);
module.exports = router;
