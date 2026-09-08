const express = require('express');
const browserTestController = require('../controllers/browserTestController');
const { requireAuth } = require('../middleware/authMiddleware');
const { requirePermission } = require('../middleware/permissionMiddleware');

const router = express.Router();

router.use(requireAuth);

router.get('/runs/:workflowId', requirePermission('BROWSER_TEST_READ'), browserTestController.getRun);
router.get('/', requirePermission('BROWSER_TEST_READ'), browserTestController.listTests);
router.post('/:testCode/run', requirePermission('BROWSER_TEST_RUN'), browserTestController.startTest);
router.get('/:testCode', requirePermission('BROWSER_TEST_READ'), browserTestController.getTest);

module.exports = router;
