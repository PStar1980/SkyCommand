import { useEffect, useMemo, useState } from 'react';
import ApplicationUserSummaryRow from '../components/charts/ApplicationUserSummaryRow.jsx';
import DashboardVisuals from '../components/charts/DashboardVisuals.jsx';
import DashboardRefreshActions from '../components/ui/DashboardRefreshActions.jsx';
import PageHeader from '../components/ui/PageHeader.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import useSmartPolling, {
  SMART_POLLING_INTERVALS,
  getSmartPollingDelay,
} from '../hooks/useSmartPolling.js';
import adminService from '../services/adminService';
import api from '../services/api';
import workerService from '../services/workerService';
import workflowService from '../services/workflowService';

const DASHBOARD_RECENT_LIMIT = 60;

function Dashboard() {
  const { hasPermission, user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [refreshingAt, setRefreshingAt] = useState(null);
  const [identityDays, setIdentityDays] = useState(7);
  const [summary, setSummary] = useState({
    apiHealth: null,
    dbHealth: null,
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
  });
  const [error, setError] = useState('');
  const recentExecutions = summary.executions.items || [];
  const recentAudits = summary.audits.items || [];
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
  const workerHealth = summary.worker || null;
  const workerNodes = workerHealth?.nodes || {};
  const workflowHealth = summary.workflowHealth || null;
  const workflowRunRecords = summary.workflowRunsDetailed?.items || [];
  const productionReadiness = summary.productionReadiness || null;
  const workflowTaskQueue = workflowHealth?.taskQueue || {};

  function changeIdentityWindow(event) {
    const nextDays = Number(event.target.value) || 7;
    setIdentityDays(nextDays);
    loadDashboard({ userSummaryDays: nextDays });
  }

  async function loadOptional(name, loader) {
    try {
      return await loader();
    } catch (loadError) {
      console.warn(`[SkyCommand Dashboard] Optional panel failed: ${name}`, loadError);
      return null;
    }
  }

  async function loadDashboard({ quiet = false, userSummaryDays = identityDays } = {}) {
    if (!quiet) {
      setLoading(true);
      setError('');
    }

    try {
      const [
        apiHealth,
        dbHealth,
        executionsResult,
        auditResult,
        skyCommandUserResult,
        skyWebUserResult,
        ingestionResult,
        workerResult,
        workflowHealthResult,
        workflowRunsResult,
        productionReadinessResult,
      ] = await Promise.all([
        loadOptional('api-health', () => api.get('/_health')),
        loadOptional('db-health', () => api.get('/_db/health')),
        hasPermission('SCRIPT_EXECUTION_READ')
          ? loadOptional('executions', () =>
              adminService.listScriptExecutions({ limit: DASHBOARD_RECENT_LIMIT }),
            )
          : Promise.resolve(null),
        hasPermission('AUDIT_READ')
          ? loadOptional('audit', () =>
              adminService.listAuditEvents({ limit: DASHBOARD_RECENT_LIMIT }),
            )
          : Promise.resolve(null),
        hasPermission('ADMIN_USER_READ')
          ? loadOptional('skycommand-user-summary', () =>
              adminService.getApplicationUserSummary({
                appCode: 'SKYSERVER_ADMIN',
                days: userSummaryDays,
              }),
            )
          : Promise.resolve(null),
        hasPermission('ADMIN_USER_READ')
          ? loadOptional('skyweb-user-summary', () =>
              adminService.getApplicationUserSummary({ appCode: 'SKYWEB', days: userSummaryDays }),
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
          ? loadOptional('workflow-runs', () =>
              workflowService.listRuns({ limit: DASHBOARD_RECENT_LIMIT }),
            )
          : Promise.resolve(null),
        hasPermission('ADMIN_REPOSITORY_READ')
          ? loadOptional('production-readiness', () => adminService.getProductionReadiness())
          : Promise.resolve(null),
      ]);

      const nextSummary = {
        apiHealth,
        dbHealth,
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
        actionClassName="sky-dashboard-page-actions"
        actions={
          <DashboardRefreshActions
            activeLabel="Live runs"
            lastRefreshAt={refreshingAt}
            loading={loading}
            onRefresh={() => loadDashboard()}
            pollingState={pollingState}
          />
        }
        kicker="Workflow automation engine"
        subtitle={`Welcome back, ${user?.displayName || user?.username || 'Operator'}. Monitor automation health, workflow runtime, data pipelines, and application access signals from one command surface.`}
        title="Command Center"
      />

      {error && <div className="alert alert-danger">{error}</div>}

      <DashboardVisuals
        ingestionCounts={ingestionCounts}
        recentAudits={recentAudits}
        recentExecutions={recentExecutions}
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
        workflowRuns={workflowRunRecords}
      />

      <section className="sky-card sky-dashboard-identity-panel mt-4">
        <div className="sky-card-header sky-dashboard-section-heading">
          <div>
            <div className="sky-page-kicker">Identity early warning</div>
            <h2 className="h5 mb-0">Application access activity</h2>
            <div className="small sky-muted mt-1">
              Compare login and session pressure with the immediately preceding period.
            </div>
          </div>
          <label className="sky-identity-window-control" htmlFor="identityWindowDays">
            <span>Activity window</span>
            <select
              className="form-select form-select-sm sky-form-control"
              disabled={loading}
              id="identityWindowDays"
              onChange={changeIdentityWindow}
              value={identityDays}
            >
              <option value={7}>7 days</option>
              <option value={30}>30 days</option>
              <option value={90}>90 days</option>
            </select>
          </label>
        </div>

        <div className="sky-card-body">
          <ApplicationUserSummaryRow
            data={summary.userSummaries.skyCommand}
            loading={loading}
            title="SkyCommand User Summary"
          />

          <div className="mt-3">
            <ApplicationUserSummaryRow
              data={summary.userSummaries.skyWeb}
              loading={loading}
              title="SkyWeb User Summary"
            />
          </div>
        </div>
      </section>
    </>
  );
}

export default Dashboard;
