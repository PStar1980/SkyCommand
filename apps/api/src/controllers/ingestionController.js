const ingestionStatusService = require('../services/ingestionStatusService');
const dataCatalogueService = require('../../../../packages/ingestion/src/catalogue/dataCatalogueService');
const { createLiveTelemetryEnvelope } = require('../utils/liveTelemetryEnvelope');

function isActiveIngestionExecution(execution = {}) {
  return ['STARTED', 'RUNNING', 'QUEUED'].includes(String(execution.status || '').toUpperCase());
}

function buildIngestionTelemetry(payload = {}) {
  const recentExecutions = payload.recentExecutions || [];
  const activeExecutions = recentExecutions.filter(isActiveIngestionExecution);
  const activeWatchCount =
    activeExecutions.length +
    Number(payload.staleIndicators || 0) +
    Number(payload.errorIndicators || 0) +
    Number(payload.noDataIndicators || 0);

  return createLiveTelemetryEnvelope({
    active: activeWatchCount > 0,
    activeCount: activeWatchCount,
    counts: {
      sourceCount: payload.sourceCount || 0,
      totalIndicators: payload.totalIndicators || 0,
      currentIndicators: payload.currentIndicators || 0,
      staleIndicators: payload.staleIndicators || 0,
      noDataIndicators: payload.noDataIndicators || 0,
      errorIndicators: payload.errorIndicators || 0,
      activeExecutions: activeExecutions.length,
    },
    meta: {
      overallStatus: payload.overallStatus || 'UNKNOWN',
    },
    records: payload.sources || [],
    resource: 'pipeline-status',
    scope: 'macro-pipeline',
    selectedRecord: payload,
    status:
      payload.overallStatus === 'ERROR'
        ? 'error'
        : payload.overallStatus === 'WARNING'
          ? 'warning'
          : 'idle',
    surface: 'data-pipeline-dashboard',
  });
}

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


async function listCatalogueDomains(req, res, next) {
  try {
    const items = await dataCatalogueService.listDomains(req.query || {});

    res.json({
      ok: true,
      contractVersion: dataCatalogueService.CATALOGUE_CONTRACT_VERSION,
      generatedAt: new Date().toISOString(),
      items,
    });
  } catch (error) {
    if (sendServiceError(res, error)) {
      return;
    }

    next(error);
  }
}

async function listCatalogueAssets(req, res, next) {
  try {
    const payload = await dataCatalogueService.listAssets(req.query || {});

    res.json({
      ok: true,
      contractVersion: dataCatalogueService.CATALOGUE_CONTRACT_VERSION,
      generatedAt: new Date().toISOString(),
      ...payload,
    });
  } catch (error) {
    if (sendServiceError(res, error)) {
      return;
    }

    next(error);
  }
}

async function getCatalogueAsset(req, res, next) {
  try {
    const asset = await dataCatalogueService.getAsset(
      req.params.domainCode,
      req.params.assetCode,
    );

    if (!asset) {
      res.status(404).json({
        ok: false,
        error: 'Data asset not found.',
      });
      return;
    }

    res.json({
      ok: true,
      contractVersion: dataCatalogueService.CATALOGUE_CONTRACT_VERSION,
      generatedAt: new Date().toISOString(),
      asset,
    });
  } catch (error) {
    if (sendServiceError(res, error)) {
      return;
    }

    next(error);
  }
}

async function listCatalogueMetrics(req, res, next) {
  try {
    const payload = await dataCatalogueService.listMetrics(req.query || {});

    res.json({
      ok: true,
      contractVersion: dataCatalogueService.CATALOGUE_CONTRACT_VERSION,
      generatedAt: new Date().toISOString(),
      ...payload,
    });
  } catch (error) {
    if (sendServiceError(res, error)) {
      return;
    }

    next(error);
  }
}

async function getStatus(req, res, next) {
  try {
    const payload = await ingestionStatusService.getIngestionStatusSummary(req.query || {});
    const liveEnvelope = buildIngestionTelemetry(payload);

    res.json({
      ok: true,
      ...payload,
      ...liveEnvelope,
    });
  } catch (error) {
    next(error);
  }
}


async function listTools(req, res, next) {
  try {
    const payload = await ingestionStatusService.listIngestionTools(req.query || {});

    res.json({
      ok: true,
      items: payload.items,
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
  listTools,
  listSources,
  getSource,
  getRecentExecutions,
  listIndicatorStatuses,
  getIndicatorStatus,
  listCatalogueDomains,
  listCatalogueAssets,
  getCatalogueAsset,
  listCatalogueMetrics,
};
