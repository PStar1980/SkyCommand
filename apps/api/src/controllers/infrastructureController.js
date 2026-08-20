const infrastructureService = require('../services/infrastructureService');
const authService = require('../services/authService');

async function getDockerOverview(req, res, next) {
  try {
    const overview = await infrastructureService.getDockerOverview();
    res.json({
      ok: true,
      overview,
    });
  } catch (error) {
    next(error);
  }
}

async function controlDockerComposeProject(req, res, next) {
  try {
    const result = await infrastructureService.controlDockerComposeProject({
      projectName: req.params.projectName,
      action: req.body?.action,
      confirmed: req.body?.confirmed === true,
      actor: req.user,
      session: req.session,
      requestContext: authService.getRequestContext(req),
    });

    res.json({
      ok: true,
      ...result,
    });
  } catch (error) {
    next(error);
  }
}

async function listDockerOperations(req, res, next) {
  try {
    const result = await infrastructureService.listDockerOperations(req.query || {});
    res.json({
      ok: true,
      ...result,
    });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  controlDockerComposeProject,
  getDockerOverview,
  listDockerOperations,
};
