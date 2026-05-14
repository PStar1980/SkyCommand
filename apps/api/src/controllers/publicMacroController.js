const publicMacroService = require('../services/publicMacroService');

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

async function getSummary(req, res, next) {
  try {
    const payload = await publicMacroService.getPublicMacroSummary();

    res.json({
      ok: true,
      ...payload,
    });
  } catch (error) {
    next(error);
  }
}

async function listViews(req, res, next) {
  try {
    const payload = await publicMacroService.listPublicMacroViews(req.query || {});

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
    const payload = await publicMacroService.getPublicMacroViewColumns(req.params.viewKey);

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
    const payload = await publicMacroService.listPublicMacroViewRows(
      req.params.viewKey,
      req.query || {},
    );

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
    const payload = await publicMacroService.getLatestPublicMacroViewRow(req.params.viewKey);

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
    const payload = await publicMacroService.listPublicMacroIndicators(req.query || {});

    res.json({
      ok: true,
      total: payload.total,
      limit: payload.limit,
      offset: payload.offset,
      items: payload.items,
    });
  } catch (error) {
    next(error);
  }
}

async function getIndicator(req, res, next) {
  try {
    const payload = await publicMacroService.getPublicMacroIndicator(req.params.indicatorCode);

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
    const payload = await publicMacroService.listPublicMacroIndicatorSeries(
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

module.exports = {
  getSummary,
  listViews,
  getViewColumns,
  listViewRows,
  getLatestViewRow,
  listIndicators,
  getIndicator,
  listIndicatorSeries,
};
