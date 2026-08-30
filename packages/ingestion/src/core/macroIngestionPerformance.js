const { performance } = require('node:perf_hooks');

function normalizeDurationMs(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function normalizePhase(phase = {}) {
  return {
    code: String(phase.code || 'UNKNOWN'),
    label: String(phase.label || phase.code || 'Phase'),
    durationMs: normalizeDurationMs(phase.durationMs),
  };
}

function normalizeSlowIndicator(value = {}) {
  return {
    indicatorCode: String(value.indicatorCode || 'UNKNOWN'),
    durationMs: normalizeDurationMs(value.durationMs),
    fetchMs: normalizeDurationMs(value.fetchMs),
    normalizeMs: normalizeDurationMs(value.normalizeMs),
    loadMs: normalizeDurationMs(value.loadMs),
    cleanupMs: normalizeDurationMs(value.cleanupMs),
  };
}

function normalizeWorkloadBreakdown(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;

  const cumulativeStageMs = value.cumulativeStageMs && typeof value.cumulativeStageMs === 'object'
    ? value.cumulativeStageMs
    : {};

  return {
    instrumentedTotalMs: normalizeDurationMs(value.instrumentedTotalMs),
    concurrency: Math.max(0, Number.parseInt(value.concurrency, 10) || 0),
    batchCount: Math.max(0, Number.parseInt(value.batchCount, 10) || 0),
    phases: Array.isArray(value.phases) ? value.phases.map(normalizePhase) : [],
    cumulativeStageMs: {
      fetchMs: normalizeDurationMs(cumulativeStageMs.fetchMs),
      normalizeMs: normalizeDurationMs(cumulativeStageMs.normalizeMs),
      loadMs: normalizeDurationMs(cumulativeStageMs.loadMs),
      cleanupMs: normalizeDurationMs(cumulativeStageMs.cleanupMs),
    },
    slowestIndicators: Array.isArray(value.slowestIndicators)
      ? value.slowestIndicators.map(normalizeSlowIndicator).slice(0, 10)
      : [],
  };
}

function normalizeMacroPerformanceTelemetry(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;

  const workloadBreakdown = normalizeWorkloadBreakdown(value.workloadBreakdown);
  return {
    instrumentedTotalMs: normalizeDurationMs(value.instrumentedTotalMs),
    phases: Array.isArray(value.phases) ? value.phases.map(normalizePhase) : [],
    ...(workloadBreakdown ? { workloadBreakdown } : {}),
  };
}

function createMacroPerformanceTelemetry() {
  const instrumentationStartedAt = performance.now();
  const phases = [];

  function recordPhase(code, label, durationMs) {
    phases.push(normalizePhase({ code, label, durationMs }));
  }

  async function measure(code, label, action) {
    const startedAt = performance.now();
    try {
      return await action();
    } finally {
      recordPhase(code, label, performance.now() - startedAt);
    }
  }

  function snapshot(extra = {}) {
    const workloadBreakdown = normalizeWorkloadBreakdown(extra.workloadBreakdown);
    return {
      instrumentedTotalMs: normalizeDurationMs(performance.now() - instrumentationStartedAt),
      phases: phases.map((phase) => ({ ...phase })),
      ...(workloadBreakdown ? { workloadBreakdown } : {}),
    };
  }

  return {
    measure,
    recordPhase,
    snapshot,
  };
}

module.exports = {
  createMacroPerformanceTelemetry,
  normalizeDurationMs,
  normalizeMacroPerformanceTelemetry,
  normalizeWorkloadBreakdown,
};
