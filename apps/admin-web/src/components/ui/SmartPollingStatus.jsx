import { formatPollingInterval } from '../../hooks/useSmartPolling.js';

function formatDate(value) {
  if (!value) {
    return '—';
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return '—';
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

function SmartPollingStatus({
  activeLabel = 'Active items',
  activeValue,
  className = '',
  errorLabel = 'checking',
  liveLabel = 'live',
  state = {},
}) {
  const nextActiveValue = activeValue ?? state.activeCount ?? 0;

  return (
    <div className={`d-flex flex-wrap align-items-center gap-2 small ${className}`.trim()}>
      <span className={`sky-pill ${state.error ? 'sky-pill-warning' : 'sky-pill-success'}`}>
        Smart polling {state.error ? errorLabel : liveLabel}
      </span>
      <span className="sky-pill sky-pill-info">
        Every {formatPollingInterval(state.intervalMs)}
      </span>
      <span className="sky-pill sky-pill-info">
        {activeLabel} {nextActiveValue}
      </span>
      {state.lastUpdatedAt && (
        <span className="sky-muted">Updated {formatDate(state.lastUpdatedAt)}</span>
      )}
      {state.error && <span className="small text-warning-emphasis">{state.error}</span>}
    </div>
  );
}

export default SmartPollingStatus;
