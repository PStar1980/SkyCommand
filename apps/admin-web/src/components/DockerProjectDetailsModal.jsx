import { useEffect, useMemo } from 'react';
import useDockerEventStream from '../hooks/useDockerEventStream.js';
import useDockerTelemetryStream from '../hooks/useDockerTelemetryStream.js';
import TrendAreaChart from './charts/TrendAreaChart.jsx';
import { CHART_COLORS } from './charts/chartTheme.js';
import StatusPill from './ui/StatusPill.jsx';
import SkyCommandRuntimeControls from './SkyCommandRuntimeControls.jsx';
import { buildDockerStaleDataMessage, getDockerLiveLaneState } from '../utils/dockerLiveStatus.js';

import DismissibleAlert from './ui/DismissibleAlert.jsx';
function formatBytes(value) {
  const bytes = Number(value || 0);
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';

  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let amount = bytes;
  let index = 0;

  while (amount >= 1024 && index < units.length - 1) {
    amount /= 1024;
    index += 1;
  }

  return `${amount >= 10 || index === 0 ? amount.toFixed(0) : amount.toFixed(1)} ${units[index]}`;
}

function formatRate(value) {
  return `${formatBytes(value)}/s`;
}

function formatPercent(value) {
  const number = Number(value || 0);
  return `${number >= 10 ? number.toFixed(1) : number.toFixed(2)}%`;
}

function formatTime(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' });
}

function formatAction(value) {
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
  if (project.state === 'STOPPED') return 'STOPPED';
  return project.state || 'UNKNOWN';
}

function aggregateProjectSample(sample, projectName) {
  const containers = (Array.isArray(sample?.containers) ? sample.containers : []).filter(
    (container) => container.project === projectName,
  );

  return containers.reduce(
    (result, container) => ({
      containerCount: result.containerCount + 1,
      cpuPercent: result.cpuPercent + Number(container.cpuPercent || 0),
      memoryBytes: result.memoryBytes + Number(container.memoryBytes || 0),
      networkRxRateBytesPerSec:
        result.networkRxRateBytesPerSec + Number(container.networkRxRateBytesPerSec || 0),
      networkTxRateBytesPerSec:
        result.networkTxRateBytesPerSec + Number(container.networkTxRateBytesPerSec || 0),
      blockReadRateBytesPerSec:
        result.blockReadRateBytesPerSec + Number(container.blockReadRateBytesPerSec || 0),
      blockWriteRateBytesPerSec:
        result.blockWriteRateBytesPerSec + Number(container.blockWriteRateBytesPerSec || 0),
      pids: result.pids + Number(container.pids || 0),
    }),
    {
      containerCount: 0,
      cpuPercent: 0,
      memoryBytes: 0,
      networkRxRateBytesPerSec: 0,
      networkTxRateBytesPerSec: 0,
      blockReadRateBytesPerSec: 0,
      blockWriteRateBytesPerSec: 0,
      pids: 0,
    },
  );
}

function findFirstProjectSampleIndex(samples, projectName) {
  return samples.findIndex((sample) =>
    (Array.isArray(sample?.containers) ? sample.containers : []).some(
      (container) => container.project === projectName,
    ),
  );
}

function ProjectControls({ canControl, controlling, onControl, project }) {
  const control = project?.control || {};
  const actions = control.actions || {};
  const selfManaged = control.mode === 'SELF_MANAGED_PROTECTED';
  const busy = Boolean(controlling?.startsWith(`${project?.name}:`));

  if (selfManaged) {
    return (
      <div>
        <div className="d-flex flex-wrap align-items-center gap-2 mb-3">
          <StatusPill label="Self-managed" status="INFO" />
          <span className="small sky-muted">
            Generic Host Agent self-control remains blocked; the dedicated Supervisor lifecycle lane is available below.
          </span>
        </div>
        <SkyCommandRuntimeControls canControl={canControl} />
      </div>
    );
  }

  if (!canControl) return <StatusPill label="Read only" status="INFO" />;

  const definitions = [
    ['START', 'Start', actions.start, 'sky-btn-primary'],
    ['STOP', 'Stop', actions.stop, 'sky-btn-ghost'],
    ['RESTART', 'Restart', actions.restart, 'sky-btn-ghost'],
  ];

  return (
    <div className="d-flex flex-wrap gap-2">
      {definitions.map(([action, label, enabled, className]) => (
        <button
          className={`btn btn-sm ${className}`}
          disabled={busy || !enabled}
          key={action}
          onClick={() => onControl(project, action)}
          type="button"
        >
          {controlling === `${project.name}:${action}` ? `${label}ing…` : label}
        </button>
      ))}
    </div>
  );
}

function DockerProjectDetailsModal({
  canControl,
  containers,
  controlError,
  controlNotice,
  controlling,
  embedded = false,
  onClose,
  onControl,
  onRefresh,
  project,
}) {
  const eventStream = useDockerEventStream();
  const telemetryStream = useDockerTelemetryStream();

  useEffect(() => {
    if (embedded) return undefined;

    function handleKeyDown(event) {
      if (event.key === 'Escape') onClose?.();
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [embedded, onClose]);

  const projectName = project?.name || '';
  const projectContainers = useMemo(
    () =>
      (Array.isArray(containers) ? containers : []).filter(
        (container) => container.project === projectName,
      ),
    [containers, projectName],
  );
  const projectEvents = useMemo(
    () =>
      (Array.isArray(eventStream.events) ? eventStream.events : [])
        .filter((event) => event.project === projectName)
        .slice(0, 12),
    [eventStream.events, projectName],
  );
  const projectSamples = useMemo(() => {
    const samples = Array.isArray(telemetryStream.samples) ? telemetryStream.samples : [];
    const firstIndex = findFirstProjectSampleIndex(samples, projectName);
    if (firstIndex < 0) return [];

    return samples.slice(firstIndex).map((sample) => ({
      capturedAt: sample.capturedAt,
      ...aggregateProjectSample(sample, projectName),
    }));
  }, [projectName, telemetryStream.samples]);
  const currentTelemetry = useMemo(
    () => aggregateProjectSample(telemetryStream.latestSample, projectName),
    [projectName, telemetryStream.latestSample],
  );
  const telemetryByContainer = useMemo(() => {
    const map = new Map();
    for (const container of Array.isArray(telemetryStream.latestSample?.containers)
      ? telemetryStream.latestSample.containers
      : []) {
      if (container.project !== projectName) continue;
      if (container.containerId) {
        map.set(container.containerId, container);
        map.set(container.containerId.slice(0, 12), container);
      }
      if (container.containerName) map.set(container.containerName, container);
    }
    return map;
  }, [projectName, telemetryStream.latestSample]);
  const latestHealthEvent = projectEvents.find((event) =>
    String(event.action || '').toUpperCase().startsWith('HEALTH_STATUS_'),
  );
  const latestLifecycleEvent = projectEvents.find(
    (event) => !String(event.action || '').toUpperCase().startsWith('HEALTH_STATUS_'),
  );
  const labels = useMemo(
    () => projectSamples.map((sample) => formatTime(sample.capturedAt)),
    [projectSamples],
  );
  const eventLane = getDockerLiveLaneState(eventStream);
  const telemetryLane = getDockerLiveLaneState(telemetryStream);
  const liveLaneWarning = [
    !eventLane.live
      ? buildDockerStaleDataMessage({
          noun: 'Docker events',
          sourceErrorCode: eventStream.sourceErrorCode,
          sourceStatus: eventStream.sourceStatus,
        })
      : '',
    !telemetryLane.live
      ? buildDockerStaleDataMessage({
          noun: 'Docker telemetry',
          sourceErrorCode: telemetryStream.sourceErrorCode,
          sourceStatus: telemetryStream.sourceStatus,
        })
      : '',
  ].filter(Boolean).join(' ');

  return (
    <div
      aria-label="Docker Compose project details"
      aria-modal={embedded ? undefined : 'true'}
      className={
        embedded
          ? 'sky-card mb-4 sky-docker-inline-detail-workspace'
          : 'sky-chart-modal-backdrop sky-tool-details-modal-backdrop'
      }
      onMouseDown={(event) => {
        if (!embedded && event.target === event.currentTarget) onClose?.();
      }}
      role={embedded ? undefined : 'dialog'}
    >
      <section
        className={
          embedded
            ? ''
            : 'sky-chart-modal sky-tool-details-modal sky-docker-project-details-modal'
        }
      >
        <div
          className={
            embedded
              ? 'sky-card-header d-flex flex-wrap align-items-start justify-content-between gap-3'
              : 'sky-chart-modal-header'
          }
        >
          <div>
            <div className={`sky-page-kicker${embedded ? '' : ' sky-chart-modal-kicker'}`}>
              {embedded ? 'Selected project workspace' : 'Docker workload details'}
            </div>
            <h2 className={embedded ? 'h5 mb-1' : undefined}>
              {embedded ? 'Project Details' : projectName || 'Compose project'}
            </h2>
            <p className={embedded ? 'small sky-muted mb-0' : undefined}>
              {embedded
                ? `${projectName || 'Selected project'} · Docker Compose workload observability and lifecycle controls.`
                : 'Application-stack observability combines inventory, live telemetry, and native Docker events without creating another provider data path.'}
            </p>
          </div>
          <div className="d-flex align-items-center gap-2">
            <button className="btn btn-sm sky-btn-ghost" onClick={onRefresh} type="button">
              Refresh inventory
            </button>
            {!embedded && (
              <button
                aria-label="Close Docker project details"
                className="sky-chart-modal-close"
                onClick={onClose}
                type="button"
              >
                <svg aria-hidden="true" className="sky-chart-modal-close-icon" viewBox="0 0 24 24">
                  <path d="M6 6l12 12M18 6L6 18" />
                </svg>
              </button>
            )}
          </div>
        </div>

        <div className={embedded ? 'sky-card-body' : 'sky-tool-details-modal-body'}>
          {controlError && <DismissibleAlert tone="danger">{controlError}</DismissibleAlert>}
          {controlNotice && <DismissibleAlert tone="success">{controlNotice}</DismissibleAlert>}

          <div className="sky-execution-metric-grid mb-3">
            <div className="sky-mini-metric">
              <div className="sky-page-kicker">State</div>
              <StatusPill status={project?.state || 'UNKNOWN'} />
            </div>
            <div className="sky-mini-metric">
              <div className="sky-page-kicker">Health</div>
              <StatusPill status={getProjectHealth(project)} />
            </div>
            <div className="sky-mini-metric">
              <div className="sky-page-kicker">Running</div>
              <div className="sky-mini-metric-value">
                {project?.runningCount ?? 0}/{project?.containerCount ?? 0}
              </div>
            </div>
            <div className="sky-mini-metric">
              <div className="sky-page-kicker">Services</div>
              <div className="sky-mini-metric-value">{project?.serviceCount ?? 0}</div>
            </div>
          </div>

          <section className="sky-card mb-3">
            <div className="sky-card-header d-flex flex-wrap justify-content-between align-items-center gap-2">
              <div>
                <div className="sky-page-kicker">Workload control</div>
                <h3 className="h5 mb-1">Compose Lifecycle</h3>
                <div className="small sky-muted">
                  {project?.control?.mode === 'SELF_MANAGED_PROTECTED'
                    ? 'SkyCommand self-lifecycle control uses the host-native Supervisor while ordinary project controls remain protected from synchronous self-termination.'
                    : 'Project-scoped Start, Stop, and Restart remain routed through the guarded Host Agent control lane.'}
                </div>
              </div>
              <div className="d-flex flex-wrap gap-2">
                <StatusPill label={`Events ${eventLane.label}`} status={eventLane.status} />
                <StatusPill
                  label={`Telemetry ${telemetryLane.label}`}
                  status={telemetryLane.status}
                />
              </div>
            </div>
            <div className="sky-card-body">
              {liveLaneWarning && (
                <div className="alert alert-warning py-2 mb-3">
                  <strong>Live signal degraded.</strong> {liveLaneWarning}
                </div>
              )}
              <ProjectControls
                canControl={canControl}
                controlling={controlling}
                onControl={onControl}
                project={project}
              />
            </div>
          </section>

          <div className="sky-execution-metric-grid mb-3">
            <div className="sky-mini-metric">
              <div className="sky-page-kicker">Project CPU</div>
              <div className="sky-mini-metric-value">{formatPercent(currentTelemetry.cpuPercent)}</div>
            </div>
            <div className="sky-mini-metric">
              <div className="sky-page-kicker">Memory</div>
              <div className="sky-mini-metric-value">{formatBytes(currentTelemetry.memoryBytes)}</div>
            </div>
            <div className="sky-mini-metric">
              <div className="sky-page-kicker">Network RX / TX</div>
              <div className="sky-mini-metric-value sky-docker-project-metric-compact">
                {formatRate(currentTelemetry.networkRxRateBytesPerSec)} / {formatRate(currentTelemetry.networkTxRateBytesPerSec)}
              </div>
            </div>
            <div className="sky-mini-metric">
              <div className="sky-page-kicker">Processes</div>
              <div className="sky-mini-metric-value">{currentTelemetry.pids || 0}</div>
            </div>
          </div>

          <div className="row g-3 mb-3">
            <div className="col-12 col-xl-6">
              <TrendAreaChart
                colors={[CHART_COLORS.gold]}
                height={245}
                isEmpty={projectSamples.length === 0}
                kicker="Project compute"
                labels={labels}
                series={[
                  {
                    name: `${projectName} CPU`,
                    values: projectSamples.map((sample) => sample.cpuPercent),
                    areaOpacity: 0.12,
                  },
                ]}
                subtitle="Aggregate CPU across running containers in this Compose workload."
                title="Workload CPU"
                valueFormatter={(value) => formatPercent(value)}
                yAxisFormatter={(value) => `${Number(value || 0).toFixed(0)}%`}
              />
            </div>
            <div className="col-12 col-xl-6">
              <TrendAreaChart
                colors={[CHART_COLORS.cyan]}
                height={245}
                isEmpty={projectSamples.length === 0}
                kicker="Project memory"
                labels={labels}
                series={[
                  {
                    name: `${projectName} memory`,
                    values: projectSamples.map((sample) => sample.memoryBytes),
                    areaOpacity: 0.12,
                  },
                ]}
                subtitle="Combined memory usage of the project's currently running containers."
                title="Workload Memory"
                valueFormatter={(value) => formatBytes(value)}
                yAxisFormatter={(value) => formatBytes(value)}
              />
            </div>
          </div>

          <div className="row g-3 mb-3">
            <div className="col-12 col-xl-7">
              <section className="sky-card h-100">
                <div className="sky-card-header">
                  <div className="sky-page-kicker">Runtime members</div>
                  <h3 className="h5 mb-1">Project Containers</h3>
                  <div className="small sky-muted">
                    Inventory state is correlated with the newest live telemetry sample when available.
                  </div>
                </div>
                <div className="table-responsive sky-table-card border-0 rounded-0">
                  <table className="table table-sm table-hover sky-table align-middle mb-0">
                    <thead>
                      <tr>
                        <th>Container</th>
                        <th>State</th>
                        <th>Health</th>
                        <th className="text-end">CPU</th>
                        <th className="text-end">Memory</th>
                        <th className="text-end">Net RX</th>
                      </tr>
                    </thead>
                    <tbody>
                      {projectContainers.length === 0 ? (
                        <tr>
                          <td className="sky-muted text-center py-4" colSpan="6">
                            No containers are currently associated with this project inventory.
                          </td>
                        </tr>
                      ) : (
                        projectContainers.map((container) => {
                          const live =
                            telemetryByContainer.get(container.id) ||
                            telemetryByContainer.get(String(container.id || '').slice(0, 12)) ||
                            telemetryByContainer.get(container.name) ||
                            null;

                          return (
                            <tr key={container.id || container.name}>
                              <td>
                                <div className="fw-semibold">{container.name || container.id}</div>
                                <div className="small sky-muted">{container.service || '—'}</div>
                              </td>
                              <td><StatusPill status={container.state || 'UNKNOWN'} /></td>
                              <td>
                                <StatusPill
                                  label={container.health === 'NONE' ? '—' : container.health || '—'}
                                  status={container.health === 'NONE' ? 'INFO' : container.health || 'INFO'}
                                />
                              </td>
                              <td className="text-end">{live ? formatPercent(live.cpuPercent) : '—'}</td>
                              <td className="text-end">{live ? formatBytes(live.memoryBytes) : '—'}</td>
                              <td className="text-end">{live ? formatRate(live.networkRxRateBytesPerSec) : '—'}</td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </section>
            </div>

            <div className="col-12 col-xl-5">
              <section className="sky-card h-100">
                <div className="sky-card-header">
                  <div className="sky-page-kicker">Correlated signal</div>
                  <h3 className="h5 mb-1">Recent Docker Activity</h3>
                  <div className="small sky-muted">
                    Native provider events are correlated to this workload without becoming audit records.
                  </div>
                </div>
                <div className="sky-card-body border-bottom">
                  <dl className="row g-2 mb-0 small">
                    <dt className="col-5">Latest lifecycle</dt>
                    <dd className="col-7">
                      {latestLifecycleEvent
                        ? `${formatAction(latestLifecycleEvent.action)} · ${formatTime(latestLifecycleEvent.occurredAt)}`
                        : '—'}
                    </dd>
                    <dt className="col-5">Latest health</dt>
                    <dd className="col-7">
                      {latestHealthEvent
                        ? `${formatAction(latestHealthEvent.action)} · ${formatTime(latestHealthEvent.occurredAt)}`
                        : '—'}
                    </dd>
                    <dt className="col-5">Block read/write</dt>
                    <dd className="col-7">
                      {formatRate(currentTelemetry.blockReadRateBytesPerSec)} / {formatRate(currentTelemetry.blockWriteRateBytesPerSec)}
                    </dd>
                    <dt className="col-5">Last telemetry</dt>
                    <dd className="col-7">{formatTime(telemetryStream.lastSampleAt)}</dd>
                  </dl>
                </div>
                <div className="table-responsive sky-table-card border-0 rounded-0">
                  <table className="table table-sm table-hover sky-table align-middle mb-0">
                    <thead>
                      <tr>
                        <th>Time</th>
                        <th>Event</th>
                        <th>Container</th>
                      </tr>
                    </thead>
                    <tbody>
                      {projectEvents.length === 0 ? (
                        <tr>
                          <td className="sky-muted text-center py-4" colSpan="3">
                            No recent Docker events for this project are buffered in the live stream.
                          </td>
                        </tr>
                      ) : (
                        projectEvents.map((event) => (
                          <tr key={event.eventId || `${event.sequence}:${event.occurredAt}`}>
                            <td className="text-nowrap">{formatTime(event.occurredAt)}</td>
                            <td>
                              <StatusPill
                                label={formatAction(event.action)}
                                status={getEventStatus(event.action)}
                              />
                            </td>
                            <td>
                              <div className="fw-semibold">{event.containerName || '—'}</div>
                              <div className="small sky-muted">{event.service || '—'}</div>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </section>
            </div>
          </div>

          <section className="sky-card">
            <div className="sky-card-header">
              <div className="sky-page-kicker">Provider identity</div>
              <h3 className="h5 mb-0">Compose Configuration</h3>
            </div>
            <div className="sky-card-body">
              <dl className="row g-2 mb-0 small">
                <dt className="col-md-3">Project</dt>
                <dd className="col-md-9">{projectName || '—'}</dd>
                <dt className="col-md-3">Status</dt>
                <dd className="col-md-9">{project?.status || '—'}</dd>
                <dt className="col-md-3">Compose config</dt>
                <dd className="col-md-9 sky-mono text-break">{project?.configFiles || '—'}</dd>
                <dt className="col-md-3">Live source</dt>
                <dd className="col-md-9">
                  {telemetryStream.sourceHostname || eventStream.sourceHostname || 'Host source pending'} · HOST_AGENT
                </dd>
              </dl>
            </div>
          </section>
        </div>
      </section>
    </div>
  );
}

export default DockerProjectDetailsModal;
