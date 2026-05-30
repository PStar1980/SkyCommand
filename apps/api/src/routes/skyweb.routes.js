const express = require('express');
const skywebController = require('../controllers/skywebController');
const { requireAuth } = require('../middleware/authMiddleware');
const { requireAnyPermission, requirePermission } = require('../middleware/permissionMiddleware');

const router = express.Router();

router.use(requireAuth);

router.get('/profile', requirePermission('SKYWEB_PROFILE_READ'), skywebController.getProfile);
router.patch('/profile', requirePermission('SKYWEB_PROFILE_WRITE'), skywebController.updateProfile);

router.get(
  '/preferences',
  requireAnyPermission(['SKYWEB_PREFERENCES_READ', 'SKYWEB_PROFILE_READ']),
  skywebController.getPreferences,
);
router.patch(
  '/preferences',
  requireAnyPermission(['SKYWEB_PREFERENCES_WRITE', 'SKYWEB_PROFILE_WRITE']),
  skywebController.updatePreferences,
);

router.get(
  '/saved-views',
  requireAnyPermission(['SKYWEB_DASHBOARD_READ', 'SKYWEB_PROFILE_READ']),
  skywebController.listSavedViews,
);
router.post(
  '/saved-views',
  requireAnyPermission(['SKYWEB_DASHBOARD_WRITE', 'SKYWEB_PROFILE_WRITE']),
  skywebController.saveView,
);
router.patch(
  '/saved-views/:viewKey',
  requireAnyPermission(['SKYWEB_DASHBOARD_WRITE', 'SKYWEB_PROFILE_WRITE']),
  skywebController.updateSavedView,
);
router.delete(
  '/saved-views/:viewKey',
  requireAnyPermission(['SKYWEB_DASHBOARD_WRITE', 'SKYWEB_PROFILE_WRITE']),
  skywebController.removeSavedView,
);

module.exports = router;
