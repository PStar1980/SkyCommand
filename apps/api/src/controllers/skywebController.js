const skywebDashboardsService = require('../services/skywebDashboardsService');
const skywebPreferencesService = require('../services/skywebPreferencesService');
const skywebProfileService = require('../services/skywebProfileService');
const skywebAlertsService = require('../services/skywebAlertsService');
const skywebSavedViewsService = require('../services/skywebSavedViewsService');

function assertSkyWebSession(req, res) {
  if (req.session?.appCode !== 'SKYWEB') {
    res.status(403).json({
      ok: false,
      error: 'SkyWeb session required.',
    });
    return false;
  }

  return true;
}

function sendServiceError(res, error) {
  if (!error.statusCode) {
    return false;
  }

  res.status(error.statusCode).json({
    ok: false,
    error: error.message,
    details: error.details || undefined,
  });

  return true;
}

async function getProfile(req, res, next) {
  try {
    if (!assertSkyWebSession(req, res)) {
      return;
    }

    const profile = await skywebProfileService.getProfile(req.user.userId);

    res.json({
      ok: true,
      profile,
    });
  } catch (error) {
    next(error);
  }
}

async function updateProfile(req, res, next) {
  try {
    if (!assertSkyWebSession(req, res)) {
      return;
    }

    const profile = await skywebProfileService.updateProfile(req.user.userId, req.body || {});

    res.json({
      ok: true,
      profile,
    });
  } catch (error) {
    next(error);
  }
}

async function getPreferences(req, res, next) {
  try {
    if (!assertSkyWebSession(req, res)) {
      return;
    }

    const preferenceRow = await skywebPreferencesService.getPreferences(req.user.userId);

    res.json({
      ok: true,
      preferenceRow,
      preferences: preferenceRow?.preferences || skywebPreferencesService.DEFAULT_PREFERENCES,
    });
  } catch (error) {
    next(error);
  }
}

async function updatePreferences(req, res, next) {
  try {
    if (!assertSkyWebSession(req, res)) {
      return;
    }

    const preferenceRow = await skywebPreferencesService.updatePreferences(
      req.user.userId,
      req.body || {},
    );

    res.json({
      ok: true,
      preferenceRow,
      preferences: preferenceRow?.preferences || skywebPreferencesService.DEFAULT_PREFERENCES,
    });
  } catch (error) {
    if (sendServiceError(res, error)) {
      return;
    }

    next(error);
  }
}

async function listSavedViews(req, res, next) {
  try {
    if (!assertSkyWebSession(req, res)) {
      return;
    }

    const items = await skywebSavedViewsService.listSavedViews(req.user.userId);

    res.json({
      ok: true,
      total: items.length,
      items,
    });
  } catch (error) {
    if (sendServiceError(res, error)) {
      return;
    }

    next(error);
  }
}

async function saveView(req, res, next) {
  try {
    if (!assertSkyWebSession(req, res)) {
      return;
    }

    const item = await skywebSavedViewsService.saveView(req.user.userId, req.body || {});

    res.json({
      ok: true,
      item,
    });
  } catch (error) {
    if (sendServiceError(res, error)) {
      return;
    }

    next(error);
  }
}

async function updateSavedView(req, res, next) {
  try {
    if (!assertSkyWebSession(req, res)) {
      return;
    }

    const item = await skywebSavedViewsService.updateSavedView(
      req.user.userId,
      req.params.viewKey,
      req.body || {},
    );

    res.json({
      ok: true,
      item,
    });
  } catch (error) {
    if (sendServiceError(res, error)) {
      return;
    }

    next(error);
  }
}

async function removeSavedView(req, res, next) {
  try {
    if (!assertSkyWebSession(req, res)) {
      return;
    }

    const result = await skywebSavedViewsService.removeSavedView(
      req.user.userId,
      req.params.viewKey,
    );

    res.json({
      ok: true,
      ...result,
    });
  } catch (error) {
    if (sendServiceError(res, error)) {
      return;
    }

    next(error);
  }
}

async function listAlertRules(req, res, next) {
  try {
    if (!assertSkyWebSession(req, res)) {
      return;
    }

    const items = await skywebAlertsService.listAlertRules(req.user.userId, req.query || {});

    res.json({
      ok: true,
      total: items.length,
      items,
    });
  } catch (error) {
    if (sendServiceError(res, error)) {
      return;
    }

    next(error);
  }
}

async function createAlertRule(req, res, next) {
  try {
    if (!assertSkyWebSession(req, res)) {
      return;
    }

    const item = await skywebAlertsService.createAlertRule(req.user.userId, req.body || {});

    res.json({
      ok: true,
      item,
    });
  } catch (error) {
    if (sendServiceError(res, error)) {
      return;
    }

    next(error);
  }
}

async function getAlertRule(req, res, next) {
  try {
    if (!assertSkyWebSession(req, res)) {
      return;
    }

    const item = await skywebAlertsService.getAlertRule(req.user.userId, req.params.alertKey);

    if (!item) {
      res.status(404).json({
        ok: false,
        error: 'Alert rule not found.',
      });
      return;
    }

    res.json({
      ok: true,
      item,
    });
  } catch (error) {
    if (sendServiceError(res, error)) {
      return;
    }

    next(error);
  }
}

async function listAlertRuleEvents(req, res, next) {
  try {
    if (!assertSkyWebSession(req, res)) {
      return;
    }

    const items = await skywebAlertsService.listAlertEvents(
      req.user.userId,
      req.params.alertKey,
      req.query || {},
    );

    res.json({
      ok: true,
      total: items.length,
      items,
    });
  } catch (error) {
    if (sendServiceError(res, error)) {
      return;
    }

    next(error);
  }
}

async function updateAlertRule(req, res, next) {
  try {
    if (!assertSkyWebSession(req, res)) {
      return;
    }

    const item = await skywebAlertsService.updateAlertRule(
      req.user.userId,
      req.params.alertKey,
      req.body || {},
    );

    res.json({
      ok: true,
      item,
    });
  } catch (error) {
    if (sendServiceError(res, error)) {
      return;
    }

    next(error);
  }
}

async function removeAlertRule(req, res, next) {
  try {
    if (!assertSkyWebSession(req, res)) {
      return;
    }

    const result = await skywebAlertsService.removeAlertRule(req.user.userId, req.params.alertKey);

    res.json({
      ok: true,
      ...result,
    });
  } catch (error) {
    if (sendServiceError(res, error)) {
      return;
    }

    next(error);
  }
}

async function evaluateAlertRule(req, res, next) {
  try {
    if (!assertSkyWebSession(req, res)) {
      return;
    }

    const result = await skywebAlertsService.evaluateAlertRule(
      req.user.userId,
      req.params.alertKey,
    );

    res.json({
      ok: true,
      ...result,
    });
  } catch (error) {
    if (sendServiceError(res, error)) {
      return;
    }

    next(error);
  }
}

async function evaluateAlertRules(req, res, next) {
  try {
    if (!assertSkyWebSession(req, res)) {
      return;
    }

    const results = await skywebAlertsService.evaluateAlertRules(req.user.userId, req.body || {});

    res.json({
      ok: true,
      total: results.length,
      items: results,
    });
  } catch (error) {
    if (sendServiceError(res, error)) {
      return;
    }

    next(error);
  }
}

async function listDashboards(req, res, next) {
  try {
    if (!assertSkyWebSession(req, res)) {
      return;
    }

    const items = await skywebDashboardsService.listDashboards(req.user.userId);

    res.json({
      ok: true,
      total: items.length,
      items,
    });
  } catch (error) {
    if (sendServiceError(res, error)) {
      return;
    }

    next(error);
  }
}

async function createDashboard(req, res, next) {
  try {
    if (!assertSkyWebSession(req, res)) {
      return;
    }

    const item = await skywebDashboardsService.createDashboard(req.user.userId, req.body || {});

    res.json({
      ok: true,
      item,
    });
  } catch (error) {
    if (sendServiceError(res, error)) {
      return;
    }

    next(error);
  }
}

async function getDashboard(req, res, next) {
  try {
    if (!assertSkyWebSession(req, res)) {
      return;
    }

    const item = await skywebDashboardsService.getDashboard(
      req.user.userId,
      req.params.dashboardKey,
    );

    if (!item) {
      res.status(404).json({
        ok: false,
        error: 'Dashboard not found.',
      });
      return;
    }

    res.json({
      ok: true,
      item,
    });
  } catch (error) {
    if (sendServiceError(res, error)) {
      return;
    }

    next(error);
  }
}

async function updateDashboard(req, res, next) {
  try {
    if (!assertSkyWebSession(req, res)) {
      return;
    }

    const item = await skywebDashboardsService.updateDashboard(
      req.user.userId,
      req.params.dashboardKey,
      req.body || {},
    );

    res.json({
      ok: true,
      item,
    });
  } catch (error) {
    if (sendServiceError(res, error)) {
      return;
    }

    next(error);
  }
}

async function removeDashboard(req, res, next) {
  try {
    if (!assertSkyWebSession(req, res)) {
      return;
    }

    const result = await skywebDashboardsService.removeDashboard(
      req.user.userId,
      req.params.dashboardKey,
    );

    res.json({
      ok: true,
      ...result,
    });
  } catch (error) {
    if (sendServiceError(res, error)) {
      return;
    }

    next(error);
  }
}

async function addDashboardItem(req, res, next) {
  try {
    if (!assertSkyWebSession(req, res)) {
      return;
    }

    const result = await skywebDashboardsService.addDashboardItem(
      req.user.userId,
      req.params.dashboardKey,
      req.body || {},
    );

    res.json({
      ok: true,
      ...result,
    });
  } catch (error) {
    if (sendServiceError(res, error)) {
      return;
    }

    next(error);
  }
}

async function updateDashboardItem(req, res, next) {
  try {
    if (!assertSkyWebSession(req, res)) {
      return;
    }

    const result = await skywebDashboardsService.updateDashboardItem(
      req.user.userId,
      req.params.dashboardKey,
      req.params.itemId,
      req.body || {},
    );

    res.json({
      ok: true,
      ...result,
    });
  } catch (error) {
    if (sendServiceError(res, error)) {
      return;
    }

    next(error);
  }
}

async function removeDashboardItem(req, res, next) {
  try {
    if (!assertSkyWebSession(req, res)) {
      return;
    }

    const result = await skywebDashboardsService.removeDashboardItem(
      req.user.userId,
      req.params.dashboardKey,
      req.params.itemId,
    );

    res.json({
      ok: true,
      ...result,
    });
  } catch (error) {
    if (sendServiceError(res, error)) {
      return;
    }

    next(error);
  }
}

module.exports = {
  createAlertRule,
  evaluateAlertRule,
  evaluateAlertRules,
  getAlertRule,
  listAlertRuleEvents,
  listAlertRules,
  removeAlertRule,
  updateAlertRule,
  addDashboardItem,
  createDashboard,
  getDashboard,
  listDashboards,
  removeDashboard,
  removeDashboardItem,
  updateDashboard,
  updateDashboardItem,
  getPreferences,
  getProfile,
  listSavedViews,
  removeSavedView,
  saveView,
  updatePreferences,
  updateProfile,
  updateSavedView,
};
