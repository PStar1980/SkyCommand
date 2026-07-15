import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import ApplicationUserSummaryRow from '../components/charts/ApplicationUserSummaryRow.jsx';
import DashboardVisuals from '../components/charts/DashboardVisuals.jsx';
import DashboardFilterCard from '../components/ui/DashboardFilterCard.jsx';
import PageHeader from '../components/ui/PageHeader.jsx';
import SmartPollingStatus from '../components/ui/SmartPollingStatus.jsx';
import StatCard from '../components/ui/StatCard.jsx';
import {
  StatusDot,
  getStatusClass,
  getStatusLabel,
} from '../components/ui/StatusPill.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import useSmartPolling, {
  SMART_POLLING_INTERVALS,
  getSmartPollingDelay,
} from '../hooks/useSmartPolling.js';
import adminService from '../services/adminService';
import api from '../services/api';
import toolService from '../services/toolService';
import workerService from '../services/workerService';
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

function Dashboard() {
  const { hasPermission, user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [refreshingAt, setRefreshingAt] = useState(null);
  const [summary, setSummary] = useState({
    apiHealth: null,
    dbHealth: null,
    tools: [],
    executions: {
      total: 0,
      items: [],
    },
    audits: {
      total: 0,
      items: [],
    },
    userSummaries: {
      skyCommand: null,
      skyWeb: null,
    },
    ingestion: null,
    worker: null,
    workflowHealth: null,
    workflowRunsDetailed: {
      total: 0,
      items: [],
    },
    productionReadiness: null,
    macro: null,
    coreSettings: null,
    authSettings: null,
  });
  const [error, setError] = useState('');
  const [dashboardFilters, setDashboardFilters] = useState({
    executionStatus: '',
    recentLimit: '60',
    workflowStatus: '',
  });

  const visibleToolsCount = summary.tools.length;
  const recentExecutions = summary.executions.items || [];
  const recentAudits = summary.audits.items || [];
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
  const workflowHealth = summary.workflowHealth || null;
  const workflowRunRecords = summary.workflowRunsDetailed?.items || [];
  const productionReadiness = summary.productionReadiness || null;
  const workflowRuns = workflowHealth?.runs || {};
  const workflowTaskQueue = workflowHealth?.taskQueue || {};
  const workflowWorker = workflowHealth?.worker || {};
  const macroIndicators = sumMacroIndicators(summary.macro?.indicatorCounts || []);
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
      ['WARNING', 'DEGRADED', 'OFFLINE'].includes(workflowHealth?.overallStatus) ||
      ['WARNING', 'FAIL'].includes(productionReadiness?.overallStatus) ||
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
    workflowHealth?.overallStatus,
    productionReadiness?.overallStatus,
  ]);

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
        label: 'API & DB',
        value: loading
          ? '—'
          : `${summary.apiHealth?.ok ? 'API' : 'API?'} / ${summary.dbHealth?.ok ? 'DB' : 'DB?'}`,
        help: summary.dbHealth?.database
          ? `Connected to ${summary.dbHealth.database}`
          : 'Core service health checks',
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
        label: 'Workflows',
        value: loading ? '—' : workflowHealth?.overallStatus || '—',
        help: loading
          ? 'Loading Temporal worker health'
          : `${workflowRuns.active || 0} active / ${workflowTaskQueue.pollerCount || 0} poller(s)`,
        status: workflowHealth?.overallStatus || 'UNKNOWN',
      },
      {
        label: 'Task queue',
        value: loading ? '—' : workflowTaskQueue.healthy ? 'POLLING' : 'CHECK',
        help: `${workflowTaskQueue.taskQueue || workflowTaskQueue.name || 'skyserver-local'} · ${workflowWorker.status || 'worker unknown'}`,
        status: workflowTaskQueue.healthy ? 'CURRENT' : 'WARNING',
      },
      {
        label: 'Readiness',
        value: loading ? '—' : productionReadiness?.overallStatus || '—',
        help: loading
          ? 'Loading production checklist'
          : `${productionReadiness?.counts?.pass || 0} pass / ${productionReadiness?.counts?.warning || 0} warning / ${productionReadiness?.counts?.fail || 0} fail`,
        status: productionReadiness?.overallStatus || 'UNKNOWN',
      },
      {
        label: 'Sessions',
        value: loading
          ? '—'
          : summary.userSummaries.skyCommand?.summary?.activeSessions || 0,
        help: 'Active SkyCommand sessions',
        status:
          (summary.userSummaries.skyCommand?.summary?.activeSessions || 0) > 0
            ? 'CURRENT'
            : 'INFO',
      },
      {
        label: 'Tools',
        value: loading ? '—' : visibleToolsCount,
        help: 'Permission-filtered SkyCommand tools',
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
            : 'Macro analytics visibility',
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
      workflowHealth,
      workflowRuns.active,
      workflowTaskQueue.pollerCount,
      workflowTaskQueue.healthy,
      workflowTaskQueue.taskQueue,
      workflowTaskQueue.name,
      workflowWorker.status,
      productionReadiness,
      workerNodes.online,
      workerSchedules.enabled,
      summary.apiHealth,
      summary.audits.total,
      summary.dbHealth,
      summary.executions.total,
      summary.ingestion,
      summary.macro,
      summary.userSummaries.skyCommand?.summary?.activeSessions,
      systemStatus,
      visibleToolsCount,
    ],
  );

  const secondaryStatCards = statCards.filter((card) =>
    ['Sessions', 'Tools', 'Executions', 'Audit events', 'Macro views'].includes(card.label),
  );
  const dashboardRecentLimit = Number(dashboardFilters.recentLimit) || 60;
  const visualRecentExecutions = useMemo(() => {
    if (!dashboardFilters.executionStatus) {
      return recentExecutions;
    }

    return recentExecutions.filter(
      (execution) => String(execution.status || '').toUpperCase() === dashboardFilters.executionStatus,
    );
  }, [dashboardFilters.executionStatus, recentExecutions]);
  const visualWorkflowRuns = useMemo(() => {
    if (!dashboardFilters.workflowStatus) {
      return workflowRunRecords;
    }

    return workflowRunRecords.filter(
      (run) => String(run.status || '').toUpperCase() === dashboardFilters.workflowStatus,
    );
  }, [dashboardFilters.workflowStatus, workflowRunRecords]);

  function updateDashboardFilter(name, value) {
    setDashboardFilters((current) => ({ ...current, [name]: value }));
  }

  function resetDashboardFilters() {
    setDashboardFilters({ executionStatus: '', recentLimit: '60', workflowStatus: '' });
  }

  function applyDashboardFilters(event) {
    event.preventDefault();
    loadDashboard();
  }

  async function loadOptional(name, loader) {
    try {
      return await loader();
    } catch (loadError) {
      console.warn(`[SkyCommand Dashboard] Optional panel failed: ${name}`, loadError);
      return null;
    }
  }

  async function loadDashboard({ quiet = false } = {}) {
    if (!quiet) {
      setLoading(true);
      setError('');
    }

    try {
      const [
        apiHealth,
        dbHealth,
        toolsResult,
        executionsResult,
        auditResult,
        skyCommandUserResult,
        skyWebUserResult,
        ingestionResult,
        workerResult,
        workflowHealthResult,
        workflowRunsResult,
        productionReadinessResult,
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
          ? loadOptional('executions', () => adminService.listScriptExecutions({ limit: dashboardRecentLimit }))
          : Promise.resolve(null),
        hasPermission('AUDIT_READ')
          ? loadOptional('audit', () => adminService.listAuditEvents({ limit: dashboardRecentLimit }))
          : Promise.resolve(null),
        hasPermission('ADMIN_USER_READ')
          ? loadOptional('skycommand-user-summary', () =>
              adminService.getApplicationUserSummary({ appCode: 'SKYSERVER_ADMIN', days: 7 }),
            )
          : Promise.resolve(null),
        hasPermission('ADMIN_USER_READ')
          ? loadOptional('skyweb-user-summary', () =>
              adminService.getApplicationUserSummary({ appCode: 'SKYWEB', days: 7 }),
            )
          : Promise.resolve(null),
        hasPermission('INGESTION_VIEW_STATUS')
          ? loadOptional('ingestion', () =>
              api.get('/api/ingestion/status', { query: { recentLimit: 6 } }),
            )
          : Promise.resolve(null),
        hasPermission('WORKER_SCHEDULE_READ')
          ? loadOptional('worker', () => workerService.getHealth())
          : Promise.resolve(null),
        hasPermission('WORKFLOW_READ')
          ? loadOptional('workflow-health', () => workflowService.getWorkerHealth())
          : Promise.resolve(null),
        hasPermission('WORKFLOW_READ')
          ? loadOptional('workflow-runs', () => workflowService.listRuns({ limit: dashboardRecentLimit }))
          : Promise.resolve(null),
        hasPermission('ADMIN_REPOSITORY_READ')
          ? loadOptional('production-readiness', () => adminService.getProductionReadiness())
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

      const nextSummary = {
        apiHealth,
        dbHealth,
        tools: toolsResult?.tools || [],
        executions: {
          total: executionsResult?.total || 0,
          items: executionsResult?.items || [],
        },
        audits: {
          total: auditResult?.total || 0,
          items: auditResult?.items || [],
        },
        userSummaries: {
          skyCommand: skyCommandUserResult,
          skyWeb: skyWebUserResult,
        },
        ingestion: ingestionResult,
        worker: workerResult,
        workflowHealth: workflowHealthResult,
        workflowRunsDetailed: {
          total: workflowRunsResult?.total || 0,
          items: workflowRunsResult?.items || [],
        },
        productionReadiness: productionReadinessResult,
        macro: macroResult,
        coreSettings: coreSettingsResult,
        authSettings: authSettingsResult,
      };
      const nextRunningExecutions = nextSummary.executions.items.filter(
        (execution) => String(execution.status || '').toUpperCase() === 'STARTED',
      );
      const nextWorkflowRuns = nextSummary.workflowHealth?.runs || {};
      const nextActiveRuns = Number(nextWorkflowRuns.active || 0);

      setSummary(nextSummary);
      setRefreshingAt(new Date());

      return { activeCount: nextRunningExecutions.length + nextActiveRuns };
    } catch (loadError) {
      if (!quiet) {
        setError(loadError.message || 'Failed to load dashboard.');
      }
      throw loadError;
    } finally {
      if (!quiet) {
        setLoading(false);
      }
    }
  }

  const pollingState = useSmartPolling({
    getDelay: ({ activeCount = 0, hidden = false } = {}) =>
      getSmartPollingDelay({
        activeCount,
        activeMs: SMART_POLLING_INTERVALS.ACTIVE,
        hidden,
        idleMs: SMART_POLLING_INTERVALS.DASHBOARD_IDLE,
      }),
    initialIntervalMs: SMART_POLLING_INTERVALS.DASHBOARD_IDLE,
    onPoll: () => loadDashboard({ quiet: true }),
  });

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
      <PageHeader
        actions={
          <>
            <button
              className="btn sky-btn-ghost"
              disabled={loading}
              onClick={() => loadDashboard()}
              type="button"
            >
              {loading ? 'Refreshing...' : 'Refresh dashboard'}
            </button>
            <div className="small sky-muted mt-2">
              Last refresh: {refreshingAt ? formatDate(refreshingAt) : '—'}
            </div>
            <SmartPollingStatus
              activeLabel="Live runs"
              className="justify-content-end mt-2"
              state={pollingState}
            />
          </>
        }
        kicker="Workflow automation engine"
        subtitle={`Welcome back, ${user?.displayName || user?.username || 'Operator'}. Monitor automation health, workflow runtime, data pipelines, and application access signals from one command surface.`}
        title="Command Center"
      />

      {error && <div className="alert alert-danger">{error}</div>}

      <form onSubmit={applyDashboardFilters}>
        <DashboardFilterCard
          actions={
            <>
              <button className="btn sky-btn-primary" disabled={loading} type="submit">
                Apply filters
              </button>
              <button
                className="btn sky-btn-ghost"
                disabled={loading}
                onClick={resetDashboardFilters}
                type="button"
              >
                Reset
              </button>
            </>
          }
          meta={`${visualRecentExecutions.length} tool run(s) · ${visualWorkflowRuns.length} workflow run(s) · ${ingestionCounts.currentIndicators || 0} current indicator(s)`}
          title="Command Center analytics filters"
        >
          <div>
            <label className="form-label" htmlFor="overviewRecentLimit">
              Recent window
            </label>
            <select
              className="form-select sky-form-control"
              id="overviewRecentLimit"
              onChange={(event) => updateDashboardFilter('recentLimit', event.target.value)}
              value={dashboardFilters.recentLimit}
            >
              <option value="40">40 recent records</option>
              <option value="60">60 recent records</option>
              <option value="120">120 recent records</option>
            </select>
          </div>
          <div>
            <label className="form-label" htmlFor="overviewWorkflowStatus">
              Workflow status focus
            </label>
            <select
              className="form-select sky-form-control"
              id="overviewWorkflowStatus"
              onChange={(event) => updateDashboardFilter('workflowStatus', event.target.value)}
              value={dashboardFilters.workflowStatus}
            >
              <option value="">All workflow statuses</option>
              <option value="RUNNING">Running</option>
              <option value="COMPLETED">Completed</option>
              <option value="FAILED">Failed</option>
              <option value="TERMINATED">Terminated</option>
              <option value="CANCELED">Canceled</option>
            </select>
          </div>
          <div>
            <label className="form-label" htmlFor="overviewExecutionStatus">
              Tool status focus
            </label>
            <select
              className="form-select sky-form-control"
              id="overviewExecutionStatus"
              onChange={(event) => updateDashboardFilter('executionStatus', event.target.value)}
              value={dashboardFilters.executionStatus}
            >
              <option value="">All tool statuses</option>
              <option value="SUCCESS">Success</option>
              <option value="STARTED">Running</option>
              <option value="FAILED">Failed</option>
              <option value="TERMINATED">Terminated</option>
            </select>
          </div>
        </DashboardFilterCard>
      </form>

      <DashboardVisuals
        ingestionCounts={ingestionCounts}
        recentAudits={recentAudits}
        recentExecutions={visualRecentExecutions}
        systemStatusItems={[
          {
            label: 'API',
            value: summary.apiHealth?.ok ? 'Online' : 'Check',
            status: summary.apiHealth?.ok ? 'CURRENT' : 'WARNING',
            helper: 'Core API health',
          },
          {
            label: 'Database',
            value: summary.dbHealth?.ok ? 'Online' : 'Check',
            status: summary.dbHealth?.ok ? 'CURRENT' : 'WARNING',
            helper: summary.dbHealth?.database || 'Connection status',
          },
          {
            label: 'Worker',
            value: workerHealth?.overallStatus || 'Unknown',
            status: workerHealth?.overallStatus || 'UNKNOWN',
            helper: `${workerNodes.online || 0} node(s) online`,
          },
          {
            label: 'Temporal',
            value: workflowHealth?.temporal?.reachable ? 'Reachable' : 'Check',
            status: workflowHealth?.temporal?.reachable ? 'CURRENT' : 'WARNING',
            helper: workflowTaskQueue.taskQueue || workflowTaskQueue.name || 'Task queue',
          },
          {
            label: 'Readiness',
            value: productionReadiness?.overallStatus || 'Unknown',
            status: productionReadiness?.overallStatus || 'UNKNOWN',
            helper: `${productionReadiness?.counts?.pass || 0} pass / ${productionReadiness?.counts?.warning || 0} warning`,
          },
        ]}
        workflowRuns={visualWorkflowRuns}
      />

      <div className="sky-dashboard-section-heading mt-3 mb-2">
        <div>
          <div className="sky-page-kicker">Operational telemetry</div>
          <h2 className="h5 mb-0">Activity overview</h2>
        </div>
        <span className="sky-muted small">
          Sessions, tools, executions, audit, and macro activity
        </span>
      </div>

      <div className="row g-3">
        {secondaryStatCards.map((card) => (
          <div className="col-sm-6 col-xl" key={card.label}>
            <StatCard
              className="sky-dashboard-stat-card"
              helper={card.help}
              label={card.label}
              status={card.status}
              value={card.value}
            />
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
                <Link className="btn btn-sm sky-btn-ghost" to="/dashboard/data-pipeline">
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
                            <span className={`sky-pill ${getStatusClass(source.status)}`}>
                              {source.status}
                            </span>
                          </td>
                          <td>{source.counts?.current ?? 0}</td>
                          <td>{source.counts?.stale ?? 0}</td>
                          <td>{formatDateOnly(source.latestDataDate)}</td>
                          <td>
                            <span
                              className={`sky-pill ${getStatusClass(source.latestExecution?.status)}`}
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
              <h2 className="h5 mb-0">System foundation</h2>
              <div className="small sky-muted">
                API, database, authentication, and core configuration
              </div>
            </div>

            <div className="sky-card-body">
              <dl className="row g-2 mb-0">
                <dt className="col-5 sky-detail-label">API</dt>
                <dd className="col-7">
                  <span className={`sky-pill ${getStatusClass(summary.apiHealth?.ok)}`}>
                    {summary.apiHealth?.ok ? 'ONLINE' : 'UNKNOWN'}
                  </span>
                </dd>

                <dt className="col-5 sky-detail-label">Database</dt>
                <dd className="col-7">
                  <span className={`sky-pill ${getStatusClass(summary.dbHealth?.ok)}`}>
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

              <div className="sky-page-kicker">Macro intelligence</div>
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
          <section className="sky-card sky-table-card sky-dashboard-workflow-panel">
            <div className="sky-card-header d-flex align-items-center justify-content-between gap-2">
              <div>
                <div className="sky-page-kicker">Workflow runtime</div>
                <h2 className="h5 mb-0">Workflow operations</h2>
                <div className="small sky-muted">
                  Temporal reachability, task queue polling, run pressure, and approval gates
                </div>
              </div>
              {hasPermission('WORKFLOW_READ') && (
                <div className="d-flex flex-wrap gap-2">
                  <Link className="btn btn-sm sky-btn-ghost" to="/workflows/start">
                    Start workflow
                  </Link>
                  <Link className="btn btn-sm sky-btn-ghost" to="/workflows/worker-health">
                    Worker health
                  </Link>
                </div>
              )}
            </div>

            {workflowHealth ? (
              <div className="sky-card-body">
                <div className="sky-dashboard-workflow-grid">
                  <div className="sky-dashboard-workflow-status">
                    <StatusDot status={workflowHealth.overallStatus} />
                    <div>
                      <div className="sky-page-kicker">Runtime status</div>
                      <div className="sky-dashboard-command-value">
                        {workflowHealth.overallStatus || '—'}
                      </div>
                      <div className="sky-muted small">
                        Temporal {workflowHealth.temporal?.reachable ? 'online' : 'offline'} ·
                        Worker {workflowWorker.status || 'unknown'}
                      </div>
                    </div>
                  </div>

                  <div className="sky-mini-metric">
                    <div className="sky-page-kicker">Pollers</div>
                    <div className="sky-mini-metric-value">
                      {workflowTaskQueue.pollerCount || 0}
                    </div>
                    <div className="small sky-muted">
                      {workflowTaskQueue.taskQueue || workflowTaskQueue.name || 'skyserver-local'}
                    </div>
                  </div>
                  <div className="sky-mini-metric">
                    <div className="sky-page-kicker">Active runs</div>
                    <div className="sky-mini-metric-value">{workflowRuns.active || 0}</div>
                    <div className="small sky-muted">{workflowRuns.staleRunning || 0} stale</div>
                  </div>
                  <div className="sky-mini-metric">
                    <div className="sky-page-kicker">Completed 24h</div>
                    <div className="sky-mini-metric-value">
                      {workflowRuns.completedLast24h || 0}
                    </div>
                    <div className="small sky-muted">{workflowRuns.failedLast24h || 0} failed</div>
                  </div>
                  <div className="sky-mini-metric">
                    <div className="sky-page-kicker">Approvals</div>
                    <div className="sky-mini-metric-value">
                      {workflowHealth.approvals?.pending || 0}
                    </div>
                    <div className="small sky-muted">Pending human gates</div>
                  </div>
                </div>

                {(workflowHealth.hints || []).length > 0 && (
                  <div className="alert alert-warning mt-3 mb-0">
                    {(workflowHealth.hints || []).slice(0, 2).join(' ')}
                  </div>
                )}
              </div>
            ) : (
              <div className="sky-empty-state">
                {hasPermission('WORKFLOW_READ')
                  ? 'Workflow worker health could not be loaded.'
                  : 'Workflow health requires WORKFLOW_READ.'}
              </div>
            )}
          </section>
        </div>
      </div>

      <div className="row g-3 mt-1">
        <div className="col-12">
          <section className="sky-card sky-table-card">
            <div className="sky-card-header d-flex align-items-center justify-content-between gap-2">
              <div>
                <h2 className="h5 mb-0">Scheduler health</h2>
                <div className="small sky-muted">
                  Background worker nodes, active schedules, and recent automation runs
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

      <div className="mt-4">
        <ApplicationUserSummaryRow
          data={summary.userSummaries.skyCommand}
          loading={loading}
          title="SkyCommand User Summary"
        />
      </div>

      <div className="mt-3">
        <ApplicationUserSummaryRow
          data={summary.userSummaries.skyWeb}
          loading={loading}
          title="SkyWeb User Summary"
        />
      </div>
    </>
  );
}

export default Dashboard;
