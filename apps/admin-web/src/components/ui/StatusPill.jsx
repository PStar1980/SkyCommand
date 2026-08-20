const SUCCESS_STATUSES = new Set(['SUCCESS', 'CURRENT', 'ONLINE', 'POLLING', 'COMPLETED', 'PASS', 'ACTIVE', 'READY', 'VALID']);
const DANGER_STATUSES = new Set(['FAILED', 'FAIL', 'ERROR', 'OFFLINE', 'TERMINATED', 'CANCELED', 'BLOCKED', 'INVALID', 'REJECTED']);
const WARNING_STATUSES = new Set(['STARTED', 'RUNNING', 'WARNING', 'STALE', 'DEGRADED', 'BUSY', 'QUEUED', 'PENDING', 'DISABLED']);

export function normalizeStatus(value) {
  if (value === true) {
    return 'ONLINE';
  }

  if (value === false) {
    return 'OFFLINE';
  }

  return String(value || 'UNKNOWN')
    .trim()
    .toUpperCase();
}

export function getStatusTone(status) {
  const normalized = normalizeStatus(status);

  if (SUCCESS_STATUSES.has(normalized)) {
    return 'success';
  }

  if (DANGER_STATUSES.has(normalized)) {
    return 'danger';
  }

  if (WARNING_STATUSES.has(normalized)) {
    return 'warning';
  }

  return 'info';
}

export function getStatusClass(status) {
  return `sky-pill-${getStatusTone(status)}`;
}

export function getStatusDotClass(status) {
  return `sky-status-dot-${getStatusTone(status)}`;
}

export function getStatusLabel(status) {
  const normalized = normalizeStatus(status);

  if (normalized === 'STARTED') {
    return 'RUNNING';
  }

  return normalized || 'UNKNOWN';
}

export function StatusDot({ className = '', status }) {
  return <span className={`sky-status-dot ${getStatusDotClass(status)} ${className}`.trim()} />;
}

function StatusPill({ children, className = '', label, status }) {
  const displayLabel = label || children || getStatusLabel(status);

  return <span className={`sky-pill ${getStatusClass(status)} ${className}`.trim()}>{displayLabel}</span>;
}

export default StatusPill;
