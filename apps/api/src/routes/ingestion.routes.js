const express = require('express');
const ingestionController = require('../controllers/ingestionController');
const { requireAuth } = require('../middleware/authMiddleware');
const { requirePermission } = require('../middleware/permissionMiddleware');

const router = express.Router();

router.use(requireAuth);
router.use(requirePermission('INGESTION_VIEW_STATUS'));

router.get('/catalogue/domains', ingestionController.listCatalogueDomains);
router.get('/catalogue/assets', ingestionController.listCatalogueAssets);
router.get(
  '/catalogue/assets/:domainCode/:assetCode',
  ingestionController.getCatalogueAsset,
);
router.get('/catalogue/metrics', ingestionController.listCatalogueMetrics);

router.get('/status', ingestionController.getStatus);
router.get('/tools', ingestionController.listTools);

router.get('/sources', ingestionController.listSources);
router.get('/sources/:source', ingestionController.getSource);

router.get('/recent', ingestionController.getRecentExecutions);

router.get('/indicators', ingestionController.listIndicatorStatuses);
router.get('/indicators/:indicatorCode/status', ingestionController.getIndicatorStatus);

module.exports = router;
