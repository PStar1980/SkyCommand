const express = require('express');
const ingestionController = require('../controllers/ingestionController');
const { requireAuth } = require('../middleware/authMiddleware');
const { requirePermission } = require('../middleware/permissionMiddleware');

const router = express.Router();

router.use(requireAuth);
router.use(requirePermission('INGESTION_VIEW_STATUS'));

router.get('/status', ingestionController.getStatus);

router.get('/sources', ingestionController.listSources);
router.get('/sources/:source', ingestionController.getSource);

router.get('/recent', ingestionController.getRecentExecutions);

router.get('/indicators', ingestionController.listIndicatorStatuses);
router.get('/indicators/:indicatorCode/status', ingestionController.getIndicatorStatus);

module.exports = router;
