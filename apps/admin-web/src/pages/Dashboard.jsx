import { useEffect, useMemo, useState } from 'react';
import ApiObservabilityPanel from '../components/charts/ApiObservabilityPanel.jsx';
import ApplicationUserSummaryRow from '../components/charts/ApplicationUserSummaryRow.jsx';
import DashboardVisuals from '../components/charts/DashboardVisuals.jsx';
import DashboardRefreshActions from '../components/ui/DashboardRefreshActions.jsx';
import ServerStatusPanel from '../components/ui/ServerStatusPanel.jsx';
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

import DismissibleAlert from '../components/ui/DismissibleAlert.jsx';
const DASHBOARD_RECENT_LIMIT = 60;
const DASHBOARD_ACTIVITY_PAGE_SIZE = 200;
const DASHBOARD_ACTIVITY_DAYS = 7;

function getDashboardActivityWindowStart() {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - (DASHBOARD_ACTIVITY_DAYS - 1));
  return start.toISOString();
}

async function loadDashboardActivity(loader) {
  const query = {
    from: getDashboardActivityWindowStart(),
    limit: DASHBOARD_ACTIVITY_PAGE_SIZE,
    offset: 0,
  };
  const firstPage = await loader(query);
  const items = [...(firstPage?.items || [])];
  const total = Number(firstPage?.total || items.length);

  for (let offset = items.length; offset < total; offset += DASHBOARD_ACTIVITY_PAGE_SIZE) {
    const page = await loader({
      ...query,
      offset,
    });
    const pageItems = page?.items || [];

    if (pageItems.length === 0) {
      break;
    }

    items.push(...pageItems);
  }

  return {
    total,
    items,
  };
}

function Dashboard() {
  const { hasPermission, user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [refreshingAt, setRefreshingAt] = useState(null);
  const [identityDays, setIdentityDays] = useState(7);
  const [summary, setSummary] = useState({
    apiHealth: null,
    apiTelemetry: null,
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
    },
    ingestion: null,
    worker: null,
    workflowHealth: null,
    workflowRunsDetailed: {
      total: 0,
      items: [],
    },
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
  const workflowTaskQueue = workflowHealth?.taskQueue || {};
  const hostAgentHealth = workflowHealth?.hostAgent || null;

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
        apiTelemetryResult,
        ingestionResult,
        workerResult,
        workflowHealthResult,
        workflowRunsResult,
      ] = await Promise.all([
        loadOptional('api-health', () => api.get('/_health')),
        loadOptional('db-health', () => api.get('/_db/health')),
        hasPermission('SCRIPT_EXECUTION_READ')
          ? loadOptional('executions', () =>
              loadDashboardActivity((query) => adminService.listScriptExecutions(query)),
            )
          : Promise.resolve(null),
        hasPermission('AUDIT_READ')
          ? loadOptional('audit', () =>
              loadDashboardActivity((query) => adminService.listAuditEvents(query)),
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
        hasPermission('API_TELEMETRY_READ')
          ? loadOptional('api-telemetry', () => adminService.getApiTelemetrySummary({ days: 7 }))
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
      ]);

      const nextSummary = {
        apiHealth,
        apiTelemetry: apiTelemetryResult,
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
        },
        ingestion: ingestionResult,
        worker: workerResult,
        workflowHealth: workflowHealthResult,
        workflowRunsDetailed: {
          total: workflowRunsResult?.total || 0,
          items: workflowRunsResult?.items || [],
        },
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

      {error && <DismissibleAlert tone="danger">{error}</DismissibleAlert>}

      <ServerStatusPanel
        items={[
          {
            label: 'Web server',
            value: 'Online',
            status: 'ONLINE',
            helper: `${window.location.host || 'Admin Web'} shell loaded`,
          },
          {
            label: 'Database',
            value: !summary.dbHealth
              ? loading
                ? 'Checking'
                : 'Unknown'
              : summary.dbHealth.ok
                ? 'Online'
                : 'Offline',
            status: !summary.dbHealth
              ? loading
                ? 'PENDING'
                : 'UNKNOWN'
              : summary.dbHealth.ok
                ? 'ONLINE'
                : 'OFFLINE',
            helper: summary.dbHealth?.database || 'Database connection health endpoint',
          },
          {
            label: 'API server',
            value: !summary.apiHealth
              ? loading
                ? 'Checking'
                : 'Unknown'
              : summary.apiHealth.ok
                ? 'Online'
                : 'Offline',
            status: !summary.apiHealth
              ? loading
                ? 'PENDING'
                : 'UNKNOWN'
              : summary.apiHealth.ok
                ? 'ONLINE'
                : 'OFFLINE',
            helper: summary.apiHealth?.service || 'Core API health endpoint',
          },
          {
            label: 'Node worker',
            value: !workerHealth
              ? loading
                ? 'Checking'
                : 'Unknown'
              : workerNodes.online > 0
                ? 'Online'
                : 'Offline',
            status: !workerHealth
              ? loading
                ? 'PENDING'
                : 'UNKNOWN'
              : workerNodes.online > 0
                ? workerHealth.overallStatus || 'ONLINE'
                : 'OFFLINE',
            helper: workerHealth
              ? `${workerNodes.online || 0} of ${workerNodes.total || 0} node worker(s) online`
              : 'Worker health is unavailable to this session',
          },
          {
            label: 'Temporal server',
            value: !workflowHealth
              ? loading
                ? 'Checking'
                : 'Unknown'
              : workflowHealth.temporal?.reachable
                ? 'Online'
                : 'Offline',
            status: !workflowHealth
              ? loading
                ? 'PENDING'
                : 'UNKNOWN'
              : workflowHealth.temporal?.reachable
                ? 'ONLINE'
                : 'OFFLINE',
            helper: workflowHealth?.temporal?.address || 'Temporal service endpoint',
          },
          {
            label: 'Temporal worker',
            value: !workflowHealth
              ? loading
                ? 'Checking'
                : 'Unknown'
              : workflowHealth.worker?.status === 'ONLINE' && workflowTaskQueue.healthy
                ? 'Online'
                : workflowHealth.worker?.status || 'Unknown',
            status: !workflowHealth
              ? loading
                ? 'PENDING'
                : 'UNKNOWN'
              : workflowHealth.worker?.status === 'ONLINE' && workflowTaskQueue.healthy
                ? 'ONLINE'
                : workflowHealth.worker?.status || 'UNKNOWN',
            helper: workflowHealth
              ? `${workflowTaskQueue.pollerCount || 0} poller(s) · ${workflowTaskQueue.taskQueue || workflowTaskQueue.name || 'task queue'}`
              : 'Temporal worker health is unavailable to this session',
          },
          {
            label: 'Host agent',
            value: !workflowHealth
              ? loading
                ? 'Checking'
                : 'Unknown'
              : !hostAgentHealth?.enabled
                ? 'Disabled'
                : hostAgentHealth.online
                  ? 'Online'
                  : hostAgentHealth.status === 'STALE'
                    ? 'Stale'
                    : 'Offline',
            status: !workflowHealth
              ? loading
                ? 'PENDING'
                : 'UNKNOWN'
              : !hostAgentHealth?.enabled
                ? 'DISABLED'
                : hostAgentHealth.online
                  ? 'ONLINE'
                  : hostAgentHealth.status || 'OFFLINE',
            helper: !workflowHealth
              ? 'Host Agent health is unavailable to this session'
              : !hostAgentHealth?.enabled
                ? 'Host execution disabled · SKYCOMMAND_HOST_AGENT_ENABLED=false'
                : hostAgentHealth.online
                  ? `${hostAgentHealth.recentHeartbeatCount || 0} recent heartbeat(s) · ${hostAgentHealth.taskQueue || 'host task queue'}`
                  : hostAgentHealth.latestHeartbeat?.lastSeenAt
                    ? `Last heartbeat ${new Date(hostAgentHealth.latestHeartbeat.lastSeenAt).toLocaleString()} · ${hostAgentHealth.taskQueue || 'host task queue'}`
                    : `No Host Agent heartbeat · ${hostAgentHealth.taskQueue || 'host task queue'}`,
          },
        ]}
      />

      <DashboardVisuals
        ingestionCounts={ingestionCounts}
        recentAudits={recentAudits}
        recentExecutions={recentExecutions}
        workflowRuns={workflowRunRecords}
      />

      <ApiObservabilityPanel className="mt-4" data={summary.apiTelemetry} showRouteTable={false} />

      <section className="sky-card sky-dashboard-identity-panel mt-4">
        <div className="sky-card-header sky-dashboard-section-heading">
          <div>
            <div className="sky-page-kicker">Identity early warning</div>
            <h2 className="h5 mb-0">SkyCommand access activity</h2>
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
        </div>
      </section>
    </>
  );
}

export default Dashboard;
