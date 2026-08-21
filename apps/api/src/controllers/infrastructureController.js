const infrastructureService = require('../services/infrastructureService');
const authService = require('../services/authService');
const dockerEventStreamService = require('../services/dockerEventStreamService');
const dockerTelemetryStreamService = require('../services/dockerTelemetryStreamService');


function assertInternalServiceRequest(req) {
  if (req.session?.authMode === 'INTERNAL_SERVICE_TOKEN') return;

  const error = new Error('Docker live-observability ingestion is restricted to the SkyCommand internal service identity.');
  error.statusCode = 403;
  throw error;
}

async function ingestDockerEvent(req, res, next) {
  try {
    assertInternalServiceRequest(req);
    const result = dockerEventStreamService.ingestDockerEventPayload(req.body || {});
    res.status(202).json({ ok: true, ...result });
  } catch (error) {
    next(error);
  }
}

function streamDockerEvents(req, res, next) {
  try {
    dockerEventStreamService.streamDockerEvents(req, res);
  } catch (error) {
    next(error);
  }
}


async function ingestDockerTelemetry(req, res, next) {
  try {
    assertInternalServiceRequest(req);
    const result = dockerTelemetryStreamService.ingestDockerTelemetryPayload(req.body || {});
    res.status(202).json({ ok: true, ...result });
  } catch (error) {
    next(error);
  }
}

function streamDockerTelemetry(req, res, next) {
  try {
    dockerTelemetryStreamService.streamDockerTelemetry(req, res);
  } catch (error) {
    next(error);
  }
}

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
  ingestDockerEvent,
  ingestDockerTelemetry,
  streamDockerEvents,
  streamDockerTelemetry,
  controlDockerComposeProject,
  controlDockerContainer,
  getDockerContainerDetail,
  getDockerOverview,
  listDockerOperations,
};
