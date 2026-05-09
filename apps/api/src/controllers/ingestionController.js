const ingestionStatusService = require('../services/ingestionStatusService');

function sendPagedResponse(res, payload) {
  res.json({
    ok: true,
    total: payload.total,
    limit: payload.limit,
    offset: payload.offset,
    items: payload.items,
  });
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

async function getStatus(req, res, next) {
  try {
    const payload = await ingestionStatusService.getIngestionStatusSummary(req.query || {});

    res.json({
      ok: true,
      ...payload,
    });
  } catch (error) {
    next(error);
  }
}

async function listSources(req, res, next) {
  try {
    const payload = await ingestionStatusService.listIngestionSources();

    res.json({
      ok: true,
      items: payload.items,
    });
  } catch (error) {
    next(error);
  }
}

async function getSource(req, res, next) {
  try {
    const payload = await ingestionStatusService.getIngestionSource(req.params.source);

    res.json({
      ok: true,
      source: payload.source,
      indicators: payload.indicators,
      recentExecutions: payload.recentExecutions,
    });
  } catch (error) {
    if (sendServiceError(res, error)) {
      return;
    }

    next(error);
  }
}

async function getRecentExecutions(req, res, next) {
  try {
    const payload = await ingestionStatusService.getRecentIngestionExecutions(req.query || {});
    sendPagedResponse(res, payload);
  } catch (error) {
    next(error);
  }
}

async function listIndicatorStatuses(req, res, next) {
  try {
    const payload = await ingestionStatusService.listIngestionIndicatorStatuses(req.query || {});
    sendPagedResponse(res, payload);
  } catch (error) {
    next(error);
  }
}

async function getIndicatorStatus(req, res, next) {
  try {
    const payload = await ingestionStatusService.getIngestionIndicatorStatus(
      req.params.indicatorCode,
    );

    res.json({
      ok: true,
      indicator: payload.indicator,
    });
  } catch (error) {
    if (sendServiceError(res, error)) {
      return;
    }

    next(error);
  }
}

module.exports = {
  getStatus,
  listSources,
  getSource,
  getRecentExecutions,
  listIndicatorStatuses,
  getIndicatorStatus,
};
