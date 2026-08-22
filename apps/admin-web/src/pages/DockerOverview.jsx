import DockerTelemetryVisuals from '../components/charts/DockerTelemetryVisuals.jsx';
import DashboardRefreshActions from '../components/ui/DashboardRefreshActions.jsx';
import PageHeader from '../components/ui/PageHeader.jsx';
import Panel from '../components/ui/Panel.jsx';
import StatCard from '../components/ui/StatCard.jsx';
import StatusPill from '../components/ui/StatusPill.jsx';
import useDockerEventStream from '../hooks/useDockerEventStream.js';
import useDockerTelemetryStream from '../hooks/useDockerTelemetryStream.js';
import useDockerOverview from '../hooks/useDockerOverview.js';
import { buildDockerStaleDataMessage, getDockerLiveLaneState } from '../utils/dockerLiveStatus.js';

function formatBytes(value) {
  const bytes = Number(value || 0);
  if (!Number.isFinite(bytes) || bytes <= 0) return '—';

  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let amount = bytes;
  let unitIndex = 0;

  while (amount >= 1024 && unitIndex < units.length - 1) {
    amount /= 1024;
    unitIndex += 1;
  }

  return `${amount >= 10 || unitIndex === 0 ? amount.toFixed(0) : amount.toFixed(1)} ${units[unitIndex]}`;
}


function formatEventTime(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' });
}

function formatEventAction(value) {
  return String(value || 'UNKNOWN')
    .replace(/_/g, ' ')
    .toLowerCase()
    .replace(/(^|\s)\S/g, (letter) => letter.toUpperCase());
}

function getEventStatus(action) {
  const normalized = String(action || '').toUpperCase();
  if (['HEALTH_STATUS_UNHEALTHY', 'DIE', 'KILL', 'OOM', 'DESTROY'].includes(normalized)) {
    return 'ERROR';
  }
  if (['START', 'UNPAUSE', 'HEALTH_STATUS_HEALTHY'].includes(normalized)) return 'ONLINE';
  if (['STOP', 'PAUSE', 'RESTART', 'HEALTH_STATUS_STARTING'].includes(normalized)) {
    return 'WARNING';
  }
  return 'INFO';
}

function getProjectHealth(project = {}) {
  if (Number(project.unhealthyCount || 0) > 0) return 'UNHEALTHY';
  if (project.state === 'RUNNING' && Number(project.healthyCount || 0) > 0) return 'HEALTHY';
  return project.state || 'UNKNOWN';
}

function DockerOverview() {
  const { error, loadOverview, loading, overview, pollingState, refreshingAt } =
    useDockerOverview();
  const eventStream = useDockerEventStream();
  const telemetryStream = useDockerTelemetryStream();
  const counts = overview?.counts || {};
  const provider = overview?.provider || {};
  const target = overview?.target || {};
  const projects = Array.isArray(overview?.projects) ? overview.projects : [];
  const containers = Array.isArray(overview?.containers) ? overview.containers : [];
  const providerStatus = provider.status || 'UNKNOWN';
  const providerOnline = providerStatus === 'ONLINE';
  const inventoryCardStatus = providerOnline ? 'INFO' : providerStatus;
  const eventLane = getDockerLiveLaneState(eventStream);
  const eventSourceWarning = buildDockerStaleDataMessage({
    noun: 'Docker event source',
    sourceErrorCode: eventStream.sourceErrorCode,
    sourceStatus: eventStream.sourceStatus,
  });

  return (
    <>
      <PageHeader
        actionClassName="sky-dashboard-page-actions"
        actions={
          <DashboardRefreshActions
            activeLabel="Running"
            activeValue={counts.running || 0}
            lastRefreshAt={refreshingAt}
            loading={loading}
            onRefresh={() => loadOverview()}
            pollingState={pollingState}
          />
        }
        kicker="Dashboards · Docker"
        subtitle="Observe the local Docker Engine through the host-native SkyCommand Host Agent, with guarded lifecycle controls plus live event and resource-telemetry lanes."
        title="Docker"
      />

      {error && <div className="alert alert-danger">{error}</div>}
      {overview?.error && (
        <div className="alert alert-warning mb-3">
          <strong>{overview.error.code}</strong> · {overview.error.message}
          {overview.error.details?.component && (
            <div className="small mt-1">
              Failure domain: {overview.error.details.component.replace(/_/g, ' ')} · Host Agent{' '}
              {overview.error.details.hostAgentStatus || target.status || 'UNKNOWN'} · Docker provider{' '}
              {overview.error.details.dockerProviderStatus || provider.status || 'UNKNOWN'}
            </div>
          )}
        </div>
      )}

      <div className="row g-3 mb-3">
        <div className="col-12 col-md-6 col-xl-3">
          <StatCard
            helper={`${target.displayName || 'Local Docker'} · ${target.transport || 'HOST_AGENT'}`}
            label="Infrastructure Target"
            status={target.status || 'UNKNOWN'}
            value={target.status || 'UNKNOWN'}
          />
        </div>
        <div className="col-12 col-md-6 col-xl-3">
          <StatCard
            helper={
              provider.engineVersion
                ? `Engine ${provider.engineVersion}`
                : 'Engine version unavailable'
            }
            label="Docker Engine"
            status={providerStatus}
            value={providerStatus}
          />
        </div>
        <div className="col-6 col-md-4 col-xl-2">
          <StatCard label="Compose Projects" status={inventoryCardStatus} value={counts.projects ?? 0} />
        </div>
        <div className="col-6 col-md-4 col-xl-2">
          <StatCard label="Containers" status={inventoryCardStatus} value={counts.containers ?? 0} />
        </div>
        <div className="col-6 col-md-4 col-xl-2">
          <StatCard
            helper={`${counts.stopped ?? 0} not running`}
            label="Running"
            status={
              providerOnline
                ? Number(counts.running || 0) > 0
                  ? 'ONLINE'
                  : 'INFO'
                : providerStatus
            }
            value={counts.running ?? 0}
          />
        </div>
      </div>

      <div className="row g-3 mb-3">
        <div className="col-6 col-md-3">
          <StatCard
            label="Healthy"
            status={providerOnline ? 'HEALTHY' : providerStatus}
            value={counts.healthy ?? 0}
          />
        </div>
        <div className="col-6 col-md-3">
          <StatCard
            label="Unhealthy"
            status={
              providerOnline
                ? Number(counts.unhealthy || 0) > 0
                  ? 'UNHEALTHY'
                  : 'HEALTHY'
                : providerStatus
            }
            value={counts.unhealthy ?? 0}
          />
        </div>
        <div className="col-6 col-md-2">
          <StatCard label="Images" status={inventoryCardStatus} value={counts.images ?? 0} />
        </div>
        <div className="col-6 col-md-2">
          <StatCard label="Volumes" status={inventoryCardStatus} value={counts.volumes ?? 0} />
        </div>
        <div className="col-6 col-md-2">
          <StatCard label="Networks" status={inventoryCardStatus} value={counts.networks ?? 0} />
        </div>
      </div>

      <div className="row g-3 mb-3">
        <div className="col-12 col-xl-5">
          <Panel
            className="h-100"
            kicker="Provider"
            subtitle="Provider details are normalized behind the infrastructure service so Kubernetes can later implement the same control-plane boundary."
            title="Docker Engine"
          >
            <div className="sky-card-body">
              <dl className="row mb-0 small">
                <dt className="col-5">Host</dt>
                <dd className="col-7">{overview?.host?.hostname || target.hostname || '—'}</dd>
                <dt className="col-5">Engine name</dt>
                <dd className="col-7">{provider.engineName || '—'}</dd>
                <dt className="col-5">Operating system</dt>
                <dd className="col-7">{provider.operatingSystem || '—'}</dd>
                <dt className="col-5">Architecture</dt>
                <dd className="col-7">{provider.architecture || '—'}</dd>
                <dt className="col-5">CPU</dt>
                <dd className="col-7">{provider.cpuCount || '—'}</dd>
                <dt className="col-5">Memory</dt>
                <dd className="col-7">{formatBytes(provider.memoryBytes)}</dd>
                <dt className="col-5">Storage driver</dt>
                <dd className="col-7">{provider.storageDriver || '—'}</dd>
                <dt className="col-5">Transport</dt>
                <dd className="col-7">{target.transport || 'HOST_AGENT'}</dd>
              </dl>
            </div>
          </Panel>
        </div>

        <div className="col-12 col-xl-7">
          <Panel
            className="h-100"
            kicker="Application Stacks"
            subtitle="Compose projects are treated as application-level workloads rather than forcing operators to reason from raw container names."
            title="Compose Projects"
          >
            <div className="table-responsive sky-table-card border-0 rounded-0">
              <table className="table table-sm table-hover sky-table align-middle mb-0">
                <thead>
                  <tr>
                    <th>Project</th>
                    <th>Status</th>
                    <th className="text-end">Services</th>
                    <th className="text-end">Running</th>
                    <th className="text-end">Health</th>
                  </tr>
                </thead>
                <tbody>
                  {projects.length === 0 ? (
                    <tr>
                      <td className="sky-muted text-center py-4" colSpan="5">
                        {loading
                          ? 'Loading Docker projects…'
                          : overview?.error
                            ? 'Docker project inventory is unavailable while the provider is offline.'
                            : 'No Docker Compose projects detected.'}
                      </td>
                    </tr>
                  ) : (
                    projects.map((project) => (
                      <tr key={project.name}>
                        <td>
                          <div className="fw-semibold">{project.name}</div>
                          <div className="small sky-muted">
                            {project.configFiles || 'Compose metadata detected'}
                          </div>
                        </td>
                        <td>
                          <StatusPill status={project.state} />
                        </td>
                        <td className="text-end">{project.serviceCount ?? 0}</td>
                        <td className="text-end">
                          {project.runningCount ?? 0}/{project.containerCount ?? 0}
                        </td>
                        <td className="text-end">
                          <StatusPill status={getProjectHealth(project)} />
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </Panel>
        </div>
      </div>

      <Panel
        className="mb-3"
        kicker="Live Observability"
        subtitle="Container lifecycle events flow directly from Docker through the host-native Host Agent and API SSE lane without creating Temporal workflow history."
        title="Docker Event Stream"
      >
        <div className="sky-card-body border-bottom">
          <div className="d-flex flex-wrap align-items-center gap-2">
            <StatusPill
              label={`Browser ${eventStream.connectionStatus}`}
              status={eventStream.connectionStatus === 'CONNECTED' ? 'ONLINE' : 'WARNING'}
            />
            <StatusPill
              label={`Docker source ${eventLane.label}`}
              status={eventLane.status}
            />
            <span className="small sky-muted">
              {eventStream.sourceHostname || target.hostname || 'Host source pending'}
            </span>
            <span className="small sky-muted ms-auto">
              Heartbeat {formatEventTime(eventStream.lastHeartbeatAt)} · Last event{' '}
              {formatEventTime(eventStream.lastEventAt)}
            </span>
          </div>
          {eventStream.error && (
            <div className="small text-warning mt-2">{eventStream.error}</div>
          )}
          {!eventLane.live && eventSourceWarning && (
            <div className="small text-warning mt-2">{eventSourceWarning}</div>
          )}
        </div>
        <div className="table-responsive sky-table-card border-0 rounded-0">
          <table className="table table-sm table-hover sky-table align-middle mb-0">
            <thead>
              <tr>
                <th>Time</th>
                <th>Action</th>
                <th>Container</th>
                <th>Project</th>
                <th>Service</th>
                <th>Image</th>
              </tr>
            </thead>
            <tbody>
              {eventStream.events.length === 0 ? (
                <tr>
                  <td className="sky-muted text-center py-4" colSpan="6">
                    {eventLane.live
                      ? 'Live Docker event bridge is online. Waiting for container activity…'
                      : 'Docker event history is waiting for a healthy Host Agent source. SkyCommand will reconnect automatically.'}
                  </td>
                </tr>
              ) : (
                eventStream.events.map((event) => (
                  <tr key={event.eventId || event.sequence}>
                    <td className="text-nowrap">{formatEventTime(event.occurredAt)}</td>
                    <td>
                      <StatusPill
                        label={formatEventAction(event.action)}
                        status={getEventStatus(event.action)}
                      />
                    </td>
                    <td>
                      <div className="fw-semibold">{event.containerName || event.containerId || '—'}</div>
                      {event.containerId && (
                        <div className="small sky-muted">{event.containerId.slice(0, 12)}</div>
                      )}
                    </td>
                    <td>{event.project || '—'}</td>
                    <td>{event.service || '—'}</td>
                    <td>{event.image || '—'}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Panel>

      <DockerTelemetryVisuals telemetry={telemetryStream} />

      <Panel
        kicker="Runtime Inventory"
        subtitle="The first ten containers are surfaced here for fast triage; the Containers page exposes the full read-only inventory."
        title="Container Pulse"
      >
        <div className="table-responsive sky-table-card border-0 rounded-0">
          <table className="table table-sm table-hover sky-table align-middle mb-0">
            <thead>
              <tr>
                <th>Container</th>
                <th>Project</th>
                <th>Service</th>
                <th>Image</th>
                <th>State</th>
                <th>Health</th>
              </tr>
            </thead>
            <tbody>
              {containers.length === 0 ? (
                <tr>
                  <td className="sky-muted text-center py-4" colSpan="6">
                    {loading ? 'Loading Docker containers…' : 'No containers detected.'}
                  </td>
                </tr>
              ) : (
                containers.slice(0, 10).map((container) => (
                  <tr key={container.id || container.name}>
                    <td className="fw-semibold">{container.name || container.id}</td>
                    <td>{container.project || '—'}</td>
                    <td>{container.service || '—'}</td>
                    <td>{container.image || '—'}</td>
                    <td>
                      <StatusPill status={container.state} />
                    </td>
                    <td>
                      <StatusPill
                        label={container.health === 'NONE' ? '—' : container.health}
                        status={container.health === 'NONE' ? 'INFO' : container.health}
                      />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Panel>
    </>
  );
}

export default DockerOverview;
