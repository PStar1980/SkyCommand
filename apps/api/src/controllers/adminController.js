const adminReadService = require('../services/adminReadService');

function sendPagedResponse(res, payload) {
  res.json({
    ok: true,
    total: payload.total,
    limit: payload.limit,
    offset: payload.offset,
    items: payload.items,
  });
}

async function listAuditEvents(req, res, next) {
  try {
    const payload = await adminReadService.listAuditEvents(req.query || {});
    sendPagedResponse(res, payload);
  } catch (error) {
    next(error);
  }
}

async function listLoginEvents(req, res, next) {
  try {
    const payload = await adminReadService.listLoginEvents(req.query || {});
    sendPagedResponse(res, payload);
  } catch (error) {
    next(error);
  }
}

async function listScriptExecutions(req, res, next) {
  try {
    const payload = await adminReadService.listScriptExecutions(req.query || {});
    sendPagedResponse(res, payload);
  } catch (error) {
    next(error);
  }
}

async function listActiveSessions(req, res, next) {
  try {
    const payload = await adminReadService.listActiveSessions(req.query || {});
    sendPagedResponse(res, payload);
  } catch (error) {
    next(error);
  }
}

async function listUsers(req, res, next) {
  try {
    const payload = await adminReadService.listUsers(req.query || {});
    sendPagedResponse(res, payload);
  } catch (error) {
    next(error);
  }
}

async function listUserRoles(req, res, next) {
  try {
    const payload = await adminReadService.listUserRoles(req.query || {});
    sendPagedResponse(res, payload);
  } catch (error) {
    next(error);
  }
}

async function listRoles(req, res, next) {
  try {
    const payload = await adminReadService.listRoles(req.query || {});
    sendPagedResponse(res, payload);
  } catch (error) {
    next(error);
  }
}

async function listPermissions(req, res, next) {
  try {
    const payload = await adminReadService.listPermissions(req.query || {});
    sendPagedResponse(res, payload);
  } catch (error) {
    next(error);
  }
}

async function listRolePermissions(req, res, next) {
  try {
    const payload = await adminReadService.listRolePermissions(req.query || {});
    sendPagedResponse(res, payload);
  } catch (error) {
    next(error);
  }
}

module.exports = {
  listAuditEvents,
  listLoginEvents,
  listScriptExecutions,
  listActiveSessions,
  listUsers,
  listUserRoles,
  listRoles,
  listPermissions,
  listRolePermissions,
};
