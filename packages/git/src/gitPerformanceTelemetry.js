const { performance } = require('node:perf_hooks');

function normalizeDurationMs(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function normalizePerformanceTelemetry(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;

  const normalized = {
    instrumentedTotalMs: normalizeDurationMs(value.instrumentedTotalMs),
    phases: Array.isArray(value.phases)
      ? value.phases
          .filter((phase) => phase && typeof phase === 'object' && !Array.isArray(phase))
          .map((phase) => ({
            code: String(phase.code || 'UNKNOWN'),
            label: String(phase.label || phase.code || 'Phase'),
            durationMs: normalizeDurationMs(phase.durationMs),
          }))
      : [],
  };

  if (Number.isFinite(Number(value.processUptimeAtStartMs))) {
    normalized.processUptimeAtStartMs = normalizeDurationMs(value.processUptimeAtStartMs);
  }
  if (Number.isFinite(Number(value.processUptimeAtCompleteMs))) {
    normalized.processUptimeAtCompleteMs = normalizeDurationMs(value.processUptimeAtCompleteMs);
  }

  return normalized;
}

function createGitPerformanceTelemetry() {
  const instrumentationStartedAt = performance.now();
  const phases = [];

  function recordPhase(code, label, durationMs) {
    phases.push({
      code: String(code || 'UNKNOWN'),
      label: String(label || code || 'Phase'),
      durationMs: normalizeDurationMs(durationMs),
    });
  }

  function measureSync(code, label, action) {
    const startedAt = performance.now();
    try {
      return action();
    } finally {
      recordPhase(code, label, performance.now() - startedAt);
    }
  }

  async function measure(code, label, action) {
    const startedAt = performance.now();
    try {
      return await action();
    } finally {
      recordPhase(code, label, performance.now() - startedAt);
    }
  }

  function snapshot() {
    return {
      instrumentedTotalMs: normalizeDurationMs(performance.now() - instrumentationStartedAt),
      phases: phases.map((phase) => ({ ...phase })),
    };
  }

  return {
    measure,
    measureSync,
    recordPhase,
    snapshot,
  };
}

module.exports = {
  createGitPerformanceTelemetry,
  normalizePerformanceTelemetry,
};
