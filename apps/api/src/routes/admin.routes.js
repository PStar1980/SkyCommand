const express = require('express');
const adminController = require('../controllers/adminController');
const { requireAuth } = require('../middleware/authMiddleware');
const { requirePermission } = require('../middleware/permissionMiddleware');

const router = express.Router();

router.use(requireAuth);

router.get('/audit-events', requirePermission('AUDIT_READ'), adminController.listAuditEvents);
router.get('/login-events', requirePermission('AUDIT_READ'), adminController.listLoginEvents);
router.get(
  '/script-executions',
  requirePermission('SCRIPT_EXECUTION_READ'),
  adminController.listScriptExecutions,
);
router.get(
  '/active-sessions',
  requirePermission('ADMIN_USER_READ'),
  adminController.listActiveSessions,
);
router.get('/users', requirePermission('ADMIN_USER_READ'), adminController.listUsers);
router.get('/user-roles', requirePermission('ADMIN_USER_READ'), adminController.listUserRoles);
router.get('/roles', requirePermission('ADMIN_ROLE_READ'), adminController.listRoles);
router.get(
  '/permissions',
  requirePermission('ADMIN_PERMISSION_READ'),
  adminController.listPermissions,
);
router.get(
  '/role-permissions',
  requirePermission('ADMIN_PERMISSION_READ'),
  adminController.listRolePermissions,
);

module.exports = router;
