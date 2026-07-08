export const DEFAULT_RETRY_POLICY = {
  maximumAttempts: '1',
  initialIntervalSeconds: '5',
};

export function getInitialRetryPolicyValues(value = {}) {
  const retryPolicy = value || {};

  return {
    maximumAttempts: String(retryPolicy.maximumAttempts ?? retryPolicy.maximum_attempts ?? DEFAULT_RETRY_POLICY.maximumAttempts),
    initialIntervalSeconds: String(retryPolicy.initialIntervalSeconds ?? retryPolicy.initial_interval_seconds ?? DEFAULT_RETRY_POLICY.initialIntervalSeconds),
  };
}

function parseBoundedInteger(value, fieldName, { fallback, min = 1, max = 3600 } = {}) {
  const text = String(value ?? '').trim();

  if (!text && fallback !== undefined) {
    return fallback;
  }

  const parsed = Number.parseInt(text || String(fallback ?? ''), 10);

  if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
    throw new Error(`${fieldName} must be a whole number from ${min} to ${max}.`);
  }

  return parsed;
}

export function cleanRetryPolicyValues(value = {}) {
  const retryPolicy = getInitialRetryPolicyValues(value);
  const maximumAttempts = parseBoundedInteger(retryPolicy.maximumAttempts, 'Maximum attempts', {
    fallback: Number(DEFAULT_RETRY_POLICY.maximumAttempts),
    min: 1,
    max: 10,
  });
  const initialIntervalSeconds = parseBoundedInteger(retryPolicy.initialIntervalSeconds, 'Retry delay seconds', {
    fallback: Number(DEFAULT_RETRY_POLICY.initialIntervalSeconds),
    min: 1,
    max: 3600,
  });

  return {
    maximumAttempts,
    initialIntervalSeconds,
  };
}

export function cleanNodeTimeoutMs(value) {
  const text = String(value ?? '').trim();

  if (!text) {
    return null;
  }

  const parsed = Number.parseInt(text, 10);

  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 86400000) {
    throw new Error('Node timeout must be blank or a whole number from 1 to 86400000 milliseconds.');
  }

  return parsed;
}

export function getRetryPolicySummary(value = {}) {
  const retryPolicy = getInitialRetryPolicyValues(value);
  const attempts = retryPolicy.maximumAttempts || DEFAULT_RETRY_POLICY.maximumAttempts;
  const delay = retryPolicy.initialIntervalSeconds || DEFAULT_RETRY_POLICY.initialIntervalSeconds;

  return `${attempts} attempt(s) · ${delay}s retry delay`;
}

export default function WorkflowRetryPolicyEditor({
  idPrefix,
  onChange,
  retryPolicy = {},
  timeoutMs = '',
}) {
  const values = getInitialRetryPolicyValues(retryPolicy);

  function patchRetryPolicy(changes) {
    onChange({
      retryPolicy: {
        ...values,
        ...changes,
      },
      timeoutMs,
    });
  }

  function patchTimeout(nextTimeoutMs) {
    onChange({
      retryPolicy: values,
      timeoutMs: nextTimeoutMs,
    });
  }

  return (
    <div className="sky-worker-command-card mt-3">
      <div className="sky-page-kicker mb-2">Retry and timeout policy</div>
      <div className="row g-3">
        <div className="col-lg-4">
          <label className="form-label" htmlFor={`${idPrefix}-maximum-attempts`}>Maximum attempts</label>
          <input
            className="form-control sky-form-control sky-mono"
            id={`${idPrefix}-maximum-attempts`}
            max="10"
            min="1"
            onChange={(event) => patchRetryPolicy({ maximumAttempts: event.target.value })}
            type="number"
            value={values.maximumAttempts}
          />
          <div className="form-text">Includes the first try. Range: 1–10.</div>
        </div>
        <div className="col-lg-4">
          <label className="form-label" htmlFor={`${idPrefix}-initial-interval`}>Retry delay seconds</label>
          <input
            className="form-control sky-form-control sky-mono"
            id={`${idPrefix}-initial-interval`}
            max="3600"
            min="1"
            onChange={(event) => patchRetryPolicy({ initialIntervalSeconds: event.target.value })}
            type="number"
            value={values.initialIntervalSeconds}
          />
          <div className="form-text">Temporal waits this long between automatic node retries.</div>
        </div>
        <div className="col-lg-4">
          <label className="form-label" htmlFor={`${idPrefix}-timeout-ms`}>Node timeout ms</label>
          <input
            className="form-control sky-form-control sky-mono"
            id={`${idPrefix}-timeout-ms`}
            max="86400000"
            min="1"
            onChange={(event) => patchTimeout(event.target.value)}
            placeholder="Optional"
            type="number"
            value={timeoutMs ?? ''}
          />
          <div className="form-text">Optional ledger timeout value; blank keeps default behavior.</div>
        </div>
      </div>
    </div>
  );
}
