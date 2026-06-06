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
  '/alert-preferences',
  requirePermission('SKYWEB_ALERT_READ'),
  skywebController.getAlertPreferences,
);
router.patch(
  '/alert-preferences',
  requirePermission('SKYWEB_ALERT_WRITE'),
  skywebController.updateAlertPreferences,
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

router.get(
  '/alert-notifications',
  requirePermission('SKYWEB_ALERT_READ'),
  skywebController.listAlertNotifications,
);
router.post(
  '/alert-notifications/acknowledge-all',
  requirePermission('SKYWEB_ALERT_WRITE'),
  skywebController.acknowledgeAllAlertNotifications,
);
router.patch(
  '/alert-notifications/:notificationId/acknowledge',
  requirePermission('SKYWEB_ALERT_WRITE'),
  skywebController.acknowledgeAlertNotification,
);
router.patch(
  '/alert-notifications/:notificationId/dismiss',
  requirePermission('SKYWEB_ALERT_WRITE'),
  skywebController.dismissAlertNotification,
);

router.get('/alerts', requirePermission('SKYWEB_ALERT_READ'), skywebController.listAlertRules);
router.post('/alerts', requirePermission('SKYWEB_ALERT_WRITE'), skywebController.createAlertRule);
router.post(
  '/alerts/evaluate',
  requirePermission('SKYWEB_ALERT_WRITE'),
  skywebController.evaluateAlertRules,
);
router.get(
  '/alerts/:alertKey/events',
  requirePermission('SKYWEB_ALERT_READ'),
  skywebController.listAlertRuleEvents,
);
router.get(
  '/alerts/:alertKey',
  requirePermission('SKYWEB_ALERT_READ'),
  skywebController.getAlertRule,
);
router.patch(
  '/alerts/:alertKey',
  requirePermission('SKYWEB_ALERT_WRITE'),
  skywebController.updateAlertRule,
);
router.delete(
  '/alerts/:alertKey',
  requirePermission('SKYWEB_ALERT_WRITE'),
  skywebController.removeAlertRule,
);
router.post(
  '/alerts/:alertKey/evaluate',
  requirePermission('SKYWEB_ALERT_WRITE'),
  skywebController.evaluateAlertRule,
);

router.get(
  '/dashboards',
  requireAnyPermission(['SKYWEB_DASHBOARD_READ', 'SKYWEB_PROFILE_READ']),
  skywebController.listDashboards,
);
router.post(
  '/dashboards',
  requireAnyPermission(['SKYWEB_DASHBOARD_WRITE', 'SKYWEB_PROFILE_WRITE']),
  skywebController.createDashboard,
);
router.get(
  '/dashboards/:dashboardKey',
  requireAnyPermission(['SKYWEB_DASHBOARD_READ', 'SKYWEB_PROFILE_READ']),
  skywebController.getDashboard,
);
router.patch(
  '/dashboards/:dashboardKey',
  requireAnyPermission(['SKYWEB_DASHBOARD_WRITE', 'SKYWEB_PROFILE_WRITE']),
  skywebController.updateDashboard,
);
router.delete(
  '/dashboards/:dashboardKey',
  requireAnyPermission(['SKYWEB_DASHBOARD_WRITE', 'SKYWEB_PROFILE_WRITE']),
  skywebController.removeDashboard,
);
router.post(
  '/dashboards/:dashboardKey/items',
  requireAnyPermission(['SKYWEB_DASHBOARD_WRITE', 'SKYWEB_PROFILE_WRITE']),
  skywebController.addDashboardItem,
);
router.patch(
  '/dashboards/:dashboardKey/items/:itemId',
  requireAnyPermission(['SKYWEB_DASHBOARD_WRITE', 'SKYWEB_PROFILE_WRITE']),
  skywebController.updateDashboardItem,
);
router.delete(
  '/dashboards/:dashboardKey/items/:itemId',
  requireAnyPermission(['SKYWEB_DASHBOARD_WRITE', 'SKYWEB_PROFILE_WRITE']),
  skywebController.removeDashboardItem,
);

module.exports = router;
