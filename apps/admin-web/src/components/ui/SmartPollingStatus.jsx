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
  const hasHardError = Boolean(state.error);
  const hasWarning = Boolean(state.warning || state.lastErrorAt);
  const statusClass = hasHardError
    ? 'sky-pill-warning'
    : hasWarning
      ? 'sky-pill-info'
      : 'sky-pill-success';
  const statusLabel = hasHardError ? errorLabel : hasWarning ? 'reconnecting' : liveLabel;

  return (
    <div className={`d-flex flex-wrap align-items-center gap-2 small ${className}`.trim()}>
      <span className={`sky-pill ${statusClass}`}>Smart polling {statusLabel}</span>
      <span className="sky-pill sky-pill-info">
        Every {formatPollingInterval(state.intervalMs)}
      </span>
      <span className="sky-pill sky-pill-info">
        {activeLabel} {nextActiveValue}
      </span>
      {(state.lastSuccessfulAt || state.lastUpdatedAt) && (
        <span className="sky-muted">
          Updated {formatDate(state.lastSuccessfulAt || state.lastUpdatedAt)}
        </span>
      )}
      {hasWarning && !hasHardError && (
        <span className="sky-muted">Last poll warning: {state.warning}</span>
      )}
      {hasHardError && <span className="small text-warning-emphasis">{state.error}</span>}
    </div>
  );
}

export default SmartPollingStatus;
