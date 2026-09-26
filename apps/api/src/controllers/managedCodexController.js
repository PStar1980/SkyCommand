'use strict';

const managedCodex = require('../services/managedCodexBootstrapService');

function handler(callback, statusCode = 200) {
  return async (request, response, next) => {
    try {
      const result = await callback(request);
      return response.status(statusCode).json(result);
    } catch (error) {
      if (Number.isInteger(error?.statusCode)) {
        return response.status(error.statusCode).json({
          ok: false,
          error: error.statusCode >= 500 ? 'Managed Codex operation is unavailable.' : error.message,
          code: error.code || 'MANAGED_CODEX_OPERATION_FAILED',
          details: error.details || undefined,
        });
      }
      return next(error);
    }
  };
}

module.exports = {
  getStatus: handler((request) => managedCodex.getManagedCodex(request)),
  startEnrollment: handler((request) => managedCodex.startEnrollment(request), 202),
  reconcileEnrollment: handler((request) => managedCodex.reconcileEnrollment(request.params.enrollmentId, request)),
  refreshAccount: handler((request) => managedCodex.refreshManagedAccount(request)),
  logout: handler((request) => managedCodex.logoutManagedAccount(request)),
};
