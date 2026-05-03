const authService = require('../services/authService');

async function requireAuth(req, res, next) {
  try {
    const sessionToken = authService.getBearerToken(req);

    if (!sessionToken) {
      return res.status(401).json({
        ok: false,
        error: 'Missing bearer token.',
      });
    }

    const sessionData = await authService.getSessionFromToken(sessionToken);

    if (!sessionData) {
      return res.status(401).json({
        ok: false,
        error: 'Invalid or expired session.',
      });
    }

    req.sessionToken = sessionToken;
    req.session = sessionData.session;
    req.user = sessionData.user;
    req.permissions = sessionData.permissions;

    return next();
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  requireAuth,
};
