import DashboardRefreshActions from '../components/ui/DashboardRefreshActions.jsx';
import PageHeader from '../components/ui/PageHeader.jsx';
import Panel from '../components/ui/Panel.jsx';
import StatCard from '../components/ui/StatCard.jsx';
import StatusPill from '../components/ui/StatusPill.jsx';
import useDockerOverview from '../hooks/useDockerOverview.js';

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

function getProjectHealth(project = {}) {
  if (Number(project.unhealthyCount || 0) > 0) return 'UNHEALTHY';
  if (project.state === 'RUNNING' && Number(project.healthyCount || 0) > 0) return 'HEALTHY';
  return project.state || 'UNKNOWN';
}

function DockerOverview() {
  const { error, loadOverview, loading, overview, pollingState, refreshingAt } =
    useDockerOverview();
  const counts = overview?.counts || {};
  const provider = overview?.provider || {};
  const target = overview?.target || {};
  const projects = Array.isArray(overview?.projects) ? overview.projects : [];
  const containers = Array.isArray(overview?.containers) ? overview.containers : [];

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
        kicker="Docker · Infrastructure"
        subtitle="Observe the local Docker Engine through the host-native SkyCommand Host Agent. Phase 17 begins read-only so control actions can be added behind explicit policy and audit boundaries."
        title="Docker Overview"
      />

      {error && <div className="alert alert-danger">{error}</div>}
      {overview?.error && (
        <div className="alert alert-warning mb-3">
          <strong>{overview.error.code}</strong> · {overview.error.message}
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
            status={provider.status || 'UNKNOWN'}
            value={provider.status || 'UNKNOWN'}
          />
        </div>
        <div className="col-6 col-md-4 col-xl-2">
          <StatCard label="Compose Projects" status="INFO" value={counts.projects ?? 0} />
        </div>
        <div className="col-6 col-md-4 col-xl-2">
          <StatCard label="Containers" status="INFO" value={counts.containers ?? 0} />
        </div>
        <div className="col-6 col-md-4 col-xl-2">
          <StatCard
            helper={`${counts.stopped ?? 0} not running`}
            label="Running"
            status={Number(counts.running || 0) > 0 ? 'ONLINE' : 'INFO'}
            value={counts.running ?? 0}
          />
        </div>
      </div>

      <div className="row g-3 mb-3">
        <div className="col-6 col-md-3">
          <StatCard label="Healthy" status="HEALTHY" value={counts.healthy ?? 0} />
        </div>
        <div className="col-6 col-md-3">
          <StatCard
            label="Unhealthy"
            status={Number(counts.unhealthy || 0) > 0 ? 'UNHEALTHY' : 'HEALTHY'}
            value={counts.unhealthy ?? 0}
          />
        </div>
        <div className="col-6 col-md-2">
          <StatCard label="Images" status="INFO" value={counts.images ?? 0} />
        </div>
        <div className="col-6 col-md-2">
          <StatCard label="Volumes" status="INFO" value={counts.volumes ?? 0} />
        </div>
        <div className="col-6 col-md-2">
          <StatCard label="Networks" status="INFO" value={counts.networks ?? 0} />
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
