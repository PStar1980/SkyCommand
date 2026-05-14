const express = require('express');
const publicMacroController = require('../controllers/publicMacroController');

const router = express.Router();

router.get('/summary', publicMacroController.getSummary);

router.get('/views', publicMacroController.listViews);
router.get('/views/:viewKey/columns', publicMacroController.getViewColumns);
router.get('/views/:viewKey/latest', publicMacroController.getLatestViewRow);
router.get('/views/:viewKey', publicMacroController.listViewRows);

router.get('/indicators', publicMacroController.listIndicators);
router.get('/indicators/:indicatorCode/series', publicMacroController.listIndicatorSeries);
router.get('/indicators/:indicatorCode', publicMacroController.getIndicator);

module.exports = router;
