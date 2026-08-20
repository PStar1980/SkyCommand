import DashboardRefreshActions from '../components/ui/DashboardRefreshActions.jsx';
import PageHeader from '../components/ui/PageHeader.jsx';
import Panel from '../components/ui/Panel.jsx';
import StatusPill from '../components/ui/StatusPill.jsx';
import useDockerOverview from '../hooks/useDockerOverview.js';

const VIEW_CONFIG = {
  projects: {
    kicker: 'Docker · Compose',
    title: 'Compose Projects',
    subtitle:
      'Inspect application-level Docker Compose workloads discovered through the SkyCommand Host Agent.',
  },
  containers: {
    kicker: 'Docker · Runtime',
    title: 'Containers',
    subtitle:
      'Inspect the full read-only container inventory before lifecycle controls are introduced in a later Phase 17 slice.',
  },
  images: {
    kicker: 'Docker · Registry',
    title: 'Images',
    subtitle:
      'Inspect Docker image inventory and usage metadata without exposing destructive image operations.',
  },
  storage: {
    kicker: 'Docker · Resources',
    title: 'Storage & Networks',
    subtitle:
      'Inspect Docker volumes and networks as infrastructure resources shared by Compose workloads.',
  },
};

function EmptyRow({ colSpan, loading, noun }) {
  return (
    <tr>
      <td className="sky-muted text-center py-4" colSpan={colSpan}>
        {loading ? `Loading Docker ${noun}…` : `No Docker ${noun} detected.`}
      </td>
    </tr>
  );
}

function ProjectTable({ loading, projects }) {
  return (
    <div className="table-responsive sky-table-card border-0 rounded-0">
      <table className="table table-sm table-hover sky-table align-middle mb-0">
        <thead>
          <tr>
            <th>Project</th>
            <th>State</th>
            <th>Status</th>
            <th className="text-end">Services</th>
            <th className="text-end">Containers</th>
            <th className="text-end">Healthy</th>
          </tr>
        </thead>
        <tbody>
          {projects.length === 0 ? (
            <EmptyRow colSpan={6} loading={loading} noun="projects" />
          ) : (
            projects.map((project) => (
              <tr key={project.name}>
                <td className="fw-semibold">{project.name}</td>
                <td>
                  <StatusPill status={project.state} />
                </td>
                <td>{project.status || '—'}</td>
                <td className="text-end">{project.serviceCount ?? 0}</td>
                <td className="text-end">
                  {project.runningCount ?? 0}/{project.containerCount ?? 0}
                </td>
                <td className="text-end">{project.healthyCount ?? 0}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

function ContainerTable({ containers, loading }) {
  return (
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
            <th>Ports</th>
          </tr>
        </thead>
        <tbody>
          {containers.length === 0 ? (
            <EmptyRow colSpan={7} loading={loading} noun="containers" />
          ) : (
            containers.map((container) => (
              <tr key={container.id || container.name}>
                <td>
                  <div className="fw-semibold">{container.name || '—'}</div>
                  <div className="small sky-muted">{container.id || '—'}</div>
                </td>
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
                <td>{container.ports || '—'}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

function ImageTable({ images, loading }) {
  return (
    <div className="table-responsive sky-table-card border-0 rounded-0">
      <table className="table table-sm table-hover sky-table align-middle mb-0">
        <thead>
          <tr>
            <th>Repository</th>
            <th>Tag</th>
            <th>Image ID</th>
            <th>Size</th>
            <th>Created</th>
            <th className="text-end">Containers</th>
          </tr>
        </thead>
        <tbody>
          {images.length === 0 ? (
            <EmptyRow colSpan={6} loading={loading} noun="images" />
          ) : (
            images.map((image) => (
              <tr key={`${image.id}-${image.repository}-${image.tag}`}>
                <td className="fw-semibold">{image.repository || '—'}</td>
                <td>{image.tag || '—'}</td>
                <td>{image.id || '—'}</td>
                <td>{image.size || '—'}</td>
                <td>{image.createdSince || '—'}</td>
                <td className="text-end">{image.containers || '—'}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

function StorageTables({ loading, networks, volumes }) {
  return (
    <div className="row g-3">
      <div className="col-12 col-xl-6">
        <Panel
          subtitle="Persistent Docker storage resources discovered from the host Engine."
          title="Volumes"
        >
          <div className="table-responsive sky-table-card border-0 rounded-0">
            <table className="table table-sm table-hover sky-table align-middle mb-0">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Driver</th>
                  <th>Scope</th>
                  <th>Mountpoint</th>
                </tr>
              </thead>
              <tbody>
                {volumes.length === 0 ? (
                  <EmptyRow colSpan={4} loading={loading} noun="volumes" />
                ) : (
                  volumes.map((volume) => (
                    <tr key={volume.name}>
                      <td className="fw-semibold">{volume.name}</td>
                      <td>{volume.driver || '—'}</td>
                      <td>{volume.scope || '—'}</td>
                      <td>{volume.mountpoint || '—'}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </Panel>
      </div>
      <div className="col-12 col-xl-6">
        <Panel
          subtitle="Docker network resources and the drivers that back workload connectivity."
          title="Networks"
        >
          <div className="table-responsive sky-table-card border-0 rounded-0">
            <table className="table table-sm table-hover sky-table align-middle mb-0">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Driver</th>
                  <th>Scope</th>
                  <th>IPv6</th>
                  <th>Internal</th>
                </tr>
              </thead>
              <tbody>
                {networks.length === 0 ? (
                  <EmptyRow colSpan={5} loading={loading} noun="networks" />
                ) : (
                  networks.map((network) => (
                    <tr key={network.id || network.name}>
                      <td className="fw-semibold">{network.name}</td>
                      <td>{network.driver || '—'}</td>
                      <td>{network.scope || '—'}</td>
                      <td>{network.ipv6 || '—'}</td>
                      <td>{network.internal || '—'}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </Panel>
      </div>
    </div>
  );
}

function DockerInventory({ view }) {
  const config = VIEW_CONFIG[view] || VIEW_CONFIG.containers;
  const { error, loadOverview, loading, overview, pollingState, refreshingAt } =
    useDockerOverview();
  const projects = Array.isArray(overview?.projects) ? overview.projects : [];
  const containers = Array.isArray(overview?.containers) ? overview.containers : [];
  const images = Array.isArray(overview?.images) ? overview.images : [];
  const volumes = Array.isArray(overview?.volumes) ? overview.volumes : [];
  const networks = Array.isArray(overview?.networks) ? overview.networks : [];

  return (
    <>
      <PageHeader
        actionClassName="sky-dashboard-page-actions"
        actions={
          <DashboardRefreshActions
            activeLabel="Running"
            activeValue={overview?.counts?.running || 0}
            lastRefreshAt={refreshingAt}
            loading={loading}
            onRefresh={() => loadOverview()}
            pollingState={pollingState}
          />
        }
        kicker={config.kicker}
        subtitle={config.subtitle}
        title={config.title}
      />

      {error && <div className="alert alert-danger">{error}</div>}
      {overview?.error && (
        <div className="alert alert-warning">
          <strong>{overview.error.code}</strong> · {overview.error.message}
        </div>
      )}

      {view === 'projects' && (
        <Panel title="Compose Project Inventory">
          <ProjectTable loading={loading} projects={projects} />
        </Panel>
      )}
      {view === 'containers' && (
        <Panel title="Container Inventory">
          <ContainerTable containers={containers} loading={loading} />
        </Panel>
      )}
      {view === 'images' && (
        <Panel title="Image Inventory">
          <ImageTable images={images} loading={loading} />
        </Panel>
      )}
      {view === 'storage' && (
        <StorageTables loading={loading} networks={networks} volumes={volumes} />
      )}
    </>
  );
}

export default DockerInventory;
