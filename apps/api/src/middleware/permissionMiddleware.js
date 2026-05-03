const authService = require('../services/authService');

function requirePermission(permissionCode) {
  return async function permissionGuard(req, res, next) {
    try {
      if (!req.user) {
        return res.status(401).json({
          ok: false,
          error: 'Authentication required.',
        });
      }

      const hasCachedPermission = (req.permissions || []).some(
        (permission) => permission.permissionCode === permissionCode,
      );

      const allowed =
        hasCachedPermission || (await authService.hasPermission(req.user.userId, permissionCode));

      if (!allowed) {
        const context = authService.getRequestContext(req);

        await authService.recordAuditEvent({
          userId: req.user.userId,
          eventType: 'AUTHORIZATION_DENIED',
          resourceType: 'permission',
          resourceId: permissionCode,
          action: 'require_permission',
          success: false,
          message: `Permission denied: ${permissionCode}`,
          metadata: { path: req.originalUrl, method: req.method },
          ipAddress: context.ipAddress,
          userAgent: context.userAgent,
        });

        return res.status(403).json({
          ok: false,
          error: 'Permission denied.',
          permissionCode,
        });
      }

      return next();
    } catch (error) {
      return next(error);
    }
  };
}

module.exports = {
  requirePermission,
};
