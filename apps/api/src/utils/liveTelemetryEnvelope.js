function normalizeArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeNumber(value, fallback = 0) {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : fallback;
}

function normalizeIssues(items = []) {
  return normalizeArray(items)
    .filter(Boolean)
    .map((item) => {
      if (typeof item === 'string') {
        return { message: item };
      }

      return {
        code: item.code || undefined,
        message: item.message || item.error || String(item),
        details: item.details || undefined,
      };
    });
}

function resolveTelemetryStatus({ active = false, errors = [], status } = {}) {
  if (status) {
    return status;
  }

  if (normalizeArray(errors).length > 0) {
    return 'warning';
  }

  return active ? 'active' : 'idle';
}

function createLiveTelemetryEnvelope({
  active = false,
  activeCount = 0,
  contractVersion = '13.2',
  counts = {},
  errors = [],
  generatedAt = new Date().toISOString(),
  meta = {},
  records = [],
  resource = 'snapshot',
  scope = 'general',
  selectedRecord = null,
  status,
  surface = 'skycommand',
  warnings = [],
} = {}) {
  const normalizedErrors = normalizeIssues(errors);
  const normalizedWarnings = normalizeIssues(warnings);
  const normalizedActiveCount = normalizeNumber(activeCount, 0);
  const normalizedRecords = normalizeArray(records);
  const normalizedCounts = {
    returned: normalizedRecords.length,
    active: normalizedActiveCount,
    ...(counts || {}),
  };

  return {
    generatedAt,
    liveTelemetry: {
      contractVersion,
      surface,
      scope,
      resource,
      status: resolveTelemetryStatus({ active, errors: normalizedErrors, status }),
      active: Boolean(active || normalizedActiveCount > 0),
      activeCount: normalizedActiveCount,
      counts: normalizedCounts,
      records: normalizedRecords,
      selectedRecord,
      warnings: normalizedWarnings,
      errors: normalizedErrors,
      ...meta,
    },
  };
}

function sendLiveTelemetryResponse(res, payload = {}, telemetryOptions = {}) {
  const envelope = createLiveTelemetryEnvelope(telemetryOptions);

  return res.json({
    ok: true,
    ...payload,
    ...envelope,
  });
}

module.exports = {
  createLiveTelemetryEnvelope,
  sendLiveTelemetryResponse,
};
