const authService = require('../services/authService');

async function login(req, res, next) {
  try {
    const { email, password } = req.body || {};
    const context = authService.getRequestContext(req);

    const result = await authService.login({ email, password, context });

    res.json({
      ok: true,
      user: result.user,
      sessionToken: result.sessionToken,
      expiresAt: result.expiresAt,
      permissions: result.permissions,
    });
  } catch (error) {
    res.status(401).json({
      ok: false,
      error: error.message || 'Login failed.',
    });
  }
}

async function logout(req, res, next) {
  try {
    const context = authService.getRequestContext(req);

    await authService.logout({
      sessionToken: req.sessionToken,
      userId: req.user?.userId,
      context,
    });

    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
}

async function me(req, res) {
  res.json({
    ok: true,
    user: req.user,
    session: req.session,
    permissions: req.permissions || [],
  });
}

async function permissions(req, res) {
  res.json({
    ok: true,
    permissions: req.permissions || [],
  });
}

module.exports = {
  login,
  logout,
  me,
  permissions,
};
