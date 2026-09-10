const express = require('express');
const browserAutomationController = require('../controllers/browserAutomationController');
const { requireAuth } = require('../middleware/authMiddleware');
const { requirePermission } = require('../middleware/permissionMiddleware');

const router = express.Router();

router.use(requireAuth);
router.get('/', requirePermission('BROWSER_AUTOMATION_READ'), browserAutomationController.listAutomations);
router.get('/:automationCode', requirePermission('BROWSER_AUTOMATION_READ'), browserAutomationController.getAutomation);

module.exports = router;
