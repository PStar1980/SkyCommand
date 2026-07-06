const DEFAULT_WAIT_PARAMETERS = {
  duration: '5',
  unit: 'SECONDS',
  reason: '',
};

const WAIT_UNITS = [
  { value: 'MILLISECONDS', label: 'Milliseconds', multiplierMs: 1, shortLabel: 'ms' },
  { value: 'SECONDS', label: 'Seconds', multiplierMs: 1000, shortLabel: 'sec' },
  { value: 'MINUTES', label: 'Minutes', multiplierMs: 60000, shortLabel: 'min' },
  { value: 'HOURS', label: 'Hours', multiplierMs: 3600000, shortLabel: 'hr' },
];

const MAX_WAIT_DURATION_MS = 24 * 60 * 60 * 1000;

function normalizeWaitUnit(value) {
  const normalized = String(value || DEFAULT_WAIT_PARAMETERS.unit)
    .trim()
    .toUpperCase()
    .replace(/[^A-Z]+/g, '_')
    .replace(/^_|_$/g, '');
  const aliases = {
    MS: 'MILLISECONDS',
    MILLISECOND: 'MILLISECONDS',
    MILLISECONDS: 'MILLISECONDS',
    SECOND: 'SECONDS',
    SECONDS: 'SECONDS',
    SEC: 'SECONDS',
    S: 'SECONDS',
    MINUTE: 'MINUTES',
    MINUTES: 'MINUTES',
    MIN: 'MINUTES',
    M: 'MINUTES',
    HOUR: 'HOURS',
    HOURS: 'HOURS',
    HR: 'HOURS',
    H: 'HOURS',
  };

  return aliases[normalized] || DEFAULT_WAIT_PARAMETERS.unit;
}

function normalizeWaitParameters(parameters = {}) {
  const unit = normalizeWaitUnit(parameters.unit);
  const duration = String(parameters.duration ?? DEFAULT_WAIT_PARAMETERS.duration).trim();
  const reason = String(parameters.reason || '').trim();

  return {
    ...DEFAULT_WAIT_PARAMETERS,
    ...(parameters || {}),
    duration,
    unit,
    reason,
  };
}

function getWaitDurationMs(parameters = {}) {
  const values = normalizeWaitParameters(parameters);
  const unit = WAIT_UNITS.find((item) => item.value === values.unit) || WAIT_UNITS[1];
  const parsedDuration = Number(values.duration);

  if (!Number.isFinite(parsedDuration) || parsedDuration <= 0) {
    return 0;
  }

  return Math.round(parsedDuration * unit.multiplierMs);
}

function formatWaitDuration(parameters = {}) {
  const values = normalizeWaitParameters(parameters);
  const unit = WAIT_UNITS.find((item) => item.value === values.unit) || WAIT_UNITS[1];
  const duration = String(values.duration || DEFAULT_WAIT_PARAMETERS.duration).trim();

  return `${duration} ${unit.shortLabel}`;
}

function cleanWaitParameterValues(values = {}) {
  const parameters = normalizeWaitParameters(values);
  const durationMs = getWaitDurationMs(parameters);

  if (!durationMs) {
    throw new Error('Wait nodes require a positive duration.');
  }

  if (durationMs > MAX_WAIT_DURATION_MS) {
    throw new Error('Wait nodes are capped at 24 hours.');
  }

  return Object.fromEntries(
    Object.entries({
      duration: String(parameters.duration).trim(),
      unit: parameters.unit,
      durationMs,
      reason: String(parameters.reason || '').trim(),
    }).filter(([, value]) => value !== undefined && value !== null && value !== ''),
  );
}

function WaitParameterEditor({ idPrefix = 'wait-parameter', parameters = {}, onChange }) {
  const values = normalizeWaitParameters(parameters);
  const durationMs = getWaitDurationMs(values);

  function patch(changes) {
    onChange(normalizeWaitParameters({ ...values, ...changes }));
  }

  return (
    <div className="row g-3">
      <div className="col-lg-5">
        <label className="form-label" htmlFor={`${idPrefix}-duration`}>Duration</label>
        <input
          className="form-control sky-form-control sky-mono"
          id={`${idPrefix}-duration`}
          min="1"
          onChange={(event) => patch({ duration: event.target.value })}
          placeholder="5"
          step="1"
          type="number"
          value={values.duration ?? ''}
        />
      </div>
      <div className="col-lg-4">
        <label className="form-label" htmlFor={`${idPrefix}-unit`}>Unit</label>
        <select
          className="form-select sky-form-control"
          id={`${idPrefix}-unit`}
          onChange={(event) => patch({ unit: event.target.value })}
          value={values.unit || DEFAULT_WAIT_PARAMETERS.unit}
        >
          {WAIT_UNITS.map((unit) => <option key={unit.value} value={unit.value}>{unit.label}</option>)}
        </select>
      </div>
      <div className="col-lg-3">
        <label className="form-label">Preview</label>
        <div className="sky-empty-state text-start py-2 sky-mono">
          {durationMs ? `${durationMs} ms` : 'Set duration'}
        </div>
      </div>
      <div className="col-12">
        <label className="form-label" htmlFor={`${idPrefix}-reason`}>Reason / note</label>
        <input
          className="form-control sky-form-control"
          id={`${idPrefix}-reason`}
          onChange={(event) => patch({ reason: event.target.value })}
          placeholder="Optional note shown in workflow history"
          value={values.reason || ''}
        />
        <div className="form-text sky-muted">Temporal-backed runs use a durable timer. Maximum wait is 24 hours per node.</div>
      </div>
    </div>
  );
}

export {
  cleanWaitParameterValues,
  DEFAULT_WAIT_PARAMETERS,
  formatWaitDuration,
  getWaitDurationMs,
};

export default WaitParameterEditor;
