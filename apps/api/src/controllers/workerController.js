const workerService = require('../services/workerService');
const authService = require('../services/authService');

function sendPagedResponse(res, payload) {
  res.json({
    ok: true,
    total: payload.total,
    limit: payload.limit,
    offset: payload.offset,
    items: payload.items,
  });
}

function sendServiceResponse(res, payload = {}) {
  res.json({
    ok: true,
    ...payload,
  });
}

function sendServiceError(res, error) {
  const statusCode = error.statusCode || 500;
  const response = {
    ok: false,
    error: statusCode >= 500 ? 'Internal server error.' : error.message,
  };

  if (error.details && Object.keys(error.details).length > 0) {
    response.details = error.details;
  }

  res.status(statusCode).json(response);
}

function getActionContext(req) {
  return {
    actor: req.user,
    context: authService.getRequestContext(req),
  };
}

async function getHealth(req, res) {
  try {
    const payload = await workerService.getWorkerHealth();
    sendServiceResponse(res, payload);
  } catch (error) {
    sendServiceError(res, error);
  }
}

async function listWorkerTools(req, res) {
  try {
    const payload = await workerService.listWorkerTools();
    sendServiceResponse(res, payload);
  } catch (error) {
    sendServiceError(res, error);
  }
}

async function listWorkerNodes(req, res) {
  try {
    const payload = await workerService.listWorkerNodes(req.query || {});
    sendPagedResponse(res, payload);
  } catch (error) {
    sendServiceError(res, error);
  }
}

async function listSchedules(req, res) {
  try {
    const payload = await workerService.listSchedules(req.query || {});
    sendPagedResponse(res, payload);
  } catch (error) {
    sendServiceError(res, error);
  }
}

async function getSchedule(req, res) {
  try {
    const payload = await workerService.getSchedule(req.params.scheduleId);
    sendServiceResponse(res, payload);
  } catch (error) {
    sendServiceError(res, error);
  }
}

async function createSchedule(req, res) {
  try {
    const payload = await workerService.createSchedule({
      body: req.body || {},
      ...getActionContext(req),
    });

    res.status(201).json({
      ok: true,
      ...payload,
    });
  } catch (error) {
    sendServiceError(res, error);
  }
}

async function updateSchedule(req, res) {
  try {
    const payload = await workerService.updateSchedule({
      scheduleId: req.params.scheduleId,
      body: req.body || {},
      ...getActionContext(req),
    });

    sendServiceResponse(res, payload);
  } catch (error) {
    sendServiceError(res, error);
  }
}

async function updateScheduleStatus(req, res) {
  try {
    const payload = await workerService.updateScheduleStatus({
      scheduleId: req.params.scheduleId,
      body: req.body || {},
      ...getActionContext(req),
    });

    sendServiceResponse(res, payload);
  } catch (error) {
    sendServiceError(res, error);
  }
}

async function queueScheduleNow(req, res) {
  try {
    const payload = await workerService.queueScheduleNow({
      scheduleId: req.params.scheduleId,
      ...getActionContext(req),
    });

    sendServiceResponse(res, payload);
  } catch (error) {
    sendServiceError(res, error);
  }
}

async function unqueueSchedule(req, res) {
  try {
    const payload = await workerService.unqueueSchedule({
      scheduleId: req.params.scheduleId,
      ...getActionContext(req),
    });

    sendServiceResponse(res, payload);
  } catch (error) {
    sendServiceError(res, error);
  }
}

async function runScheduleNow(req, res) {
  return queueScheduleNow(req, res);
}

async function deleteSchedule(req, res) {
  try {
    const payload = await workerService.deleteSchedule({
      scheduleId: req.params.scheduleId,
      body: req.body || {},
      ...getActionContext(req),
    });

    sendServiceResponse(res, payload);
  } catch (error) {
    sendServiceError(res, error);
  }
}

async function listScheduleRuns(req, res) {
  try {
    const payload = await workerService.listScheduleRuns(req.query || {});
    sendPagedResponse(res, payload);
  } catch (error) {
    sendServiceError(res, error);
  }
}

async function listRunsForSchedule(req, res) {
  try {
    const payload = await workerService.listScheduleRuns({
      ...(req.query || {}),
      scheduleId: req.params.scheduleId,
    });

    sendPagedResponse(res, payload);
  } catch (error) {
    sendServiceError(res, error);
  }
}

async function listListeners(req, res) {
  try {
    const payload = await workerService.listListeners(req.query || {});
    sendPagedResponse(res, payload);
  } catch (error) {
    sendServiceError(res, error);
  }
}

async function getListener(req, res) {
  try {
    const payload = await workerService.getListener(req.params.listenerId);
    sendServiceResponse(res, payload);
  } catch (error) {
    sendServiceError(res, error);
  }
}

async function createListener(req, res) {
  try {
    const payload = await workerService.createListener({
      body: req.body || {},
      ...getActionContext(req),
    });

    res.status(201).json({
      ok: true,
      ...payload,
    });
  } catch (error) {
    sendServiceError(res, error);
  }
}

async function updateListener(req, res) {
  try {
    const payload = await workerService.updateListener({
      listenerId: req.params.listenerId,
      body: req.body || {},
      ...getActionContext(req),
    });

    sendServiceResponse(res, payload);
  } catch (error) {
    sendServiceError(res, error);
  }
}

async function updateListenerStatus(req, res) {
  try {
    const payload = await workerService.updateListenerStatus({
      listenerId: req.params.listenerId,
      body: req.body || {},
      ...getActionContext(req),
    });

    sendServiceResponse(res, payload);
  } catch (error) {
    sendServiceError(res, error);
  }
}

async function listListenerEvents(req, res) {
  try {
    const payload = await workerService.listListenerEvents(req.query || {});
    sendPagedResponse(res, payload);
  } catch (error) {
    sendServiceError(res, error);
  }
}

async function listEventsForListener(req, res) {
  try {
    const payload = await workerService.listListenerEvents({
      ...(req.query || {}),
      listenerId: req.params.listenerId,
    });

    sendPagedResponse(res, payload);
  } catch (error) {
    sendServiceError(res, error);
  }
}

module.exports = {
  getHealth,
  listWorkerTools,
  listWorkerNodes,
  listSchedules,
  getSchedule,
  createSchedule,
  updateSchedule,
  updateScheduleStatus,
  queueScheduleNow,
  unqueueSchedule,
  runScheduleNow,
  deleteSchedule,
  listScheduleRuns,
  listRunsForSchedule,
  listListeners,
  getListener,
  createListener,
  updateListener,
  updateListenerStatus,
  listListenerEvents,
  listEventsForListener,
};
