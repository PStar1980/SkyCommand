const express = require('express');
const macroController = require('../controllers/macroController');
const { requireAuth } = require('../middleware/authMiddleware');
const { requirePermission } = require('../middleware/permissionMiddleware');

const router = express.Router();

router.use(requireAuth);
router.use(requirePermission('MACRO_VIEW_READ'));

router.get('/summary', macroController.getSummary);

router.get('/views', macroController.listViews);
router.get('/views/:viewKey/columns', macroController.getViewColumns);
router.get('/views/:viewKey/latest', macroController.getLatestViewRow);
router.get('/views/:viewKey', macroController.listViewRows);

router.get('/indicators', macroController.listIndicators);
router.get('/indicators/:indicatorCode/series', macroController.listIndicatorSeries);
router.get('/indicators/:indicatorCode', macroController.getIndicator);

module.exports = router;
