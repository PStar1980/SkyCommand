const skywebProfileService = require('../services/skywebProfileService');

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

module.exports = {
  getProfile,
  updateProfile,
};
