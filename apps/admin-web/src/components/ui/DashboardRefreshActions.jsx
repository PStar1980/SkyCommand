import SmartPollingStatus from './SmartPollingStatus.jsx';

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

function DashboardRefreshActions({
  activeLabel = 'Active items',
  activeValue,
  lastRefreshAt,
  loading = false,
  onRefresh,
  pollingState = {},
}) {
  return (
    <div className="sky-dashboard-refresh-stack">
      <button
        className="btn sky-btn-ghost"
        disabled={loading}
        onClick={onRefresh}
        type="button"
      >
        {loading ? 'Refreshing...' : 'Refresh'}
      </button>
      <div className="small sky-muted sky-dashboard-last-refresh">
        Last refresh: {formatDate(lastRefreshAt)}
      </div>
      <SmartPollingStatus
        activeLabel={activeLabel}
        activeValue={activeValue}
        className="justify-content-end"
        showUpdatedAt={false}
        state={pollingState}
      />
    </div>
  );
}

export default DashboardRefreshActions;
