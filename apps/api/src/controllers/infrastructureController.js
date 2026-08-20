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


async function getDockerContainerDetail(req, res, next) {
  try {
    const detail = await infrastructureService.getDockerContainerDetail({
      containerId: req.params.containerId,
      tail: req.query?.tail,
    });
    res.json({
      ok: true,
      detail,
    });
  } catch (error) {
    next(error);
  }
}

async function controlDockerContainer(req, res, next) {
  try {
    const result = await infrastructureService.controlDockerContainer({
      containerId: req.params.containerId,
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
  controlDockerContainer,
  getDockerContainerDetail,
  getDockerOverview,
  listDockerOperations,
};
