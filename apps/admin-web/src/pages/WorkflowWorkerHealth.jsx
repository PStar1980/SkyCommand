import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import WorkerHealthVisuals from '../components/charts/WorkerHealthVisuals.jsx';
import workflowService from '../services/workflowService';

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

function formatDuration(value) {
  if (value === undefined || value === null || value === '') {
    return '—';
  }

  const milliseconds = Number(value);

  if (!Number.isFinite(milliseconds)) {
    return '—';
  }

  if (milliseconds < 1000) {
    return `${milliseconds} ms`;
  }

  const seconds = Math.round(milliseconds / 1000);
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;

  if (minutes === 0) {
    return `${seconds} s`;
  }

  return `${minutes}m ${String(remainingSeconds).padStart(2, '0')}s`;
}

function statusClass(status) {
  const normalized = String(status || '').toUpperCase();

  if (['ONLINE', 'CURRENT', 'HEALTHY', 'POLLING', 'COMPLETED', 'SUCCESS'].includes(normalized)) {
    return 'sky-pill-success';
  }

  if (['OFFLINE', 'FAILED', 'ERROR', 'TERMINATED'].includes(normalized)) {
    return 'sky-pill-danger';
  }

  if (['WARNING', 'DEGRADED', 'STALE', 'BUSY', 'RUNNING', 'QUEUED'].includes(normalized)) {
    return 'sky-pill-warning';
  }

  return 'sky-pill-info';
}

function dotClass(status) {
  const pillClass = statusClass(status);

  if (pillClass.includes('success')) {
    return 'sky-status-dot-success';
  }

  if (pillClass.includes('danger')) {
    return 'sky-status-dot-danger';
  }

  if (pillClass.includes('warning')) {
    return 'sky-status-dot-warning';
  }

  return 'sky-status-dot-info';
}

function MetricCard({ label, value, help, status }) {
  return (
    <section className="sky-card sky-stat-card sky-dashboard-stat-card h-100">
      <div className="sky-card-body">
        <div className="d-flex align-items-start justify-content-between gap-2">
          <div>
            <div className="sky-page-kicker">{label}</div>
            <div className="sky-stat-value sky-worker-stat-value">{value}</div>
          </div>
          <span className={`sky-status-dot ${dotClass(status)}`} />
        </div>
        <div className="small sky-muted mt-2">{help}</div>
      </div>
    </section>
  );
}

function CommandCard({ label, command }) {
  return (
    <div className="sky-worker-command-card">
      <div className="sky-page-kicker mb-2">{label}</div>
      <pre className="sky-code-block sky-worker-json-preview mb-0"><code>{command || '—'}</code></pre>
    </div>
  );
}

function WorkflowWorkerHealth() {
  const [health, setHealth] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [refreshingAt, setRefreshingAt] = useState(null);
  const [recentRuns, setRecentRuns] = useState([]);
  const [pendingApprovals, setPendingApprovals] = useState([]);

  async function loadHealth() {
    setLoading(true);
    setError('');

    try {
      const healthResult = await workflowService.getWorkerHealth();

      const [runsResult, approvalsResult] = await Promise.allSettled([
        workflowService.listRuns({ limit: 80 }),
        workflowService.listApprovals({ status: 'PENDING', limit: 50 }),
      ]);

      setHealth(healthResult);
      setRecentRuns(runsResult.status === 'fulfilled' ? runsResult.value?.items || [] : []);
      setPendingApprovals(approvalsResult.status === 'fulfilled' ? approvalsResult.value?.items || [] : []);
      setRefreshingAt(new Date());
    } catch (loadError) {
      setError(loadError.message || 'Failed to load worker health.');
      setRecentRuns([]);
      setPendingApprovals([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadHealth();
  }, []);

  const metricCards = useMemo(() => {
    const taskQueue = health?.taskQueue || {};
    const worker = health?.worker || {};
    const runs = health?.runs || {};
    const approvals = health?.approvals || {};

    return [
      {
        label: 'Temporal server',
        value: loading ? '—' : health?.temporal?.reachable ? 'ONLINE' : 'OFFLINE',
        help: health?.temporal?.error || `${health?.temporal?.address || 'localhost:7233'} · ${health?.temporal?.namespace || 'default'}`,
        status: health?.temporal?.reachable ? 'ONLINE' : 'OFFLINE',
      },
      {
        label: 'Task queue',
        value: loading ? '—' : taskQueue.healthy ? 'POLLING' : 'NO POLLERS',
        help: `${taskQueue.name || taskQueue.taskQueue || 'skyserver-local'} · ${taskQueue.pollerCount || 0} poller(s)`,
        status: taskQueue.healthy ? 'POLLING' : 'DEGRADED',
      },
      {
        label: 'Worker heartbeat',
        value: loading ? '—' : worker.status || 'UNKNOWN',
        help: worker.latestHeartbeat
          ? `Last seen ${formatDate(worker.latestHeartbeat.lastSeenAt)}`
          : 'No SkyCommand Temporal worker heartbeat recorded yet',
        status: worker.status || 'UNKNOWN',
      },
      {
        label: 'Active runs',
        value: loading ? '—' : runs.active || 0,
        help: `${runs.running || 0} running · ${runs.queued || 0} queued · ${runs.staleRunning || 0} stale`,
        status: runs.staleRunning > 0 ? 'WARNING' : runs.active > 0 ? 'BUSY' : 'ONLINE',
      },
      {
        label: 'Runs 24h',
        value: loading ? '—' : runs.completedLast24h || 0,
        help: `${runs.failedLast24h || 0} failed · avg ${formatDuration(runs.averageDurationMs24h)}`,
        status: runs.failedLast24h > 0 ? 'WARNING' : 'ONLINE',
      },
      {
        label: 'Approvals',
        value: loading ? '—' : approvals.pending || 0,
        help: 'Pending human approval gates',
        status: approvals.pending > 0 ? 'WARNING' : 'ONLINE',
      },
    ];
  }, [health, loading]);

  const heartbeats = health?.worker?.heartbeats || [];
  const pollers = health?.taskQueue?.pollers || [];
  const hints = health?.hints || [];

  return (
    <>
      <header className="sky-page-header">
        <div>
          <div className="sky-page-kicker">Workflows · Worker health</div>
          <h1 className="sky-page-title">Worker Health</h1>
          <p className="sky-page-subtitle">
            Observe Temporal reachability, task queue pollers, SkyCommand worker heartbeats, run
            pressure, and approval gates before workflows enter the execution lane.
          </p>
        </div>
        <div className="text-md-end">
          <button className="btn sky-btn-ghost" disabled={loading} onClick={loadHealth} type="button">
            {loading ? 'Refreshing...' : 'Refresh health'}
          </button>
          <div className="small sky-muted mt-2">
            Last refresh: {refreshingAt ? formatDate(refreshingAt) : '—'}
          </div>
        </div>
      </header>

      {error && <div className="alert alert-danger">{error}</div>}

      <section className="sky-worker-hero mb-3">
        <div>
          <div className="d-flex align-items-center gap-2 mb-2">
            <span className={`sky-status-dot ${dotClass(health?.overallStatus)}`} />
            <span className={`sky-pill ${statusClass(health?.overallStatus)}`}>
              {health?.overallStatus || 'LOADING'}
            </span>
          </div>
          <h2 className="h4 mb-2">Temporal execution pulse</h2>
          <p className="sky-muted mb-3">
            Address {health?.temporal?.address || '—'} · Namespace {health?.temporal?.namespace || '—'} · Task queue{' '}
            {health?.taskQueue?.taskQueue || health?.taskQueue?.name || '—'}
          </p>
          {hints.length > 0 ? (
            <div className="alert alert-warning mb-0">
              <div className="fw-bold mb-1">Operator hints</div>
              <ul className="mb-0 ps-3">
                {hints.map((hint) => (
                  <li key={hint}>{hint}</li>
                ))}
              </ul>
            </div>
          ) : (
            <div className="alert alert-success mb-0">
              Temporal server, task queue polling, and SkyCommand worker heartbeat look healthy.
            </div>
          )}
        </div>

        <div className="sky-worker-command-strip">
          <div className="sky-worker-command-card">
            <div className="sky-page-kicker">Definitions</div>
            <div className="sky-worker-command-value">{health?.definitions?.published ?? '—'} published</div>
            <div className="small sky-muted mt-2">{health?.definitions?.active ?? '—'} active / {health?.definitions?.total ?? '—'} visible</div>
          </div>
          <div className="sky-worker-command-card">
            <div className="sky-page-kicker">Schedules</div>
            <div className="sky-worker-command-value">{health?.schedules?.active ?? '—'} active</div>
            <div className="small sky-muted mt-2">Next run {formatDate(health?.schedules?.nextRunAt)}</div>
          </div>
          <div className="sky-worker-command-card">
            <div className="sky-page-kicker">Task queue pollers</div>
            <div className="sky-worker-command-value">{health?.taskQueue?.pollerCount ?? '—'}</div>
            <div className="small sky-muted mt-2">Workflow {health?.taskQueue?.workflowPollerCount ?? 0} · Activity {health?.taskQueue?.activityPollerCount ?? 0}</div>
          </div>
        </div>
      </section>

      <div className="row g-3">
        {metricCards.map((card) => (
          <div className="col-md-6 col-xl-4" key={card.label}>
            <MetricCard {...card} />
          </div>
        ))}
      </div>


      <WorkerHealthVisuals
        health={health || {}}
        pendingApprovals={pendingApprovals}
        runs={recentRuns}
      />

      <div className="row g-3 mt-1 sky-workbench-row">
        <div className="col-xxl-8 col-xl-7 sky-workbench-main">
          <section className="sky-card sky-table-card h-100">
            <div className="sky-card-header">
              <h2 className="h5 mb-0">Worker heartbeats</h2>
              <div className="small sky-muted">SkyCommand Temporal worker process check-ins</div>
            </div>
            {heartbeats.length > 0 ? (
              <div className="table-responsive">
                <table className="table sky-table">
                  <thead>
                    <tr>
                      <th>Worker</th>
                      <th>Status</th>
                      <th>Last seen</th>
                      <th>PID</th>
                    </tr>
                  </thead>
                  <tbody>
                    {heartbeats.map((heartbeat) => (
                      <tr key={heartbeat.workerHeartbeatId || heartbeat.workerIdentity}>
                        <td>
                          <div className="fw-bold sky-detail-value sky-mono">{heartbeat.workerIdentity}</div>
                          <div className="small sky-muted">{heartbeat.hostname || '—'} · {heartbeat.taskQueue}</div>
                        </td>
                        <td>
                          <span className={`sky-pill ${statusClass(heartbeat.isRecent ? heartbeat.status : 'STALE')}`}>
                            {heartbeat.isRecent ? heartbeat.status : 'STALE'}
                          </span>
                        </td>
                        <td>{formatDate(heartbeat.lastSeenAt)}</td>
                        <td>{heartbeat.processId || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="sky-empty-state">No worker heartbeats recorded yet.</div>
            )}
          </section>
        </div>

        <div className="col-xxl-4 col-xl-5 sky-workbench-main">
          <section className="sky-card sky-table-card h-100">
            <div className="sky-card-header">
              <h2 className="h5 mb-0">Temporal pollers</h2>
              <div className="small sky-muted">Workers currently polling the configured task queue</div>
            </div>
            {pollers.length > 0 ? (
              <div className="sky-card-body">
                <div className="sky-session-list">
                  {pollers.map((poller) => (
                    <div className="sky-session-item" key={poller.identity}>
                      <div>
                        <div className="fw-bold sky-detail-value sky-mono">{poller.identity}</div>
                        <div className="small sky-muted">
                          {(poller.taskQueueTypes || []).join(' + ') || 'poller'}
                        </div>
                      </div>
                      <span className="sky-pill sky-pill-success">POLLING</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="sky-empty-state">No Temporal pollers reported for this task queue.</div>
            )}
          </section>
        </div>
      </div>

      <div className="row g-3 mt-1 sky-workbench-row">
        <div className="col-xxl-8 col-xl-8 sky-workbench-main">
          <section className="sky-card h-100">
            <div className="sky-card-header d-flex align-items-center justify-content-between gap-2">
              <div>
                <h2 className="h5 mb-0">Workflow run pressure</h2>
                <div className="small sky-muted">Recent completion, failure, approval, and stale-run indicators</div>
              </div>
              <Link className="btn btn-sm sky-btn-ghost" to="/workflows/history">
                Open history
              </Link>
            </div>
            <div className="sky-card-body">
              <div className="row g-3">
                <div className="col-md-3 col-6">
                  <div className="sky-mini-metric">
                    <div className="sky-page-kicker">Running</div>
                    <div className="sky-mini-metric-value">{health?.runs?.running || 0}</div>
                  </div>
                </div>
                <div className="col-md-3 col-6">
                  <div className="sky-mini-metric">
                    <div className="sky-page-kicker">Completed 24h</div>
                    <div className="sky-mini-metric-value">{health?.runs?.completedLast24h || 0}</div>
                  </div>
                </div>
                <div className="col-md-3 col-6">
                  <div className="sky-mini-metric">
                    <div className="sky-page-kicker">Failed 24h</div>
                    <div className="sky-mini-metric-value">{health?.runs?.failedLast24h || 0}</div>
                  </div>
                </div>
                <div className="col-md-3 col-6">
                  <div className="sky-mini-metric">
                    <div className="sky-page-kicker">Approvals</div>
                    <div className="sky-mini-metric-value">{health?.approvals?.pending || 0}</div>
                  </div>
                </div>
              </div>
            </div>
          </section>
        </div>

        <div className="col-xxl-4 col-xl-4 sky-workbench-main">
          <section className="sky-card h-100">
            <div className="sky-card-header">
              <h2 className="h5 mb-0">Operator commands</h2>
              <div className="small sky-muted">Local commands for the orchestration lane</div>
            </div>
            <div className="sky-card-body sky-worker-param-grid">
              <CommandCard label="Start Temporal" command={health?.cliCommands?.startTemporal} />
              <CommandCard label="Start worker" command={health?.cliCommands?.startWorker} />
              <CommandCard label="Describe task queue" command={health?.cliCommands?.describeTaskQueue} />
            </div>
          </section>
        </div>
      </div>
    </>
  );
}

export default WorkflowWorkerHealth;
