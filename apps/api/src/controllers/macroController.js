const macroReadService = require('../services/macroReadService');

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

async function listViews(req, res, next) {
  try {
    const payload = await macroReadService.listMacroViews(req.query || {});

    res.json({
      ok: true,
      items: payload.items,
    });
  } catch (error) {
    next(error);
  }
}

async function getViewColumns(req, res, next) {
  try {
    const payload = await macroReadService.getMacroViewColumns(req.params.viewKey);

    res.json({
      ok: true,
      view: payload.view,
      columns: payload.columns,
    });
  } catch (error) {
    if (sendServiceError(res, error)) {
      return;
    }

    next(error);
  }
}

async function listViewRows(req, res, next) {
  try {
    const payload = await macroReadService.listMacroViewRows(req.params.viewKey, req.query || {});

    res.json({
      ok: true,
      view: payload.view,
      total: payload.total,
      limit: payload.limit,
      offset: payload.offset,
      items: payload.items,
    });
  } catch (error) {
    if (sendServiceError(res, error)) {
      return;
    }

    next(error);
  }
}

async function getLatestViewRow(req, res, next) {
  try {
    const payload = await macroReadService.getLatestMacroViewRow(req.params.viewKey);

    res.json({
      ok: true,
      view: payload.view,
      item: payload.item,
    });
  } catch (error) {
    if (sendServiceError(res, error)) {
      return;
    }

    next(error);
  }
}

async function listIndicators(req, res, next) {
  try {
    const payload = await macroReadService.listMacroIndicators(req.query || {});
    sendPagedResponse(res, payload);
  } catch (error) {
    next(error);
  }
}

async function getIndicator(req, res, next) {
  try {
    const payload = await macroReadService.getMacroIndicator(req.params.indicatorCode);

    res.json({
      ok: true,
      indicator: payload.indicator,
      stats: payload.stats,
    });
  } catch (error) {
    if (sendServiceError(res, error)) {
      return;
    }

    next(error);
  }
}

async function listIndicatorSeries(req, res, next) {
  try {
    const payload = await macroReadService.listMacroIndicatorSeries(
      req.params.indicatorCode,
      req.query || {},
    );

    res.json({
      ok: true,
      indicator: payload.indicator,
      stats: payload.stats,
      total: payload.total,
      limit: payload.limit,
      offset: payload.offset,
      items: payload.items,
    });
  } catch (error) {
    if (sendServiceError(res, error)) {
      return;
    }

    next(error);
  }
}

async function getSummary(req, res, next) {
  try {
    const payload = await macroReadService.getMacroSummary();

    res.json({
      ok: true,
      ...payload,
    });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  listViews,
  getViewColumns,
  listViewRows,
  getLatestViewRow,
  listIndicators,
  getIndicator,
  listIndicatorSeries,
  getSummary,
};
