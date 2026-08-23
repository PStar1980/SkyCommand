import { useEffect } from 'react';
import StatusPill from './ui/StatusPill.jsx';

import DismissibleAlert from './ui/DismissibleAlert.jsx';
function formatDate(value) {
  if (!value || String(value).startsWith('0001-01-01')) return '—';

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'medium',
  }).format(date);
}

function DetailRow({ label, children, mono = false }) {
  return (
    <>
      <dt className="col-md-3 sky-detail-label">{label}</dt>
      <dd className={`col-md-9 sky-detail-value${mono ? ' sky-mono text-break' : ''}`}>
        {children ?? '—'}
      </dd>
    </>
  );
}

function EmptyMessage({ children }) {
  return <div className="sky-empty-state py-4">{children}</div>;
}

function ContainerControls({ canControl, container, controlling, onControl }) {
  const control = container?.control || {};
  const actions = control.actions || {};
  const selfManaged = control.mode === 'SELF_MANAGED_PROTECTED';
  const busy = Boolean(controlling);

  if (selfManaged) {
    return (
      <div className="d-flex flex-wrap align-items-center gap-2">
        <StatusPill label="Self-managed" status="BLOCKED" />
        <span className="small sky-muted">
          SkyCommand protects containers in its own control-plane project from synchronous lifecycle writes.
        </span>
      </div>
    );
  }

  if (!canControl) {
    return <StatusPill label="Read only" status="INFO" />;
  }

  const definitions = [
    ['START', 'Start', actions.start, 'sky-btn-primary'],
    ['STOP', 'Stop', actions.stop, 'sky-btn-ghost'],
    ['RESTART', 'Restart', actions.restart, 'sky-btn-ghost'],
    ['PAUSE', 'Pause', actions.pause, 'sky-btn-ghost'],
    ['UNPAUSE', 'Unpause', actions.unpause, 'sky-btn-ghost'],
  ];

  return (
    <div className="d-flex flex-wrap gap-2">
      {definitions.map(([action, label, enabled, className]) => (
        <button
          className={`btn btn-sm ${className}`}
          disabled={busy || !enabled}
          key={action}
          onClick={() => onControl(container, action)}
          type="button"
        >
          {controlling === action ? `${label}…` : label}
        </button>
      ))}
    </div>
  );
}

function DockerContainerDetailsModal({
  canControl,
  embedded = false,
  controlling,
  detail,
  error,
  loading,
  onClose,
  onControl,
  onRefresh,
}) {
  useEffect(() => {
    if (embedded) return undefined;

    function handleKeyDown(event) {
      if (event.key === 'Escape') onClose();
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [embedded, onClose]);

  const container = detail?.container || null;
  const state = container?.state || {};
  const logs = detail?.logs || {};
  const mounts = Array.isArray(container?.mounts) ? container.mounts : [];
  const networks = Array.isArray(container?.networks) ? container.networks : [];
  const ports = Array.isArray(container?.ports) ? container.ports : [];
  const healthLog = Array.isArray(state?.healthLog) ? state.healthLog : [];

  return (
    <div
      aria-label="Docker container details"
      aria-modal={embedded ? undefined : 'true'}
      className={embedded ? 'sky-card mb-4 sky-docker-inline-detail-workspace' : 'sky-chart-modal-backdrop sky-tool-details-modal-backdrop'}
      onMouseDown={(event) => {
        if (!embedded && event.target === event.currentTarget) onClose();
      }}
      role={embedded ? undefined : 'dialog'}
    >
      <section className={embedded ? '' : 'sky-chart-modal sky-tool-details-modal'}>
        <div className={embedded ? 'sky-card-header d-flex flex-wrap align-items-start justify-content-between gap-3' : 'sky-chart-modal-header'}>
          <div>
            <div className={`sky-page-kicker${embedded ? '' : ' sky-chart-modal-kicker'}`}>
              {embedded ? 'Selected container workspace' : 'Docker container details'}
            </div>
            <h2 className={embedded ? 'h5 mb-1' : undefined}>
              {embedded ? 'Container Details' : container?.name || 'Container details'}
            </h2>
            <p className={embedded ? 'small sky-muted mb-0' : undefined}>
              {container
                ? embedded
                  ? `${container.name || container.id} · ${container.project || 'Standalone'} · ${container.service || 'No Compose service'}`
                  : `${container.project || 'Standalone'} · ${container.service || 'No Compose service'}`
                : 'Loading selected container…'}
            </p>
          </div>
          <div className="d-flex align-items-center gap-2">
            <button
              className="btn btn-sm sky-btn-ghost"
              disabled={loading}
              onClick={onRefresh}
              type="button"
            >
              {loading ? 'Refreshing…' : 'Refresh'}
            </button>
            {!embedded && (
              <button
                aria-label="Close Docker container details"
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
          {error && <DismissibleAlert tone="danger">{error}</DismissibleAlert>}

          {loading && !container ? (
            <div className="sky-empty-state py-5">
              <div className="spinner-border text-info" role="status" aria-label="Loading" />
            </div>
          ) : !container ? (
            <EmptyMessage>Container details are unavailable.</EmptyMessage>
          ) : (
            <>
              <div className="sky-execution-metric-grid mb-3">
                <div className="sky-mini-metric">
                  <div className="sky-page-kicker">State</div>
                  <StatusPill status={state.status || container.inventoryState || 'UNKNOWN'} />
                </div>
                <div className="sky-mini-metric">
                  <div className="sky-page-kicker">Health</div>
                  <StatusPill
                    label={state.health === 'NONE' ? '—' : state.health || container.health || '—'}
                    status={state.health === 'NONE' ? 'INFO' : state.health || container.health || 'INFO'}
                  />
                </div>
                <div className="sky-mini-metric">
                  <div className="sky-page-kicker">Restarts</div>
                  <div className="sky-mini-metric-value">{container.restartCount ?? 0}</div>
                </div>
                <div className="sky-mini-metric">
                  <div className="sky-page-kicker">Exit code</div>
                  <div className="sky-mini-metric-value">{state.exitCode ?? '—'}</div>
                </div>
              </div>

              <section className="sky-card mb-3">
                <div className="sky-card-header d-flex flex-wrap justify-content-between align-items-center gap-2">
                  <div>
                    <h3 className="h5 mb-1">Lifecycle Controls</h3>
                    <div className="small sky-muted">
                      Allow-listed Host Agent operations only; no shell, attach, or arbitrary Docker command surface.
                    </div>
                  </div>
                  <StatusPill label="Environment redacted" status="READY" />
                </div>
                <div className="sky-card-body">
                  <ContainerControls
                    canControl={canControl}
                    container={container}
                    controlling={controlling}
                    onControl={onControl}
                  />
                </div>
              </section>

              <section className="sky-card mb-3">
                <div className="sky-card-header">
                  <h3 className="h5 mb-0">Runtime Identity</h3>
                </div>
                <div className="sky-card-body">
                  <dl className="row g-2 mb-0">
                    <DetailRow label="Container ID" mono>{container.id}</DetailRow>
                    <DetailRow label="Image">{container.image}</DetailRow>
                    <DetailRow label="Image ID" mono>{container.imageId}</DetailRow>
                    <DetailRow label="Project">{container.project || '—'}</DetailRow>
                    <DetailRow label="Service">{container.service || '—'}</DetailRow>
                    <DetailRow label="Platform">{container.platform || '—'}</DetailRow>
                    <DetailRow label="Created">{formatDate(container.createdAt)}</DetailRow>
                    <DetailRow label="Started">{formatDate(state.startedAt)}</DetailRow>
                    <DetailRow label="Finished">{formatDate(state.finishedAt)}</DetailRow>
                    <DetailRow label="PID">{state.pid || '—'}</DetailRow>
                    <DetailRow label="Restart policy">
                      {container.restartPolicy?.name || 'no'}
                      {container.restartPolicy?.maximumRetryCount
                        ? ` · max ${container.restartPolicy.maximumRetryCount}`
                        : ''}
                    </DetailRow>
                    <DetailRow label="Working directory" mono>{container.runtime?.workingDir || '—'}</DetailRow>
                    <DetailRow label="Runtime user">{container.runtime?.user || 'Default'}</DetailRow>
                  </dl>
                </div>
              </section>

              <div className="row g-3 mb-3">
                <div className="col-12 col-xl-6">
                  <section className="sky-card h-100">
                    <div className="sky-card-header">
                      <h3 className="h5 mb-0">Networks & Ports</h3>
                    </div>
                    <div className="sky-card-body">
                      {networks.length === 0 && ports.length === 0 ? (
                        <EmptyMessage>No network attachment metadata reported.</EmptyMessage>
                      ) : (
                        <>
                          {networks.map((network) => (
                            <div className="mb-3" key={network.networkId || network.name}>
                              <div className="fw-semibold">{network.name || 'Network'}</div>
                              <div className="small sky-muted sky-mono">
                                {network.ipAddress || 'No IPv4 address'}
                                {network.gateway ? ` · gateway ${network.gateway}` : ''}
                              </div>
                            </div>
                          ))}
                          {ports.map((port) => (
                            <div className="small mb-1" key={port.containerPort}>
                              <span className="fw-semibold">{port.containerPort}</span>
                              {' → '}
                              {port.hostBindings?.length
                                ? port.hostBindings.map((binding) => `${binding.hostIp || '*'}:${binding.hostPort}`).join(', ')
                                : 'not published'}
                            </div>
                          ))}
                        </>
                      )}
                    </div>
                  </section>
                </div>

                <div className="col-12 col-xl-6">
                  <section className="sky-card h-100">
                    <div className="sky-card-header">
                      <h3 className="h5 mb-0">Mounts</h3>
                    </div>
                    <div className="sky-card-body">
                      {mounts.length === 0 ? (
                        <EmptyMessage>No mounts reported.</EmptyMessage>
                      ) : (
                        mounts.map((mount) => (
                          <div className="mb-3" key={`${mount.type}-${mount.destination}-${mount.source}`}>
                            <div className="fw-semibold">
                              {mount.destination || 'Mount'} · {mount.type || 'unknown'}
                            </div>
                            <div className="small sky-muted sky-mono text-break">
                              {mount.name || mount.source || '—'}
                            </div>
                            <div className="small sky-muted">
                              {mount.readWrite ? 'Read/write' : 'Read only'}
                              {mount.driver ? ` · ${mount.driver}` : ''}
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </section>
                </div>
              </div>

              {healthLog.length > 0 && (
                <section className="sky-card mb-3">
                  <div className="sky-card-header">
                    <h3 className="h5 mb-0">Recent Health Checks</h3>
                  </div>
                  <div className="table-responsive sky-table-card border-0 rounded-0">
                    <table className="table table-sm sky-table align-middle mb-0">
                      <thead>
                        <tr>
                          <th>Completed</th>
                          <th>Exit</th>
                          <th>Output</th>
                        </tr>
                      </thead>
                      <tbody>
                        {healthLog.map((entry, index) => (
                          <tr key={`${entry.end}-${index}`}>
                            <td>{formatDate(entry.end)}</td>
                            <td>{entry.exitCode ?? '—'}</td>
                            <td className="sky-mono text-break">{entry.output || '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              )}

              <section className="sky-card mb-3">
                <div className="sky-card-header d-flex flex-wrap justify-content-between align-items-center gap-2">
                  <div>
                    <h3 className="h5 mb-1">Container Logs</h3>
                    <div className="small sky-muted">
                      Last {logs.tail || 200} lines per Docker log request. stdout and stderr remain separated rather than being reordered in the browser.
                    </div>
                  </div>
                  {logs.truncated && <StatusPill label="Payload truncated" status="WARNING" />}
                </div>
                <div className="sky-card-body">
                  {!logs.available ? (
                    <div className="alert alert-warning mb-0">
                      <strong>{logs.error?.code || 'LOGS_UNAVAILABLE'}</strong> ·{' '}
                      {logs.error?.message || 'Docker logs are unavailable for this container.'}
                    </div>
                  ) : (
                    <div className="row g-3">
                      <div className="col-12 col-xl-6">
                        <div className="sky-page-kicker mb-2">stdout</div>
                        <pre className="sky-tool-output-block mb-0">
                          {logs.stdout || 'No stdout lines returned.'}
                        </pre>
                      </div>
                      <div className="col-12 col-xl-6">
                        <div className="sky-page-kicker mb-2">stderr</div>
                        <pre className="sky-tool-output-block mb-0">
                          {logs.stderr || 'No stderr lines returned.'}
                        </pre>
                      </div>
                    </div>
                  )}
                </div>
              </section>

              <div className="small sky-muted">
                Captured {formatDate(detail.capturedAt)} through the host-native SkyCommand Host Agent.
                Raw Docker inspect payloads and container environment variables are not returned to Admin-Web.
              </div>
            </>
          )}
        </div>
      </section>
    </div>
  );
}

export default DockerContainerDetailsModal;
