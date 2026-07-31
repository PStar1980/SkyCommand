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
router.get('/catalogue/freshness', ingestionController.listCatalogueFreshness);
router.get(
  '/catalogue/freshness/:domainCode/:assetCode',
  ingestionController.getCatalogueFreshness,
);

router.post(
  '/catalogue/admin/freshness/refresh',
  requirePermission('DATA_CATALOGUE_WRITE'),
  ingestionController.refreshCatalogueFreshness,
);

router.get(
  '/catalogue/admin/options',
  requirePermission('DATA_CATALOGUE_WRITE'),
  ingestionController.getCatalogueAdminOptions,
);
router.put(
  '/catalogue/admin/domains/:domainCode',
  requirePermission('DATA_CATALOGUE_WRITE'),
  ingestionController.saveCatalogueDomain,
);
router.put(
  '/catalogue/admin/sources/:domainCode/:sourceCode',
  requirePermission('DATA_CATALOGUE_WRITE'),
  ingestionController.saveCatalogueSource,
);
router.put(
  '/catalogue/admin/assets/:domainCode/:assetCode',
  requirePermission('DATA_CATALOGUE_WRITE'),
  ingestionController.saveCatalogueAsset,
);
router.put(
  '/catalogue/admin/metrics/:domainCode/:metricCode',
  requirePermission('DATA_CATALOGUE_WRITE'),
  ingestionController.saveCatalogueMetric,
);

router.get('/status', ingestionController.getStatus);
router.get('/tools', ingestionController.listTools);

router.get('/sources', ingestionController.listSources);
router.get('/sources/:source', ingestionController.getSource);

router.get('/recent', ingestionController.getRecentExecutions);

router.get('/indicators', ingestionController.listIndicatorStatuses);
router.get('/indicators/:indicatorCode/status', ingestionController.getIndicatorStatus);

module.exports = router;
