import { useEffect, useState } from 'react';
import ApiObservabilityPanel from '../components/charts/ApiObservabilityPanel.jsx';
import ApplicationUserSummaryRow from '../components/charts/ApplicationUserSummaryRow.jsx';
import DashboardVisuals from '../components/charts/DashboardVisuals.jsx';
import DashboardRefreshActions from '../components/ui/DashboardRefreshActions.jsx';
import SkyCommandRuntimeControls from '../components/SkyCommandRuntimeControls.jsx';
import PlatformAvailabilityPanel from '../components/PlatformAvailabilityPanel.jsx';
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
const DASHBOARD_ACTIVITY_PAGE_SIZE = 200;
const DASHBOARD_ACTIVITY_DAYS = 7;

function formatDatabaseTarget(health) {
  const database = String(health?.database || '').trim();
  const host = String(health?.configuredHost || '').trim();
  const port = Number(health?.configuredPort);
  const endpoint = host && Number.isInteger(port) ? `${host}:${port}` : host;
  return [database, endpoint].filter(Boolean).join(' · ') || 'Database connection health endpoint';
}

function getDashboardActivityWindowStart() {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - (DASHBOARD_ACTIVITY_DAYS - 1));
  return start.toISOString();
}

async function loadDashboardActivity(loader) {
  const query = {
    from: getDashboardActivityWindowStart(),
    to: new Date().toISOString(),
    limit: DASHBOARD_ACTIVITY_PAGE_SIZE,
    offset: 0,
  };
  const firstPage = await loader(query);
  const items = [...(firstPage?.items || [])];
  const total = Number(firstPage?.total || items.length);
  let offset = items.length;

  while (offset < total) {
    const page = await loader({
      ...query,
      offset,
    });
    const pageItems = page?.items || [];

    if (pageItems.length === 0) {
      break;
    }

    items.push(...pageItems);
    offset = items.length;
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
    userSummaries: {
      skyCommand: null,
    },
    worker: null,
    workflowHealth: null,
    workflowRunsDetailed: {
      total: 0,
      items: [],
    },
    scheduleRunsDetailed: {
      total: 0,
      items: [],
    },
  });
  const [error, setError] = useState('');
  const recentExecutions = summary.executions.items || [];
  const workerHealth = summary.worker || null;
  const workerNodes = workerHealth?.nodes || {};
  const workflowRunRecords = summary.workflowRunsDetailed?.items || [];
  const scheduleRunRecords = summary.scheduleRunsDetailed?.items || [];

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
        skyCommandUserResult,
        apiTelemetryResult,
        workerResult,
        workflowHealthResult,
        workflowRunsResult,
        scheduleRunsResult,
      ] = await Promise.all([
        loadOptional('api-health', () => api.get('/_health')),
        loadOptional('db-health', () => api.get('/_db/health')),
        hasPermission('SCRIPT_EXECUTION_READ')
          ? loadOptional('executions', () =>
              loadDashboardActivity((query) => adminService.listScriptExecutions(query)),
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
        hasPermission('WORKER_SCHEDULE_READ')
          ? loadOptional('worker', () => workerService.getHealth())
          : Promise.resolve(null),
        hasPermission('WORKFLOW_READ')
          ? loadOptional('workflow-health', () => workflowService.getWorkerHealth())
          : Promise.resolve(null),
        hasPermission('WORKFLOW_READ')
          ? loadOptional('workflow-runs', () =>
              loadDashboardActivity((query) => workflowService.listRuns(query)),
            )
          : Promise.resolve(null),
        hasPermission('WORKER_SCHEDULE_READ')
          ? loadOptional('schedule-runs', () =>
              loadDashboardActivity((query) => workerService.listRuns(query)),
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
        userSummaries: {
          skyCommand: skyCommandUserResult,
        },
        worker: workerResult,
        workflowHealth: workflowHealthResult,
        workflowRunsDetailed: {
          total: workflowRunsResult?.total || 0,
          items: workflowRunsResult?.items || [],
        },
        scheduleRunsDetailed: {
          total: scheduleRunsResult?.total || 0,
          items: scheduleRunsResult?.items || [],
        },
      };
      const nextRunningExecutions = nextSummary.executions.items.filter(
        (execution) => String(execution.status || '').toUpperCase() === 'STARTED',
      );
      const nextWorkflowRuns = nextSummary.workflowHealth?.runs || {};
      const nextActiveRuns = Number(nextWorkflowRuns.active || 0);
      const nextActiveScheduleRuns = nextSummary.scheduleRunsDetailed.items.filter((run) =>
        ['QUEUED', 'STARTED'].includes(String(run.status || '').toUpperCase()),
      );

      setSummary(nextSummary);
      setRefreshingAt(new Date());

      return {
        activeCount: nextRunningExecutions.length + nextActiveRuns + nextActiveScheduleRuns.length,
      };
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

      <SkyCommandRuntimeControls canControl={hasPermission('INFRASTRUCTURE_DOCKER_CONTROL')}>
        {(controls) => (
          <PlatformAvailabilityPanel
            busyAction={controls.busyAction}
            canControl={hasPermission('INFRASTRUCTURE_DOCKER_CONTROL')}
            onAction={controls.controlRuntime}
            onDismissError={controls.clearRuntimeError}
            runtimeControlStatus={controls.runtimeControlStatus}
            runtimeError={controls.runtimeError}
          />
        )}
      </SkyCommandRuntimeControls>
      <DashboardVisuals
        recentExecutions={recentExecutions}
        scheduleRuns={scheduleRunRecords}
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
