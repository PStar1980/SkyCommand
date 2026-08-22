import { useCallback, useEffect, useMemo, useState } from 'react';
import DockerContainerDetailsModal from '../components/DockerContainerDetailsModal.jsx';
import DockerProjectDetailsModal from '../components/DockerProjectDetailsModal.jsx';
import DockerResourceDetailsModal from '../components/DockerResourceDetailsModal.jsx';
import DashboardRefreshActions from '../components/ui/DashboardRefreshActions.jsx';
import PageHeader from '../components/ui/PageHeader.jsx';
import Panel from '../components/ui/Panel.jsx';
import StatusPill from '../components/ui/StatusPill.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import useDockerOverview from '../hooks/useDockerOverview.js';
import infrastructureService from '../services/infrastructureService.js';

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
      'Inspect Docker containers, review bounded logs and runtime metadata, and operate eligible external containers through the Host Agent.',
  },
  images: {
    kicker: 'Docker · Registry',
    title: 'Images',
    subtitle:
      'Inspect Docker image identity, usage relationships, and guarded cleanup eligibility through the Host Agent.',
  },
  storage: {
    kicker: 'Docker · Resources',
    title: 'Storage & Networks',
    subtitle:
      'Inspect Docker volume/network ownership and attachments; persistent data stays protected while unused non-system networks can be cleaned up safely.',
  },
};

const DOCKER_BROWSER_PAGE_SIZE = 10;

const DEFAULT_CONTAINER_FILTERS = {
  q: '',
  project: '',
  state: '',
};

const DEFAULT_IMAGE_FILTERS = {
  q: '',
  repository: '',
  usage: '',
};

function uniqueSorted(values) {
  return [...new Set(values.filter(Boolean))].sort((left, right) =>
    String(left).localeCompare(String(right)),
  );
}

function getImageSelectionKey(image) {
  if (!image) return '';
  return image.reference || `${image.id || ''}:${image.repository || ''}:${image.tag || ''}`;
}

function getResourceReference(resourceType, resource) {
  if (resourceType === 'IMAGE') return resource?.reference || resource?.id;
  return resource?.name || resource?.id;
}

function DockerBrowserPagination({
  ariaLabel,
  filteredCount,
  onPageChange,
  page,
  pageCount,
  rangeEnd,
  rangeStart,
  selectId,
}) {
  return (
    <div className="sky-pagination-row">
      <div className="small sky-muted">
        Showing {rangeStart}-{rangeEnd} of {filteredCount} record(s)
      </div>
      <div className="sky-pagination-controls" aria-label={ariaLabel}>
        <button
          className="btn btn-sm sky-btn-ghost"
          disabled={page <= 1}
          onClick={() => onPageChange(1)}
          type="button"
        >
          First
        </button>
        <button
          className="btn btn-sm sky-btn-ghost"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
          type="button"
        >
          Back
        </button>
        <label className="sky-pagination-select-label" htmlFor={selectId}>
          Page
        </label>
        <select
          className="form-select form-select-sm sky-form-control sky-pagination-select"
          id={selectId}
          onChange={(event) => onPageChange(Number(event.target.value) || 1)}
          value={page}
        >
          {Array.from({ length: pageCount }, (_, index) => index + 1).map((pageNumber) => (
            <option key={pageNumber} value={pageNumber}>
              {pageNumber}
            </option>
          ))}
        </select>
        <span className="small sky-muted">of {pageCount}</span>
        <button
          className="btn btn-sm sky-btn-ghost"
          disabled={page >= pageCount}
          onClick={() => onPageChange(page + 1)}
          type="button"
        >
          Next
        </button>
        <button
          className="btn btn-sm sky-btn-ghost"
          disabled={page >= pageCount}
          onClick={() => onPageChange(pageCount)}
          type="button"
        >
          Last
        </button>
      </div>
    </div>
  );
}

function EmptyRow({ colSpan, loading, noun }) {
  return (
    <tr>
      <td className="sky-muted text-center py-4" colSpan={colSpan}>
        {loading ? `Loading Docker ${noun}…` : `No Docker ${noun} detected.`}
      </td>
    </tr>
  );
}

function ProjectTable({ canControl, controlling, loading, onControl, onDetails, projects }) {
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
            <th>Controls</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {projects.length === 0 ? (
            <EmptyRow colSpan={8} loading={loading} noun="projects" />
          ) : (
            projects.map((project) => {
              const control = project.control || {};
              const actionState = control.actions || {};
              const selfManaged = control.mode === 'SELF_MANAGED_PROTECTED';
              const busy = controlling?.startsWith(`${project.name}:`);

              return (
                <tr key={project.name}>
                  <td>
                    <div className="fw-semibold">{project.name}</div>
                    {selfManaged && (
                      <div className="small sky-muted">
                        Protected control-plane project
                      </div>
                    )}
                  </td>
                  <td>
                    <StatusPill status={project.state} />
                  </td>
                  <td>{project.status || '—'}</td>
                  <td className="text-end">{project.serviceCount ?? 0}</td>
                  <td className="text-end">
                    {project.runningCount ?? 0}/{project.containerCount ?? 0}
                  </td>
                  <td className="text-end">{project.healthyCount ?? 0}</td>
                  <td>
                    {selfManaged ? (
                      <StatusPill label="Self-managed" status="BLOCKED" />
                    ) : !canControl ? (
                      <StatusPill label="Read only" status="INFO" />
                    ) : (
                      <div className="d-flex flex-wrap gap-1">
                        <button
                          className="btn btn-sm sky-btn-primary"
                          disabled={loading || busy || !actionState.start}
                          onClick={() => onControl(project, 'START')}
                          type="button"
                        >
                          {controlling === `${project.name}:START` ? 'Starting…' : 'Start'}
                        </button>
                        <button
                          className="btn btn-sm sky-btn-ghost"
                          disabled={loading || busy || !actionState.stop}
                          onClick={() => onControl(project, 'STOP')}
                          type="button"
                        >
                          {controlling === `${project.name}:STOP` ? 'Stopping…' : 'Stop'}
                        </button>
                        <button
                          className="btn btn-sm sky-btn-ghost"
                          disabled={loading || busy || !actionState.restart}
                          onClick={() => onControl(project, 'RESTART')}
                          type="button"
                        >
                          {controlling === `${project.name}:RESTART` ? 'Restarting…' : 'Restart'}
                        </button>
                      </div>
                    )}
                  </td>
                  <td>
                    <button
                      className="btn btn-sm sky-btn-ghost"
                      disabled={loading}
                      onClick={() => onDetails(project)}
                      type="button"
                    >
                      Project Details
                    </button>
                  </td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}

function ContainerTable({ containers, loading, onSelect, selectedContainerId }) {
  return (
    <div className="table-responsive sky-table-card sky-functional-history-table-card">
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
            <th>Control</th>
          </tr>
        </thead>
        <tbody>
          {containers.length === 0 ? (
            <EmptyRow colSpan={8} loading={loading} noun="containers" />
          ) : (
            containers.map((container) => {
              const selfManaged = container.control?.mode === 'SELF_MANAGED_PROTECTED';
              const selected = selectedContainerId === container.id;

              return (
                <tr
                  className={`sky-clickable-row ${selected ? 'sky-selected-row' : ''}`}
                  key={container.id || container.name}
                  onClick={() => onSelect(container)}
                >
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
                  <td>
                    <StatusPill
                      label={selfManaged ? 'Protected' : 'Host Agent'}
                      status={selfManaged ? 'BLOCKED' : 'READY'}
                    />
                  </td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}

function CleanupPill({ cleanup }) {
  if (cleanup?.mode === 'DATA_PROTECTED') return <StatusPill label="Data protected" status="BLOCKED" />;
  if (cleanup?.mode === 'SYSTEM_PROTECTED') return <StatusPill label="System protected" status="BLOCKED" />;
  if (cleanup?.eligible) return <StatusPill label="Unused" status="READY" />;
  return <StatusPill label={`${cleanup?.usageCount || 0} attachment(s)`} status="WARNING" />;
}

function ImageTable({ images, loading, onSelect, selectedImageKey }) {
  return (
    <div className="table-responsive sky-table-card sky-functional-history-table-card">
      <table className="table table-sm table-hover sky-table align-middle mb-0">
        <thead>
          <tr>
            <th>Repository</th>
            <th>Tag</th>
            <th>Image ID</th>
            <th>Size</th>
            <th>Created</th>
            <th>Usage</th>
            <th>Cleanup</th>
          </tr>
        </thead>
        <tbody>
          {images.length === 0 ? (
            <EmptyRow colSpan={7} loading={loading} noun="images" />
          ) : (
            images.map((image) => {
              const selected = selectedImageKey === getImageSelectionKey(image);
              return (
                <tr
                  className={`sky-clickable-row ${selected ? 'sky-selected-row' : ''}`}
                  key={`${image.id}-${image.repository}-${image.tag}`}
                  onClick={() => onSelect(image)}
                >
                  <td className="fw-semibold">{image.repository || '—'}</td>
                  <td>{image.tag || '—'}</td>
                  <td>{image.id || '—'}</td>
                  <td>{image.size || '—'}</td>
                  <td>{image.createdSince || '—'}</td>
                  <td>{image.cleanup?.usageCount ?? image.containers ?? '—'}</td>
                  <td><CleanupPill cleanup={image.cleanup} /></td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}

function StorageTables({ loading, networks, onDetails, volumes }) {
  return (
    <div className="row g-3">
      <div className="col-12 col-xl-6">
        <Panel
          subtitle="Persistent Docker storage resources with attachment intelligence. Volume deletion remains intentionally unavailable."
          title="Volumes"
        >
          <div className="table-responsive sky-table-card border-0 rounded-0">
            <table className="table table-sm table-hover sky-table align-middle mb-0">
              <thead>
                <tr><th>Name</th><th>Driver</th><th>Scope</th><th>Usage</th><th>Policy</th><th>Actions</th></tr>
              </thead>
              <tbody>
                {volumes.length === 0 ? (
                  <EmptyRow colSpan={6} loading={loading} noun="volumes" />
                ) : (
                  volumes.map((volume) => (
                    <tr key={volume.name}>
                      <td className="fw-semibold">{volume.name}</td>
                      <td>{volume.driver || '—'}</td>
                      <td>{volume.scope || '—'}</td>
                      <td>{volume.cleanup?.usageCount ?? '—'}</td>
                      <td><CleanupPill cleanup={volume.cleanup} /></td>
                      <td>
                        <button className="btn btn-sm sky-btn-ghost" disabled={loading} onClick={() => onDetails('VOLUME', volume)} type="button">
                          Volume Details
                        </button>
                      </td>
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
          subtitle="Docker network resources with endpoint relationships and guarded cleanup for unused non-system networks."
          title="Networks"
        >
          <div className="table-responsive sky-table-card border-0 rounded-0">
            <table className="table table-sm table-hover sky-table align-middle mb-0">
              <thead>
                <tr><th>Name</th><th>Driver</th><th>Scope</th><th>Usage</th><th>Cleanup</th><th>Actions</th></tr>
              </thead>
              <tbody>
                {networks.length === 0 ? (
                  <EmptyRow colSpan={6} loading={loading} noun="networks" />
                ) : (
                  networks.map((network) => (
                    <tr key={network.id || network.name}>
                      <td className="fw-semibold">{network.name}</td>
                      <td>{network.driver || '—'}</td>
                      <td>{network.scope || '—'}</td>
                      <td>{network.cleanup?.usageCount ?? '—'}</td>
                      <td><CleanupPill cleanup={network.cleanup} /></td>
                      <td>
                        <button className="btn btn-sm sky-btn-ghost" disabled={loading} onClick={() => onDetails('NETWORK', network)} type="button">
                          Network Details
                        </button>
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
  );
}

function DockerInventory({ view }) {
  const config = VIEW_CONFIG[view] || VIEW_CONFIG.containers;
  const { hasPermission } = useAuth();
  const canControl = hasPermission('INFRASTRUCTURE_DOCKER_CONTROL');
  const canCleanup = hasPermission('INFRASTRUCTURE_DOCKER_CLEANUP');
  const [controlError, setControlError] = useState('');
  const [controlNotice, setControlNotice] = useState('');
  const [controlling, setControlling] = useState('');
  const [selectedProjectName, setSelectedProjectName] = useState('');
  const [selectedContainerId, setSelectedContainerId] = useState('');
  const [containerDetail, setContainerDetail] = useState(null);
  const [containerDetailError, setContainerDetailError] = useState('');
  const [containerDetailLoading, setContainerDetailLoading] = useState(false);
  const [containerControlling, setContainerControlling] = useState('');
  const [containerFilters, setContainerFilters] = useState(DEFAULT_CONTAINER_FILTERS);
  const [containerPage, setContainerPage] = useState(1);
  const [selectedResource, setSelectedResource] = useState(null);
  const [resourceDetail, setResourceDetail] = useState(null);
  const [resourceDetailError, setResourceDetailError] = useState('');
  const [resourceDetailLoading, setResourceDetailLoading] = useState(false);
  const [resourceControlling, setResourceControlling] = useState('');
  const [imageFilters, setImageFilters] = useState(DEFAULT_IMAGE_FILTERS);
  const [imagePage, setImagePage] = useState(1);
  const { error, loadOverview, loading, overview, pollingState, refreshingAt } =
    useDockerOverview();
  const projects = Array.isArray(overview?.projects) ? overview.projects : [];
  const containers = Array.isArray(overview?.containers) ? overview.containers : [];
  const images = Array.isArray(overview?.images) ? overview.images : [];
  const volumes = Array.isArray(overview?.volumes) ? overview.volumes : [];
  const networks = Array.isArray(overview?.networks) ? overview.networks : [];

  const containerProjectOptions = useMemo(
    () => uniqueSorted(containers.map((container) => container.project || 'Standalone')),
    [containers],
  );
  const containerStateOptions = useMemo(
    () => uniqueSorted(containers.map((container) => container.state)),
    [containers],
  );
  const imageRepositoryOptions = useMemo(
    () => uniqueSorted(images.map((image) => image.repository || '<none>')),
    [images],
  );

  const filteredContainers = useMemo(() => {
    const query = containerFilters.q.trim().toLowerCase();
    return containers.filter((container) => {
      const project = container.project || 'Standalone';
      const health = container.health || 'NONE';
      if (containerFilters.project && project !== containerFilters.project) return false;
      if (containerFilters.state && container.state !== containerFilters.state) return false;
      if (!query) return true;
      return [
        container.name,
        container.id,
        project,
        container.service,
        container.image,
        container.ports,
        container.state,
        health,
      ].some((value) => String(value || '').toLowerCase().includes(query));
    });
  }, [containerFilters, containers]);

  const filteredImages = useMemo(() => {
    const query = imageFilters.q.trim().toLowerCase();
    return images.filter((image) => {
      const repository = image.repository || '<none>';
      const usageCount = image.cleanup?.usageCount ?? image.containers ?? 0;
      if (imageFilters.repository && repository !== imageFilters.repository) return false;
      if (imageFilters.usage === 'USED' && Number(usageCount) <= 0) return false;
      if (imageFilters.usage === 'UNUSED' && Number(usageCount) > 0) return false;
      if (!query) return true;
      return [image.repository, image.tag, image.id, image.reference, image.createdSince, image.size]
        .some((value) => String(value || '').toLowerCase().includes(query));
    });
  }, [imageFilters, images]);

  const containerPageCount = Math.max(
    1,
    Math.ceil(filteredContainers.length / DOCKER_BROWSER_PAGE_SIZE),
  );
  const currentContainerPage = Math.min(containerPage, containerPageCount);
  const pagedContainers = useMemo(() => {
    const offset = (currentContainerPage - 1) * DOCKER_BROWSER_PAGE_SIZE;
    return filteredContainers.slice(offset, offset + DOCKER_BROWSER_PAGE_SIZE);
  }, [currentContainerPage, filteredContainers]);
  const containerRangeStart = filteredContainers.length === 0
    ? 0
    : (currentContainerPage - 1) * DOCKER_BROWSER_PAGE_SIZE + 1;
  const containerRangeEnd = filteredContainers.length === 0
    ? 0
    : Math.min(currentContainerPage * DOCKER_BROWSER_PAGE_SIZE, filteredContainers.length);

  const imagePageCount = Math.max(1, Math.ceil(filteredImages.length / DOCKER_BROWSER_PAGE_SIZE));
  const currentImagePage = Math.min(imagePage, imagePageCount);
  const pagedImages = useMemo(() => {
    const offset = (currentImagePage - 1) * DOCKER_BROWSER_PAGE_SIZE;
    return filteredImages.slice(offset, offset + DOCKER_BROWSER_PAGE_SIZE);
  }, [currentImagePage, filteredImages]);
  const imageRangeStart = filteredImages.length === 0
    ? 0
    : (currentImagePage - 1) * DOCKER_BROWSER_PAGE_SIZE + 1;
  const imageRangeEnd = filteredImages.length === 0
    ? 0
    : Math.min(currentImagePage * DOCKER_BROWSER_PAGE_SIZE, filteredImages.length);
  const selectedImageKey = selectedResource?.resourceType === 'IMAGE'
    ? getImageSelectionKey(selectedResource.resource)
    : '';

  useEffect(() => {
    if (containerPage > containerPageCount) setContainerPage(containerPageCount);
  }, [containerPage, containerPageCount]);

  useEffect(() => {
    if (imagePage > imagePageCount) setImagePage(imagePageCount);
  }, [imagePage, imagePageCount]);

  const loadContainerDetail = useCallback(async (containerId) => {
    if (!containerId) return;
    setContainerDetailLoading(true);
    setContainerDetailError('');
    try {
      const result = await infrastructureService.getDockerContainerDetail(containerId, { tail: 200 });
      setContainerDetail(result.detail || null);
    } catch (detailFailure) {
      const code = detailFailure.details?.code;
      setContainerDetailError(
        code
          ? `${code} · ${detailFailure.message || 'Docker container inspection failed.'}`
          : detailFailure.message || 'Docker container inspection failed.',
      );
    } finally {
      setContainerDetailLoading(false);
    }
  }, []);

  const selectContainer = useCallback((container) => {
    if (!container?.id) return;
    setSelectedContainerId(container.id);
    setContainerDetail(null);
    setContainerDetailError('');
    setContainerControlling('');
    loadContainerDetail(container.id);
  }, [loadContainerDetail]);

  const loadResourceDetail = useCallback(async (resourceType, resource) => {
    const reference = getResourceReference(resourceType, resource);
    if (!resourceType || !reference) return;
    setResourceDetailLoading(true);
    setResourceDetailError('');
    try {
      const result = await infrastructureService.getDockerResourceDetail(resourceType, reference);
      setResourceDetail(result.detail || null);
    } catch (detailFailure) {
      const code = detailFailure.details?.code;
      setResourceDetailError(
        code
          ? `${code} · ${detailFailure.message || 'Docker resource inspection failed.'}`
          : detailFailure.message || 'Docker resource inspection failed.',
      );
    } finally {
      setResourceDetailLoading(false);
    }
  }, []);

  const selectImage = useCallback((image) => {
    if (!getResourceReference('IMAGE', image)) return;
    setSelectedResource({ resourceType: 'IMAGE', resource: image });
    setResourceDetail(null);
    setResourceDetailError('');
    setResourceControlling('');
    loadResourceDetail('IMAGE', image);
  }, [loadResourceDetail]);

  useEffect(() => {
    if (view !== 'containers' || loading) return;
    if (pagedContainers.some((container) => container.id === selectedContainerId)) return;
    const firstContainer = pagedContainers[0];
    if (firstContainer?.id) {
      selectContainer(firstContainer);
      return;
    }
    setSelectedContainerId('');
    setContainerDetail(null);
    setContainerDetailError('');
  }, [loading, pagedContainers, selectContainer, selectedContainerId, view]);

  useEffect(() => {
    if (view !== 'images' || loading) return;
    if (pagedImages.some((image) => getImageSelectionKey(image) === selectedImageKey)) return;
    const firstImage = pagedImages[0];
    if (firstImage) {
      selectImage(firstImage);
      return;
    }
    setSelectedResource(null);
    setResourceDetail(null);
    setResourceDetailError('');
  }, [loading, pagedImages, selectImage, selectedImageKey, view]);

  function updateContainerFilter(name, value) {
    setContainerFilters((current) => ({ ...current, [name]: value }));
    setContainerPage(1);
  }

  function clearContainerFilters() {
    setContainerFilters(DEFAULT_CONTAINER_FILTERS);
    setContainerPage(1);
  }

  function updateImageFilter(name, value) {
    setImageFilters((current) => ({ ...current, [name]: value }));
    setImagePage(1);
  }

  function clearImageFilters() {
    setImageFilters(DEFAULT_IMAGE_FILTERS);
    setImagePage(1);
  }

  async function handleProjectControl(project, action) {
    if (!project?.name || !canControl) return;
    const verb = action.charAt(0) + action.slice(1).toLowerCase();
    const confirmed = window.confirm(
      `${verb} Docker Compose project ${project.name}? This action runs through the host-native SkyCommand Host Agent and will be written to Docker Operations.`,
    );
    if (!confirmed) return;
    setControlling(`${project.name}:${action}`);
    setControlError('');
    setControlNotice('');
    try {
      const result = await infrastructureService.controlDockerComposeProject(project.name, action);
      setControlNotice(result.operation?.message || `${verb} completed for ${project.name}.`);
      await loadOverview();
    } catch (controlFailure) {
      const code = controlFailure.details?.code;
      setControlError(
        code
          ? `${code} · ${controlFailure.message || 'Docker lifecycle action failed.'}`
          : controlFailure.message || 'Docker lifecycle action failed.',
      );
    } finally {
      setControlling('');
    }
  }

  function openProjectDetails(project) {
    if (!project?.name) return;
    setSelectedProjectName(project.name);
    setControlError('');
    setControlNotice('');
  }

  function closeProjectDetails() {
    setSelectedProjectName('');
  }

  async function handleContainerControl(container, action) {
    if (!container?.id || !canControl) return;
    const label = action.charAt(0) + action.slice(1).toLowerCase();
    const confirmed = window.confirm(
      `${label} Docker container ${container.name || container.id}? This operation is allow-listed through the SkyCommand Host Agent and will be written to Docker Operations.`,
    );
    if (!confirmed) return;
    setContainerControlling(action);
    setControlError('');
    setControlNotice('');
    try {
      const result = await infrastructureService.controlDockerContainer(container.id, action);
      setControlNotice(
        result.operation?.message || `${label} completed for ${container.name || container.id}.`,
      );
      await loadOverview();
      await loadContainerDetail(container.id);
    } catch (controlFailure) {
      const code = controlFailure.details?.code;
      const message = code
        ? `${code} · ${controlFailure.message || 'Docker container lifecycle action failed.'}`
        : controlFailure.message || 'Docker container lifecycle action failed.';
      setControlError(message);
      setContainerDetailError(message);
    } finally {
      setContainerControlling('');
    }
  }

  function openResourceDetails(resourceType, resource) {
    const selected = { resourceType, resource };
    setSelectedResource(selected);
    setResourceDetail(null);
    setResourceDetailError('');
    loadResourceDetail(resourceType, resource);
  }

  function closeResourceDetails() {
    setSelectedResource(null);
    setResourceDetail(null);
    setResourceDetailError('');
    setResourceControlling('');
  }

  async function handleResourceControl(resource, action) {
    const resourceType = selectedResource?.resourceType;
    const reference = getResourceReference(resourceType, resource);
    if (!resourceType || !reference || !canCleanup) return;
    const confirmed = window.confirm(
      `Remove unused Docker ${resourceType.toLowerCase()} ${reference}? SkyCommand will re-check live attachments through the Host Agent before removal and record the result in Docker Operations.`,
    );
    if (!confirmed) return;
    setResourceControlling(action);
    setControlError('');
    setControlNotice('');
    try {
      const result = await infrastructureService.controlDockerResource(resourceType, reference, action);
      setControlNotice(result.operation?.message || `${action} completed for ${reference}.`);
      await loadOverview();
      if (resourceType === 'IMAGE' && view === 'images') {
        setSelectedResource(null);
        setResourceDetail(null);
        setResourceDetailError('');
      } else {
        closeResourceDetails();
      }
    } catch (controlFailure) {
      const code = controlFailure.details?.code;
      const message = code
        ? `${code} · ${controlFailure.message || 'Docker cleanup failed.'}`
        : controlFailure.message || 'Docker cleanup failed.';
      setControlError(message);
      setResourceDetailError(message);
    } finally {
      setResourceControlling('');
    }
  }

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
      {controlError && <div className="alert alert-danger">{controlError}</div>}
      {controlNotice && <div className="alert alert-success">{controlNotice}</div>}
      {overview?.error && (
        <div className="alert alert-warning">
          <strong>{overview.error.code}</strong> · {overview.error.message}
          {overview.error.details?.component && (
            <div className="small mt-1">
              Failure domain: {overview.error.details.component.replace(/_/g, ' ')} · Host Agent{' '}
              {overview.error.details.hostAgentStatus || overview?.target?.status || 'UNKNOWN'}{' '}
              · Docker provider{' '}
              {overview.error.details.dockerProviderStatus || overview?.provider?.status || 'UNKNOWN'}
            </div>
          )}
        </div>
      )}

      {view === 'projects' && (
        <Panel title="Compose Project Inventory">
          <ProjectTable
            canControl={canControl}
            controlling={controlling}
            loading={loading}
            onControl={handleProjectControl}
            onDetails={openProjectDetails}
            projects={projects}
          />
        </Panel>
      )}

      {view === 'containers' && (
        <>
          <section className="sky-card mb-4 sky-workflow-history-browser sky-docker-record-browser">
            <div className="sky-card-header">
              <div>
                <div className="sky-page-kicker">Container browser</div>
                <h2 className="h5 mb-0">Container inventory</h2>
                <p className="sky-muted small mb-0">
                  Search and filter the runtime inventory, then inspect the selected container in the detail workspace below.
                </p>
              </div>
              <div className="sky-history-browser-filter-grid">
                <div className="sky-run-tools-search-filter">
                  <label className="form-label" htmlFor="dockerContainerSearch">Search</label>
                  <input
                    className="form-control sky-form-control"
                    id="dockerContainerSearch"
                    onChange={(event) => updateContainerFilter('q', event.target.value)}
                    placeholder="Container, project, service, image..."
                    type="search"
                    value={containerFilters.q}
                  />
                </div>
                <div>
                  <label className="form-label" htmlFor="dockerContainerProjectFilter">Project</label>
                  <select
                    className="form-select sky-form-control"
                    id="dockerContainerProjectFilter"
                    onChange={(event) => updateContainerFilter('project', event.target.value)}
                    value={containerFilters.project}
                  >
                    <option value="">All projects</option>
                    {containerProjectOptions.map((project) => <option key={project} value={project}>{project}</option>)}
                  </select>
                </div>
                <div>
                  <label className="form-label" htmlFor="dockerContainerStateFilter">State</label>
                  <select
                    className="form-select sky-form-control"
                    id="dockerContainerStateFilter"
                    onChange={(event) => updateContainerFilter('state', event.target.value)}
                    value={containerFilters.state}
                  >
                    <option value="">All states</option>
                    {containerStateOptions.map((state) => <option key={state} value={state}>{state}</option>)}
                  </select>
                </div>
                <div className="sky-run-tools-filter-actions">
                  <button className="btn btn-sm sky-btn-ghost" onClick={clearContainerFilters} type="button">
                    Clear filters
                  </button>
                </div>
              </div>
            </div>
            <ContainerTable
              containers={pagedContainers}
              loading={loading}
              onSelect={selectContainer}
              selectedContainerId={selectedContainerId}
            />
            <DockerBrowserPagination
              ariaLabel="Docker container pagination"
              filteredCount={filteredContainers.length}
              onPageChange={setContainerPage}
              page={currentContainerPage}
              pageCount={containerPageCount}
              rangeEnd={containerRangeEnd}
              rangeStart={containerRangeStart}
              selectId="dockerContainerPageSelect"
            />
          </section>

          {selectedContainerId && (
            <DockerContainerDetailsModal
              canControl={canControl}
              controlling={containerControlling}
              detail={containerDetail}
              embedded
              error={containerDetailError}
              loading={containerDetailLoading}
              onControl={handleContainerControl}
              onRefresh={() => loadContainerDetail(selectedContainerId)}
            />
          )}
        </>
      )}

      {view === 'images' && (
        <>
          <section className="sky-card mb-4 sky-workflow-history-browser sky-docker-record-browser">
            <div className="sky-card-header">
              <div>
                <div className="sky-page-kicker">Image browser</div>
                <h2 className="h5 mb-0">Image inventory</h2>
                <p className="sky-muted small mb-0">
                  Search and filter image references, then inspect usage and cleanup policy in the selected-image workspace below.
                </p>
              </div>
              <div className="sky-history-browser-filter-grid">
                <div className="sky-run-tools-search-filter">
                  <label className="form-label" htmlFor="dockerImageSearch">Search</label>
                  <input
                    className="form-control sky-form-control"
                    id="dockerImageSearch"
                    onChange={(event) => updateImageFilter('q', event.target.value)}
                    placeholder="Repository, tag, image ID..."
                    type="search"
                    value={imageFilters.q}
                  />
                </div>
                <div>
                  <label className="form-label" htmlFor="dockerImageRepositoryFilter">Repository</label>
                  <select
                    className="form-select sky-form-control"
                    id="dockerImageRepositoryFilter"
                    onChange={(event) => updateImageFilter('repository', event.target.value)}
                    value={imageFilters.repository}
                  >
                    <option value="">All repositories</option>
                    {imageRepositoryOptions.map((repository) => (
                      <option key={repository} value={repository}>{repository}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="form-label" htmlFor="dockerImageUsageFilter">Usage</label>
                  <select
                    className="form-select sky-form-control"
                    id="dockerImageUsageFilter"
                    onChange={(event) => updateImageFilter('usage', event.target.value)}
                    value={imageFilters.usage}
                  >
                    <option value="">All usage</option>
                    <option value="USED">Attached</option>
                    <option value="UNUSED">Unused</option>
                  </select>
                </div>
                <div className="sky-run-tools-filter-actions">
                  <button className="btn btn-sm sky-btn-ghost" onClick={clearImageFilters} type="button">
                    Clear filters
                  </button>
                </div>
              </div>
            </div>
            <ImageTable
              images={pagedImages}
              loading={loading}
              onSelect={selectImage}
              selectedImageKey={selectedImageKey}
            />
            <DockerBrowserPagination
              ariaLabel="Docker image pagination"
              filteredCount={filteredImages.length}
              onPageChange={setImagePage}
              page={currentImagePage}
              pageCount={imagePageCount}
              rangeEnd={imageRangeEnd}
              rangeStart={imageRangeStart}
              selectId="dockerImagePageSelect"
            />
          </section>

          {selectedResource?.resourceType === 'IMAGE' && (
            <DockerResourceDetailsModal
              canCleanup={canCleanup}
              controlling={resourceControlling}
              detail={resourceDetail}
              embedded
              error={resourceDetailError}
              loading={resourceDetailLoading}
              onControl={handleResourceControl}
              onRefresh={() => loadResourceDetail('IMAGE', selectedResource.resource)}
              resourceTypeHint="IMAGE"
            />
          )}
        </>
      )}

      {view === 'storage' && (
        <StorageTables
          loading={loading}
          networks={networks}
          onDetails={openResourceDetails}
          volumes={volumes}
        />
      )}

      {selectedProjectName && (
        <DockerProjectDetailsModal
          canControl={canControl}
          containers={containers}
          controlError={controlError}
          controlNotice={controlNotice}
          controlling={controlling}
          onClose={closeProjectDetails}
          onControl={handleProjectControl}
          onRefresh={() => loadOverview()}
          project={projects.find((project) => project.name === selectedProjectName) || { name: selectedProjectName }}
        />
      )}

      {selectedResource && selectedResource.resourceType !== 'IMAGE' && (
        <DockerResourceDetailsModal
          canCleanup={canCleanup}
          controlling={resourceControlling}
          detail={resourceDetail}
          error={resourceDetailError}
          loading={resourceDetailLoading}
          onClose={closeResourceDetails}
          onControl={handleResourceControl}
          onRefresh={() => loadResourceDetail(selectedResource.resourceType, selectedResource.resource)}
        />
      )}
    </>
  );
}

export default DockerInventory;
