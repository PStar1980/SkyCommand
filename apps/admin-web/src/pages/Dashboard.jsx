import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import adminService from '../services/adminService';
import api from '../services/api';
import toolService from '../services/toolService';
import workerService from '../services/workerService';

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

function formatDateOnly(value) {
  if (!value) {
    return '—';
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return '—';
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
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

  const totalSeconds = Math.round(milliseconds / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  if (minutes === 0) {
    return `${totalSeconds} s`;
  }

  return `${minutes}m ${String(seconds).padStart(2, '0')}s`;
}

function statusClass(status) {
  if (status === 'SUCCESS' || status === 'CURRENT' || status === true) {
    return 'sky-pill-success';
  }

  if (status === 'FAILED' || status === 'ERROR' || status === false) {
    return 'sky-pill-danger';
  }

  if (status === 'STARTED' || status === 'RUNNING' || status === 'WARNING' || status === 'STALE') {
    return 'sky-pill-warning';
  }

  return 'sky-pill-info';
}

function dotClass(status) {
  if (status === 'SUCCESS' || status === 'CURRENT' || status === true) {
    return 'sky-status-dot-success';
  }

  if (status === 'FAILED' || status === 'ERROR' || status === false) {
    return 'sky-status-dot-danger';
  }

  if (status === 'STARTED' || status === 'RUNNING' || status === 'WARNING' || status === 'STALE') {
    return 'sky-status-dot-warning';
  }

  return 'sky-status-dot-info';
}

function resultClass(success) {
  if (success === true) {
    return 'sky-pill-success';
  }

  if (success === false) {
    return 'sky-pill-danger';
  }

  return 'sky-pill-info';
}

function getStatusLabel(status) {
  if (status === 'STARTED') {
    return 'RUNNING';
  }

  if (status === true) {
    return 'ONLINE';
  }

  if (status === false) {
    return 'OFFLINE';
  }

  return status || 'UNKNOWN';
}

function formatAction(value) {
  if (!value) {
    return '—';
  }

  return String(value)
    .replace(/[_-]+/g, ' ')
    .trim()
    .split(/\s+/)
    .map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1).toLowerCase()}`)
    .join(' ');
}

function getDisplaySummary(summary, fallback = '—') {
  if (!summary) {
    return fallback;
  }

  const lines = String(summary)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  return (
    lines.find((line) => /✅|successfully|connected|complete|completed/i.test(line)) ||
    lines.find((line) => !line.includes('[dotenv')) ||
    lines[0] ||
    String(summary)
  );
}

function buildToolLabelMap(tools = []) {
  return tools.reduce((toolLabels, tool) => {
    if (tool.toolCode) {
      toolLabels[tool.toolCode] = tool.label || tool.toolCode;
    }

    return toolLabels;
  }, {});
}

function getToolDisplayName(execution, toolLabels = {}) {
  if (!execution) {
    return '—';
  }

  return (
    execution.metadata?.toolLabel ||
    execution.toolLabel ||
    toolLabels[execution.scriptName] ||
    toolLabels[execution.script_name] ||
    execution.scriptName ||
    execution.script_name ||
    '—'
  );
}

function countByStatus(items = [], fieldName = 'status') {
  return items.reduce((counts, item) => {
    const status = item?.[fieldName] || 'UNKNOWN';

    counts[status] = (counts[status] || 0) + 1;
    return counts;
  }, {});
}

function sumMacroIndicators(indicatorCounts = []) {
  return indicatorCounts.reduce(
    (summary, item) => {
      summary.total += Number(item.total || 0);

      if (item.active) {
        summary.active += Number(item.total || 0);
      } else {
        summary.inactive += Number(item.total || 0);
      }

      return summary;
    },
    {
      total: 0,
      active: 0,
      inactive: 0,
    },
  );
}

function getPermissionCodes(permissions = []) {
  return new Set(permissions.map((permission) => permission.permissionCode).filter(Boolean));
}

function buildDashboardTask(label, value, to, permissionCode, permissionCodes) {
  return {
    label,
    value,
    to,
    visible: !permissionCode || permissionCodes.has(permissionCode),
  };
}

function Dashboard() {
  const { hasPermission, permissions, user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [refreshingAt, setRefreshingAt] = useState(null);
  const [summary, setSummary] = useState({
    apiHealth: null,
    dbHealth: null,
    tools: [],
    toolLabels: {},
    executions: {
      total: 0,
      items: [],
    },
    audits: {
      total: 0,
      items: [],
    },
    sessions: {
      total: 0,
      items: [],
    },
    ingestion: null,
    worker: null,
    macro: null,
    coreSettings: null,
    authSettings: null,
  });
  const [error, setError] = useState('');

  const permissionCodes = useMemo(() => getPermissionCodes(permissions), [permissions]);
  const permissionCount = permissions.length;

  const visibleToolsCount = summary.tools.length;
  const recentExecutions = summary.executions.items || [];
  const recentAudits = summary.audits.items || [];
  const activeSessions = summary.sessions.items || [];
  const runningExecutions = recentExecutions.filter((execution) => execution.status === 'STARTED');
  const failedExecutions = recentExecutions.filter((execution) => execution.status === 'FAILED');
  const failedAuditEvents = recentAudits.filter((audit) => audit.success === false);
  const ingestionCounts = useMemo(() => {
    const ingestion = summary.ingestion || {};
    const sources = ingestion.sources || [];

    const sourceTotals = sources.reduce(
      (totals, source) => {
        totals.totalIndicators += Number(source.counts?.total || 0);
        totals.activeIndicators += Number(source.counts?.active || 0);
        totals.inactiveIndicators += Number(source.counts?.inactive || 0);
        totals.currentIndicators += Number(source.counts?.current || 0);
        totals.staleIndicators += Number(source.counts?.stale || 0);
        totals.noDataIndicators += Number(source.counts?.noData || 0);
        totals.missingTableIndicators += Number(source.counts?.missingTable || 0);
        totals.errorIndicators += Number(source.counts?.error || 0);
        return totals;
      },
      {
        totalIndicators: 0,
        activeIndicators: 0,
        inactiveIndicators: 0,
        currentIndicators: 0,
        staleIndicators: 0,
        noDataIndicators: 0,
        missingTableIndicators: 0,
        errorIndicators: 0,
      },
    );

    return {
      totalIndicators: Number(ingestion.totalIndicators ?? sourceTotals.totalIndicators),
      activeIndicators: Number(ingestion.activeIndicators ?? sourceTotals.activeIndicators),
      inactiveIndicators: Number(ingestion.inactiveIndicators ?? sourceTotals.inactiveIndicators),
      currentIndicators: Number(ingestion.currentIndicators ?? sourceTotals.currentIndicators),
      staleIndicators: Number(ingestion.staleIndicators ?? sourceTotals.staleIndicators),
      noDataIndicators: Number(ingestion.noDataIndicators ?? sourceTotals.noDataIndicators),
      missingTableIndicators: Number(
        ingestion.missingTableIndicators ?? sourceTotals.missingTableIndicators,
      ),
      errorIndicators: Number(ingestion.errorIndicators ?? sourceTotals.errorIndicators),
    };
  }, [summary.ingestion]);
  const sourceHealth = summary.ingestion?.sources || [];
  const workerHealth = summary.worker || null;
  const workerSchedules = workerHealth?.schedules || {};
  const workerNodes = workerHealth?.nodes || {};
  const workerRuns24h = workerHealth?.runs24h || {};
  const macroIndicators = sumMacroIndicators(summary.macro?.indicatorCounts || []);
  const executionStatusCounts = countByStatus(recentExecutions);
  const sourceStatusCounts = countByStatus(sourceHealth);

  const systemStatus = useMemo(() => {
    if (summary.apiHealth?.ok === false || summary.dbHealth?.ok === false) {
      return 'ERROR';
    }

    if (summary.ingestion?.overallStatus === 'ERROR') {
      return 'ERROR';
    }

    if (
      summary.ingestion?.overallStatus === 'WARNING' ||
      summary.worker?.overallStatus === 'WARNING' ||
      failedExecutions.length > 0 ||
      failedAuditEvents.length > 0
    ) {
      return 'WARNING';
    }

    if (summary.apiHealth?.ok && summary.dbHealth?.ok) {
      return 'CURRENT';
    }

    return 'UNKNOWN';
  }, [
    failedAuditEvents.length,
    failedExecutions.length,
    summary.apiHealth,
    summary.dbHealth,
    summary.ingestion,
    summary.worker,
  ]);

  const dashboardTasks = useMemo(
    () =>
      [
        buildDashboardTask(
          'Run tools',
          visibleToolsCount,
          '/tools',
          'CORE_VIEW_TOOLS',
          permissionCodes,
        ),
        buildDashboardTask(
          'Review ingestion',
          summary.ingestion?.overallStatus || '—',
          '/ingestion-status',
          'INGESTION_VIEW_STATUS',
          permissionCodes,
        ),
        buildDashboardTask(
          'Automation',
          summary.worker?.overallStatus || '—',
          '/automation/scheduler',
          'WORKER_SCHEDULE_READ',
          permissionCodes,
        ),
        buildDashboardTask(
          'Inspect executions',
          summary.executions.total,
          '/script-executions',
          'SCRIPT_EXECUTION_READ',
          permissionCodes,
        ),
        buildDashboardTask(
          'Audit activity',
          summary.audits.total,
          '/audit-events',
          'AUDIT_READ',
          permissionCodes,
        ),
        buildDashboardTask(
          'Manage users',
          summary.sessions.total,
          '/admin/users',
          'ADMIN_USER_READ',
          permissionCodes,
        ),
      ].filter((task) => task.visible),
    [
      permissionCodes,
      summary.audits.total,
      summary.executions.total,
      summary.ingestion?.overallStatus,
      summary.worker?.overallStatus,
      summary.sessions.total,
      visibleToolsCount,
    ],
  );

  const statCards = useMemo(
    () => [
      {
        label: 'System',
        value: loading ? '—' : getStatusLabel(systemStatus),
        help:
          systemStatus === 'CURRENT'
            ? 'API, database, and visible operations look healthy'
            : 'Review warning/error panels below',
        status: systemStatus,
      },
      {
        label: 'API / DB',
        value: loading
          ? '—'
          : `${summary.apiHealth?.ok ? 'API' : 'API?'} / ${summary.dbHealth?.ok ? 'DB' : 'DB?'}`,
        help: summary.dbHealth?.database
          ? `Connected to ${summary.dbHealth.database}`
          : 'Raw service health checks',
        status: summary.apiHealth?.ok && summary.dbHealth?.ok ? 'CURRENT' : 'WARNING',
      },
      {
        label: 'Ingestion',
        value: loading ? '—' : summary.ingestion?.overallStatus || '—',
        help: loading
          ? 'Loading pipeline status'
          : `${ingestionCounts.currentIndicators || 0} current / ${
              ingestionCounts.staleIndicators || 0
            } stale`,
        status: summary.ingestion?.overallStatus || 'UNKNOWN',
      },
      {
        label: 'Automation',
        value: loading ? '—' : workerHealth?.overallStatus || '—',
        help: loading
          ? 'Loading worker status'
          : `${workerNodes.online || 0} node(s) online / ${workerSchedules.enabled || 0} schedule(s) enabled`,
        status: workerHealth?.overallStatus || 'UNKNOWN',
      },
      {
        label: 'Sessions',
        value: loading ? '—' : summary.sessions.total,
        help: 'Active authenticated sessions',
        status: summary.sessions.total > 0 ? 'CURRENT' : 'INFO',
      },
      {
        label: 'Tools',
        value: loading ? '—' : visibleToolsCount,
        help: 'Permission-filtered Admin-Web tools',
        status: visibleToolsCount > 0 ? 'CURRENT' : 'INFO',
      },
      {
        label: 'Executions',
        value: loading ? '—' : summary.executions.total,
        help: `${runningExecutions.length} running / ${failedExecutions.length} failed in recent load`,
        status: failedExecutions.length > 0 ? 'WARNING' : 'CURRENT',
      },
      {
        label: 'Audit events',
        value: loading ? '—' : summary.audits.total,
        help: `${failedAuditEvents.length} denied or failed in recent load`,
        status: failedAuditEvents.length > 0 ? 'WARNING' : 'CURRENT',
      },
      {
        label: 'Macro views',
        value: loading ? '—' : (summary.macro?.viewCount ?? '—'),
        help:
          summary.macro && macroIndicators.total
            ? `${macroIndicators.active} active indicators`
            : 'Macro summary visibility',
        status: summary.macro ? 'CURRENT' : 'INFO',
      },
    ],
    [
      failedAuditEvents.length,
      failedExecutions.length,
      ingestionCounts.currentIndicators,
      ingestionCounts.staleIndicators,
      loading,
      macroIndicators.active,
      macroIndicators.total,
      runningExecutions.length,
      workerHealth,
      workerNodes.online,
      workerSchedules.enabled,
      summary.apiHealth,
      summary.audits.total,
      summary.dbHealth,
      summary.executions.total,
      summary.ingestion,
      summary.macro,
      summary.sessions.total,
      systemStatus,
      visibleToolsCount,
    ],
  );

  async function loadOptional(name, loader) {
    try {
      return await loader();
    } catch (loadError) {
      console.warn(`[SkyServer Dashboard] Optional panel failed: ${name}`, loadError);
      return null;
    }
  }

  async function loadDashboard() {
    setLoading(true);
    setError('');

    try {
      const [
        apiHealth,
        dbHealth,
        toolsResult,
        executionsResult,
        auditResult,
        sessionsResult,
        ingestionResult,
        workerResult,
        macroResult,
        coreSettingsResult,
        authSettingsResult,
      ] = await Promise.all([
        loadOptional('api-health', () => api.get('/_health')),
        loadOptional('db-health', () => api.get('/_db/health')),
        hasPermission('CORE_VIEW_TOOLS')
          ? loadOptional('tools', () => toolService.listTools())
          : Promise.resolve(null),
        hasPermission('SCRIPT_EXECUTION_READ')
          ? loadOptional('executions', () => adminService.listScriptExecutions({ limit: 8 }))
          : Promise.resolve(null),
        hasPermission('AUDIT_READ')
          ? loadOptional('audit', () => adminService.listAuditEvents({ limit: 8 }))
          : Promise.resolve(null),
        hasPermission('ADMIN_USER_READ')
          ? loadOptional('sessions', () => adminService.listActiveSessions({ limit: 8 }))
          : Promise.resolve(null),
        hasPermission('INGESTION_VIEW_STATUS')
          ? loadOptional('ingestion', () =>
              api.get('/api/ingestion/status', { query: { recentLimit: 6 } }),
            )
          : Promise.resolve(null),
        hasPermission('WORKER_SCHEDULE_READ')
          ? loadOptional('worker', () => workerService.getHealth())
          : Promise.resolve(null),
        hasPermission('MACRO_VIEW_READ')
          ? loadOptional('macro', () => api.get('/api/macro/summary'))
          : Promise.resolve(null),
        hasPermission('ADMIN_ROLE_READ')
          ? loadOptional('core-settings', () => adminService.getCoreSettings())
          : Promise.resolve(null),
        hasPermission('ADMIN_USER_READ')
          ? loadOptional('auth-settings', () => adminService.getAuthSettings())
          : Promise.resolve(null),
      ]);

      setSummary({
        apiHealth,
        dbHealth,
        tools: toolsResult?.tools || [],
        toolLabels: buildToolLabelMap(toolsResult?.tools || []),
        executions: {
          total: executionsResult?.total || 0,
          items: executionsResult?.items || [],
        },
        audits: {
          total: auditResult?.total || 0,
          items: auditResult?.items || [],
        },
        sessions: {
          total: sessionsResult?.total || 0,
          items: sessionsResult?.items || [],
        },
        ingestion: ingestionResult,
        worker: workerResult,
        macro: macroResult,
        coreSettings: coreSettingsResult,
        authSettings: authSettingsResult,
      });
      setRefreshingAt(new Date());
    } catch (loadError) {
      setError(loadError.message || 'Failed to load dashboard.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let active = true;

    async function guardedLoadDashboard() {
      await loadDashboard();

      if (!active) {
        return;
      }
    }

    guardedLoadDashboard();

    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      <header className="sky-page-header">
        <div>
          <div className="sky-page-kicker">Command center</div>
          <h1 className="sky-page-title">SkyServer Admin</h1>
          <p className="sky-page-subtitle">
            Welcome back, {user?.displayName || user?.username || 'Operator'}. This is the private
            cockpit for API health, database status, macro ingestion, tools, sessions, executions,
            and audit activity.
          </p>
        </div>

        <div className="text-md-end">
          <button
            className="btn sky-btn-ghost"
            disabled={loading}
            onClick={loadDashboard}
            type="button"
          >
            {loading ? 'Refreshing...' : 'Refresh dashboard'}
          </button>
          <div className="small sky-muted mt-2">
            Last refresh: {refreshingAt ? formatDate(refreshingAt) : '—'}
          </div>
        </div>
      </header>

      {error && <div className="alert alert-danger">{error}</div>}

      <section className="sky-dashboard-hero mb-3">
        <div>
          <div className="d-flex align-items-center gap-2 mb-2">
            <span className={`sky-status-dot ${dotClass(systemStatus)}`} />
            <span className={`sky-pill ${statusClass(systemStatus)}`}>
              {getStatusLabel(systemStatus)}
            </span>
          </div>
          <h2 className="h4 mb-2">Operational pulse</h2>
          <p className="sky-muted mb-0">
            API {summary.apiHealth?.ok ? 'online' : 'unknown'} · Database{' '}
            {summary.dbHealth?.ok ? 'online' : 'unknown'} · Ingestion{' '}
            {summary.ingestion?.overallStatus || 'not loaded'} · Automation{' '}
            {summary.worker?.overallStatus || 'not loaded'} · Permissions {permissionCount}
          </p>
        </div>

        <div className="sky-dashboard-task-strip">
          {dashboardTasks.map((task) => (
            <Link className="sky-dashboard-task" key={task.label} to={task.to}>
              <div className="sky-page-kicker">{task.label}</div>
              <div className="sky-dashboard-task-value">{task.value}</div>
            </Link>
          ))}
        </div>
      </section>

      <div className="row g-3">
        {statCards.map((card) => (
          <div className="col-sm-6 col-xl-3" key={card.label}>
            <section className="sky-card sky-stat-card sky-dashboard-stat-card">
              <div className="sky-card-body">
                <div className="d-flex align-items-start justify-content-between gap-2">
                  <div>
                    <div className="sky-page-kicker">{card.label}</div>
                    <div className="sky-stat-value">{card.value}</div>
                  </div>
                  <span className={`sky-status-dot ${dotClass(card.status)}`} />
                </div>
                <div className="sky-muted small mt-2">{card.help}</div>
              </div>
            </section>
          </div>
        ))}
      </div>

      <div className="row g-3 mt-1">
        <div className="col-xl-8">
          <section className="sky-card sky-table-card h-100">
            <div className="sky-card-header d-flex align-items-center justify-content-between gap-2">
              <div>
                <h2 className="h5 mb-0">Pipeline health</h2>
                <div className="small sky-muted">Source freshness and indicator health</div>
              </div>
              {hasPermission('INGESTION_VIEW_STATUS') && (
                <Link className="btn btn-sm sky-btn-ghost" to="/ingestion-status">
                  Open ingestion
                </Link>
              )}
            </div>

            {summary.ingestion ? (
              <div className="sky-card-body">
                <div className="row g-3 mb-3">
                  <div className="col-md-3 col-6">
                    <div className="sky-mini-metric">
                      <div className="sky-page-kicker">Current</div>
                      <div className="sky-mini-metric-value">
                        {ingestionCounts.currentIndicators || 0}
                      </div>
                    </div>
                  </div>
                  <div className="col-md-3 col-6">
                    <div className="sky-mini-metric">
                      <div className="sky-page-kicker">Stale</div>
                      <div className="sky-mini-metric-value">
                        {ingestionCounts.staleIndicators || 0}
                      </div>
                    </div>
                  </div>
                  <div className="col-md-3 col-6">
                    <div className="sky-mini-metric">
                      <div className="sky-page-kicker">No data</div>
                      <div className="sky-mini-metric-value">
                        {ingestionCounts.noDataIndicators || 0}
                      </div>
                    </div>
                  </div>
                  <div className="col-md-3 col-6">
                    <div className="sky-mini-metric">
                      <div className="sky-page-kicker">Errors</div>
                      <div className="sky-mini-metric-value">
                        {(ingestionCounts.errorIndicators || 0) +
                          (ingestionCounts.missingTableIndicators || 0)}
                      </div>
                    </div>
                  </div>
                </div>

                <div className="table-responsive">
                  <table className="table sky-table">
                    <thead>
                      <tr>
                        <th>Source</th>
                        <th>Status</th>
                        <th>Current</th>
                        <th>Stale</th>
                        <th>Latest data</th>
                        <th>Last run</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sourceHealth.map((source) => (
                        <tr key={source.source}>
                          <td>
                            <div className="fw-bold sky-detail-value">{source.label}</div>
                            <div className="small sky-muted">{source.provider}</div>
                          </td>
                          <td>
                            <span className={`sky-pill ${statusClass(source.status)}`}>
                              {source.status}
                            </span>
                          </td>
                          <td>{source.counts?.current ?? 0}</td>
                          <td>{source.counts?.stale ?? 0}</td>
                          <td>{formatDateOnly(source.latestDataDate)}</td>
                          <td>
                            <span
                              className={`sky-pill ${statusClass(source.latestExecution?.status)}`}
                            >
                              {source.latestExecution?.status || '—'}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="small sky-muted mt-3">
                  Source statuses: CURRENT {sourceStatusCounts.CURRENT || 0} · WARNING{' '}
                  {sourceStatusCounts.WARNING || 0} · ERROR {sourceStatusCounts.ERROR || 0}
                </div>
              </div>
            ) : (
              <div className="sky-empty-state">
                {hasPermission('INGESTION_VIEW_STATUS')
                  ? 'Ingestion status could not be loaded.'
                  : 'Ingestion status requires INGESTION_VIEW_STATUS.'}
              </div>
            )}
          </section>
        </div>

        <div className="col-xl-4">
          <section className="sky-card h-100">
            <div className="sky-card-header">
              <h2 className="h5 mb-0">System surface</h2>
              <div className="small sky-muted">API, database, auth, and core config</div>
            </div>

            <div className="sky-card-body">
              <dl className="row g-2 mb-0">
                <dt className="col-5 sky-detail-label">API</dt>
                <dd className="col-7">
                  <span className={`sky-pill ${statusClass(summary.apiHealth?.ok)}`}>
                    {summary.apiHealth?.ok ? 'ONLINE' : 'UNKNOWN'}
                  </span>
                </dd>

                <dt className="col-5 sky-detail-label">Database</dt>
                <dd className="col-7">
                  <span className={`sky-pill ${statusClass(summary.dbHealth?.ok)}`}>
                    {summary.dbHealth?.ok ? summary.dbHealth.database || 'ONLINE' : 'UNKNOWN'}
                  </span>
                </dd>

                <dt className="col-5 sky-detail-label">Session minutes</dt>
                <dd className="col-7 sky-detail-value">
                  {summary.authSettings?.auth?.sessionMinutes ?? '—'}
                </dd>

                <dt className="col-5 sky-detail-label">Core tools</dt>
                <dd className="col-7 sky-detail-value">
                  {summary.coreSettings?.toolSummary?.enabled_tool_count ??
                    summary.coreSettings?.toolSummary?.enabledToolCount ??
                    '—'}
                  {' / '}
                  {summary.coreSettings?.toolSummary?.tool_count ??
                    summary.coreSettings?.toolSummary?.toolCount ??
                    '—'}
                </dd>

                <dt className="col-5 sky-detail-label">Repositories</dt>
                <dd className="col-7 sky-detail-value">
                  {summary.coreSettings?.repositories?.length ?? '—'}
                </dd>

                <dt className="col-5 sky-detail-label">Runtimes</dt>
                <dd className="col-7 sky-detail-value">
                  {summary.coreSettings?.runtimes?.length ?? '—'}
                </dd>
              </dl>

              <hr />

              <div className="sky-page-kicker">Macro plane</div>
              {summary.macro ? (
                <>
                  <div className="d-flex justify-content-between gap-3 mb-2">
                    <span className="sky-muted">Views</span>
                    <span className="fw-bold sky-detail-value">{summary.macro.viewCount}</span>
                  </div>
                  <div className="d-flex justify-content-between gap-3 mb-2">
                    <span className="sky-muted">Indicators</span>
                    <span className="fw-bold sky-detail-value">{macroIndicators.total}</span>
                  </div>
                  <div className="d-flex justify-content-between gap-3">
                    <span className="sky-muted">Active indicators</span>
                    <span className="fw-bold sky-detail-value">{macroIndicators.active}</span>
                  </div>
                </>
              ) : (
                <div className="sky-muted small">Macro summary requires MACRO_VIEW_READ.</div>
              )}
            </div>
          </section>
        </div>
      </div>

      <div className="row g-3 mt-1">
        <div className="col-12">
          <section className="sky-card sky-table-card">
            <div className="sky-card-header d-flex align-items-center justify-content-between gap-2">
              <div>
                <h2 className="h5 mb-0">Automation health</h2>
                <div className="small sky-muted">
                  Background worker nodes, active schedules, and recent scheduler runs
                </div>
              </div>
              {hasPermission('WORKER_SCHEDULE_READ') && (
                <Link className="btn btn-sm sky-btn-ghost" to="/automation/scheduler">
                  Open scheduler
                </Link>
              )}
            </div>

            {workerHealth ? (
              <div className="sky-card-body">
                <div className="row g-3">
                  <div className="col-md-3 col-6">
                    <div className="sky-mini-metric">
                      <div className="sky-page-kicker">Status</div>
                      <div className="sky-mini-metric-value">
                        {workerHealth.overallStatus || '—'}
                      </div>
                    </div>
                  </div>
                  <div className="col-md-3 col-6">
                    <div className="sky-mini-metric">
                      <div className="sky-page-kicker">Nodes online</div>
                      <div className="sky-mini-metric-value">{workerNodes.online || 0}</div>
                    </div>
                  </div>
                  <div className="col-md-3 col-6">
                    <div className="sky-mini-metric">
                      <div className="sky-page-kicker">Active schedules</div>
                      <div className="sky-mini-metric-value">{workerSchedules.total || 0}</div>
                    </div>
                  </div>
                  <div className="col-md-3 col-6">
                    <div className="sky-mini-metric">
                      <div className="sky-page-kicker">Runs 24h</div>
                      <div className="sky-mini-metric-value">{workerRuns24h.total || 0}</div>
                    </div>
                  </div>
                </div>
                <div className="small sky-muted mt-3">
                  Enabled {workerSchedules.enabled || 0} · Due {workerSchedules.due || 0} · Failed{' '}
                  {workerSchedules.failed || 0} · Next run {formatDate(workerSchedules.nextRunAt)}
                </div>
              </div>
            ) : (
              <div className="sky-empty-state">
                {hasPermission('WORKER_SCHEDULE_READ')
                  ? 'Automation status could not be loaded.'
                  : 'Automation status requires WORKER_SCHEDULE_READ.'}
              </div>
            )}
          </section>
        </div>
      </div>

      <div className="row g-3 mt-1">
        <div className="col-xl-6">
          <section className="sky-card sky-table-card h-100">
            <div className="sky-card-header d-flex align-items-center justify-content-between gap-2">
              <div>
                <h2 className="h5 mb-0">Latest executions</h2>
                <div className="small sky-muted">Recent script/tool activity</div>
              </div>
              {hasPermission('SCRIPT_EXECUTION_READ') && (
                <Link className="btn btn-sm sky-btn-ghost" to="/script-executions">
                  Open executions
                </Link>
              )}
            </div>

            {recentExecutions.length > 0 ? (
              <div className="table-responsive">
                <table className="table sky-table">
                  <thead>
                    <tr>
                      <th>Tool</th>
                      <th>Status</th>
                      <th>Duration</th>
                      <th>Started</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recentExecutions.slice(0, 6).map((execution) => (
                      <tr key={execution.executionId}>
                        <td>
                          <div className="fw-bold sky-detail-value">
                            {getToolDisplayName(execution, summary.toolLabels)}
                          </div>
                          <div className="small sky-muted sky-mono">{execution.scriptName}</div>
                        </td>
                        <td>
                          <span className={`sky-pill ${statusClass(execution.status)}`}>
                            {getStatusLabel(execution.status)}
                          </span>
                        </td>
                        <td>{formatDuration(execution.durationMs)}</td>
                        <td>{formatDate(execution.startedAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="sky-empty-state">
                {hasPermission('SCRIPT_EXECUTION_READ')
                  ? 'No script executions found.'
                  : 'Execution history requires SCRIPT_EXECUTION_READ.'}
              </div>
            )}

            {recentExecutions.length > 0 && (
              <div className="sky-card-body border-top border-secondary border-opacity-25">
                <span className="sky-muted small">
                  Loaded statuses: SUCCESS {executionStatusCounts.SUCCESS || 0} · RUNNING{' '}
                  {executionStatusCounts.STARTED || 0} · FAILED {executionStatusCounts.FAILED || 0}
                </span>
              </div>
            )}
          </section>
        </div>

        <div className="col-xl-6">
          <section className="sky-card sky-table-card h-100">
            <div className="sky-card-header d-flex align-items-center justify-content-between gap-2">
              <div>
                <h2 className="h5 mb-0">Latest audit</h2>
                <div className="small sky-muted">Authorization and operational trail</div>
              </div>
              {hasPermission('AUDIT_READ') && (
                <Link className="btn btn-sm sky-btn-ghost" to="/audit-events">
                  Open audit
                </Link>
              )}
            </div>

            {recentAudits.length > 0 ? (
              <div className="table-responsive">
                <table className="table sky-table">
                  <thead>
                    <tr>
                      <th>Action</th>
                      <th>Result</th>
                      <th>Message</th>
                      <th>Created</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recentAudits.slice(0, 6).map((audit) => (
                      <tr key={audit.auditEventId}>
                        <td>
                          <div className="fw-bold sky-detail-value">
                            {formatAction(audit.action)}
                          </div>
                          <div className="small sky-muted">{audit.resourceType || '—'}</div>
                        </td>
                        <td>
                          <span className={`sky-pill ${resultClass(audit.success)}`}>
                            {audit.success === true
                              ? 'SUCCESS'
                              : audit.success === false
                                ? 'FAILED'
                                : 'UNKNOWN'}
                          </span>
                        </td>
                        <td>
                          <div className="sky-truncate">{audit.message || '—'}</div>
                        </td>
                        <td>{formatDate(audit.createdAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="sky-empty-state">
                {hasPermission('AUDIT_READ')
                  ? 'No audit events found.'
                  : 'Audit history requires AUDIT_READ.'}
              </div>
            )}
          </section>
        </div>
      </div>

      <div className="row g-3 mt-1">
        <div className="col-xl-5">
          <section className="sky-card h-100">
            <div className="sky-card-header d-flex align-items-center justify-content-between gap-2">
              <div>
                <h2 className="h5 mb-0">Active sessions</h2>
                <div className="small sky-muted">Current authenticated operators</div>
              </div>
              {hasPermission('ADMIN_USER_READ') && (
                <Link className="btn btn-sm sky-btn-ghost" to="/admin/users">
                  Open users
                </Link>
              )}
            </div>

            {activeSessions.length > 0 ? (
              <div className="sky-card-body">
                <div className="sky-session-list">
                  {activeSessions.slice(0, 6).map((session) => (
                    <div className="sky-session-item" key={session.sessionId}>
                      <div>
                        <div className="fw-bold sky-detail-value">
                          {session.displayName || session.username || session.email || 'Unknown'}
                        </div>
                        <div className="small sky-muted">
                          Last seen {formatDate(session.lastSeenAt)}
                        </div>
                      </div>
                      <span className="sky-pill sky-pill-success">ACTIVE</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="sky-empty-state">
                {hasPermission('ADMIN_USER_READ')
                  ? 'No active sessions returned.'
                  : 'Active session view requires ADMIN_USER_READ.'}
              </div>
            )}
          </section>
        </div>

        <div className="col-xl-7">
          <section className="sky-card h-100">
            <div className="sky-card-header">
              <h2 className="h5 mb-0">Operator permissions</h2>
              <div className="small sky-muted">Current session capability surface</div>
            </div>

            <div className="sky-card-body">
              <div className="d-flex flex-wrap gap-2">
                {permissions.length > 0 ? (
                  permissions.map((permission) => (
                    <span className="sky-pill" key={permission.permissionCode}>
                      {permission.permissionCode}
                    </span>
                  ))
                ) : (
                  <div className="sky-empty-state w-100 py-4">No permissions loaded.</div>
                )}
              </div>
            </div>
          </section>
        </div>
      </div>
    </>
  );
}

export default Dashboard;
