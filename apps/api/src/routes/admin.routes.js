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

router.get('/sessions', requirePermission('ADMIN_USER_READ'), adminController.listSessions);
router.post(
  '/sessions/:sessionId/revoke',
  requirePermission('ADMIN_USER_WRITE'),
  adminController.revokeSession,
);

router.get('/settings/auth', requirePermission('ADMIN_USER_READ'), adminController.getAuthSettings);
router.get('/settings/core', requirePermission('ADMIN_ROLE_READ'), adminController.getCoreSettings);

router.get('/applications', requirePermission('ADMIN_USER_READ'), adminController.listApplications);

router.get(
  '/repositories/profiles',
  requirePermission('ADMIN_REPOSITORY_READ'),
  adminController.listConfigProfiles,
);
router.get(
  '/repositories',
  requirePermission('ADMIN_REPOSITORY_READ'),
  adminController.listRepositories,
);
router.post(
  '/repositories',
  requirePermission('ADMIN_REPOSITORY_WRITE'),
  adminController.createRepository,
);
router.get(
  '/repositories/:repoId',
  requirePermission('ADMIN_REPOSITORY_READ'),
  adminController.getRepository,
);
router.patch(
  '/repositories/:repoId',
  requirePermission('ADMIN_REPOSITORY_WRITE'),
  adminController.updateRepository,
);
router.patch(
  '/repositories/:repoId/status',
  requirePermission('ADMIN_REPOSITORY_WRITE'),
  adminController.updateRepositoryStatus,
);
router.put(
  '/repositories/:repoId/paths',
  requirePermission('ADMIN_REPOSITORY_WRITE'),
  adminController.updateRepositoryPaths,
);
router.delete(
  '/repositories/:repoId',
  requirePermission('ADMIN_REPOSITORY_WRITE'),
  adminController.deleteRepository,
);

router.get('/user-roles', requirePermission('ADMIN_USER_READ'), adminController.listUserRoles);
router.get(
  '/role-permissions',
  requirePermission('ADMIN_PERMISSION_READ'),
  adminController.listRolePermissions,
);

router.get('/users', requirePermission('ADMIN_USER_READ'), adminController.listUsers);
router.post('/users', requirePermission('ADMIN_USER_WRITE'), adminController.createUser);
router.get('/users/:userId', requirePermission('ADMIN_USER_READ'), adminController.getUser);
router.patch('/users/:userId', requirePermission('ADMIN_USER_WRITE'), adminController.updateUser);
router.patch(
  '/users/:userId/status',
  requirePermission('ADMIN_USER_WRITE'),
  adminController.updateUserStatus,
);
router.post(
  '/users/:userId/reset-password',
  requirePermission('ADMIN_USER_WRITE'),
  adminController.resetUserPassword,
);
router.get(
  '/users/:userId/roles',
  requirePermission('ADMIN_USER_READ'),
  adminController.getUserRoles,
);
router.put(
  '/users/:userId/roles',
  requirePermission('ADMIN_ROLE_WRITE'),
  adminController.updateUserRoles,
);

router.get(
  '/users/:userId/applications',
  requirePermission('ADMIN_USER_READ'),
  adminController.getUserApplications,
);
router.put(
  '/users/:userId/applications',
  requirePermission('ADMIN_USER_WRITE'),
  adminController.updateUserApplications,
);
router.get(
  '/users/:userId/sessions',
  requirePermission('ADMIN_USER_READ'),
  adminController.getUserSessions,
);
router.post(
  '/users/:userId/revoke-sessions',
  requirePermission('ADMIN_USER_WRITE'),
  adminController.revokeUserSessions,
);

router.get('/roles', requirePermission('ADMIN_ROLE_READ'), adminController.listRoles);
router.post('/roles', requirePermission('ADMIN_ROLE_WRITE'), adminController.createRole);
router.get('/roles/:roleId', requirePermission('ADMIN_ROLE_READ'), adminController.getRole);
router.patch('/roles/:roleId', requirePermission('ADMIN_ROLE_WRITE'), adminController.updateRole);
router.patch(
  '/roles/:roleId/status',
  requirePermission('ADMIN_ROLE_WRITE'),
  adminController.updateRoleStatus,
);
router.get(
  '/roles/:roleId/permissions',
  requirePermission('ADMIN_PERMISSION_READ'),
  adminController.getRolePermissions,
);
router.put(
  '/roles/:roleId/permissions',
  requirePermission('ADMIN_PERMISSION_WRITE'),
  adminController.updateRolePermissions,
);
router.get(
  '/roles/:roleId/users',
  requirePermission('ADMIN_ROLE_READ'),
  adminController.getRoleUsers,
);

router.get(
  '/permissions',
  requirePermission('ADMIN_PERMISSION_READ'),
  adminController.listPermissions,
);
router.post(
  '/permissions',
  requirePermission('ADMIN_PERMISSION_WRITE'),
  adminController.createPermission,
);
router.get(
  '/permissions/:permissionId',
  requirePermission('ADMIN_PERMISSION_READ'),
  adminController.getPermission,
);
router.patch(
  '/permissions/:permissionId',
  requirePermission('ADMIN_PERMISSION_WRITE'),
  adminController.updatePermission,
);
router.patch(
  '/permissions/:permissionId/status',
  requirePermission('ADMIN_PERMISSION_WRITE'),
  adminController.updatePermissionStatus,
);
router.get(
  '/permissions/:permissionId/roles',
  requirePermission('ADMIN_PERMISSION_READ'),
  adminController.getPermissionRoles,
);

module.exports = router;
