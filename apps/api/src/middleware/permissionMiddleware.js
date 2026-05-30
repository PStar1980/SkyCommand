const authService = require('../services/authService');

function normalizePermissionCodes(permissionCodes) {
  return (Array.isArray(permissionCodes) ? permissionCodes : [permissionCodes])
    .map((permissionCode) => String(permissionCode || '').trim())
    .filter(Boolean);
}

async function userHasPermission(req, permissionCode) {
  const hasCachedPermission = (req.permissions || []).some(
    (permission) => permission.permissionCode === permissionCode,
  );

  return (
    hasCachedPermission ||
    (await authService.hasPermission(req.user.userId, permissionCode, req.session?.appCode))
  );
}

async function recordPermissionDenied(req, permissionCodes) {
  const context = authService.getRequestContext(req);
  const resourceId = permissionCodes.join('|');

  await authService.recordAuditEvent({
    appCode: req.session?.appCode,
    userId: req.user.userId,
    eventType: 'AUTHORIZATION_DENIED',
    resourceType: 'permission',
    resourceId,
    action: 'require_permission',
    success: false,
    message: `Permission denied: ${resourceId}`,
    metadata: { path: req.originalUrl, method: req.method },
    ipAddress: context.ipAddress,
    userAgent: context.userAgent,
  });
}

function requirePermission(permissionCode) {
  return async function permissionGuard(req, res, next) {
    try {
      if (!req.user) {
        return res.status(401).json({
          ok: false,
          error: 'Authentication required.',
        });
      }

      const allowed = await userHasPermission(req, permissionCode);

      if (!allowed) {
        await recordPermissionDenied(req, [permissionCode]);

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

function requireAnyPermission(permissionCodes) {
  const normalizedPermissionCodes = normalizePermissionCodes(permissionCodes);

  return async function anyPermissionGuard(req, res, next) {
    try {
      if (!req.user) {
        return res.status(401).json({
          ok: false,
          error: 'Authentication required.',
        });
      }

      for (const permissionCode of normalizedPermissionCodes) {
        const allowed = await userHasPermission(req, permissionCode);

        if (allowed) {
          return next();
        }
      }

      await recordPermissionDenied(req, normalizedPermissionCodes);

      return res.status(403).json({
        ok: false,
        error: 'Permission denied.',
        permissionCodes: normalizedPermissionCodes,
      });
    } catch (error) {
      return next(error);
    }
  };
}

module.exports = {
  requireAnyPermission,
  requirePermission,
};
