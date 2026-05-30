const skywebPreferencesService = require('../services/skywebPreferencesService');
const skywebProfileService = require('../services/skywebProfileService');
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

module.exports = {
  getPreferences,
  getProfile,
  listSavedViews,
  removeSavedView,
  saveView,
  updatePreferences,
  updateProfile,
  updateSavedView,
};
