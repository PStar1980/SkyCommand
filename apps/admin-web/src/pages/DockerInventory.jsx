import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import DockerContainerDetailsModal from '../components/DockerContainerDetailsModal.jsx';
import DockerProjectDetailsModal from '../components/DockerProjectDetailsModal.jsx';
import DockerResourceDetailsModal from '../components/DockerResourceDetailsModal.jsx';
import DashboardRefreshActions from '../components/ui/DashboardRefreshActions.jsx';
import PageHeader from '../components/ui/PageHeader.jsx';
import StatusPill from '../components/ui/StatusPill.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import useDockerOverview from '../hooks/useDockerOverview.js';
import infrastructureService from '../services/infrastructureService.js';
import {
  getAvailableTablePageSizes,
  getPageForAbsoluteIndex,
  normalizeTablePageSize,
  SMART_TABLE_DEFAULT_PAGE_SIZE,
} from '../utils/tablePageSize.js';
import { getNextSortState } from '../utils/tableSorting.js';

import DismissibleAlert from '../components/ui/DismissibleAlert.jsx';
const VIEW_CONFIG = {
  projects: {
    kicker: 'Docker · Compose',
    title: 'Projects',
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
    kicker: 'Docker · Storage',
    title: 'Storage',
    subtitle:
      'Inspect Docker volume ownership and attachments while persistent application data remains protected from deletion.',
  },
  networks: {
    kicker: 'Docker · Networking',
    title: 'Networks',
    subtitle:
      'Inspect Docker network topology, endpoint relationships, and guarded cleanup eligibility for unused non-system networks.',
  },
};

const DOCKER_BROWSER_DEFAULT_PAGE_SIZE = SMART_TABLE_DEFAULT_PAGE_SIZE;

const DOCKER_INVENTORY_DEFAULT_SORTS = {
  projects: [{ field: 'name', direction: 'asc' }],
  containers: [{ field: 'name', direction: 'asc' }],
  images: [
    { field: 'repository', direction: 'asc' },
    { field: 'tag', direction: 'asc' },
  ],
  storage: [{ field: 'name', direction: 'asc' }],
  networks: [{ field: 'name', direction: 'asc' }],
};

const DEFAULT_PROJECT_FILTERS = {
  q: '',
  state: '',
  status: '',
};

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

const DEFAULT_STORAGE_FILTERS = {
  q: '',
  driver: '',
  scope: '',
};

const DEFAULT_NETWORK_FILTERS = {
  q: '',
  driver: '',
  cleanup: '',
};

function uniqueSorted(values) {
  return [...new Set(values.filter(Boolean))].sort((left, right) =>
    String(left).localeCompare(String(right)),
  );
}

function getCleanupSortValue(cleanup = {}) {
  if (cleanup.mode === 'DATA_PROTECTED') return 'DATA_PROTECTED';
  if (cleanup.mode === 'SYSTEM_PROTECTED') return 'SYSTEM_PROTECTED';
  if (cleanup.eligible) return 'UNUSED';
  if (Number(cleanup.usageCount || 0) > 0) return 'ATTACHED';
  return 'PROTECTED';
}

function parseDockerSize(value) {
  const source = String(value || '').trim().toLowerCase();
  const match = source.match(/^([0-9]+(?:\.[0-9]+)?)\s*([kmgtp]?b)$/i);
  if (!match) return source;

  const units = { b: 1, kb: 1e3, mb: 1e6, gb: 1e9, tb: 1e12, pb: 1e15 };
  return Number(match[1]) * (units[match[2].toLowerCase()] || 1);
}

function parseDockerAge(value) {
  const source = String(value || '').trim().toLowerCase();
  if (!source) return '';
  if (source.includes('less than a second')) return 0;
  if (source.includes('about a minute') || source.includes('about one minute')) return 60;
  if (source.includes('about an hour') || source.includes('about one hour')) return 3600;

  const match = source.match(/([0-9]+(?:\.[0-9]+)?)\s*(second|minute|hour|day|week|month|year)s?/);
  if (!match) return source;

  const units = {
    second: 1,
    minute: 60,
    hour: 3600,
    day: 86400,
    week: 604800,
    month: 2629800,
    year: 31557600,
  };
  return Number(match[1]) * units[match[2]];
}

function getInventorySortValue(view, item, field) {
  if (view === 'projects') {
    if (field === 'containerCount') return Number(item.containerCount || 0);
    if (field === 'serviceCount') return Number(item.serviceCount || 0);
    if (field === 'healthyCount') return Number(item.healthyCount || 0);
    return item[field] || '';
  }

  if (view === 'containers') {
    if (field === 'control') return item.control?.mode || '';
    return item[field] || '';
  }

  if (view === 'images') {
    if (field === 'size') return parseDockerSize(item.size);
    if (field === 'createdSince') return parseDockerAge(item.createdSince);
    if (field === 'usage') return Number(item.cleanup?.usageCount ?? item.containers ?? 0);
    if (field === 'cleanup') return getCleanupSortValue(item.cleanup);
    return item[field] || '';
  }

  if (view === 'storage') {
    if (field === 'usage') return Number(item.cleanup?.usageCount ?? 0);
    if (field === 'policy') return getCleanupSortValue(item.cleanup);
    return item[field] || '';
  }

  if (view === 'networks') {
    if (field === 'usage') return Number(item.cleanup?.usageCount ?? 0);
    if (field === 'cleanup') return getCleanupSortValue(item.cleanup);
    return item[field] || '';
  }

  return item[field] || '';
}

function compareInventoryValues(leftValue, rightValue) {
  const leftEmpty = leftValue === '' || leftValue === null || leftValue === undefined;
  const rightEmpty = rightValue === '' || rightValue === null || rightValue === undefined;
  if (leftEmpty && rightEmpty) return 0;
  if (leftEmpty) return 1;
  if (rightEmpty) return -1;

  if (typeof leftValue === 'number' && typeof rightValue === 'number') {
    return leftValue - rightValue;
  }

  return String(leftValue).localeCompare(String(rightValue), undefined, {
    numeric: true,
    sensitivity: 'base',
  });
}

function sortInventoryItems(items, sorts, view) {
  if (!Array.isArray(sorts) || sorts.length === 0) return items;

  return [...items].sort((left, right) => {
    for (const sort of sorts) {
      const comparison = compareInventoryValues(
        getInventorySortValue(view, left, sort.field),
        getInventorySortValue(view, right, sort.field),
      );
      if (comparison !== 0) return sort.direction === 'desc' ? -comparison : comparison;
    }
    return 0;
  });
}

function DockerSortableHeader({ align = 'start', field, label, onSort, sorts }) {
  const activeIndex = sorts.findIndex((sort) => sort.field === field);
  const activeSort = activeIndex >= 0 ? sorts[activeIndex] : null;
  const directionIcon = activeSort?.direction === 'asc' ? '↑' : '↓';
  const sortDescription = activeSort
    ? `${activeSort.direction === 'asc' ? 'ascending' : 'descending'}, priority ${activeIndex + 1}`
    : 'not currently sorted';

  return (
    <th className={align === 'end' ? 'text-end' : undefined}>
      <button
        aria-label={`${label}: ${sortDescription}. Click to sort; Shift+click to add to multi-column sorting.`}
        className={`sky-table-sort-button ${activeSort ? 'is-active' : ''}`}
        onClick={(event) => onSort(field, event)}
        title="Click to sort · Shift+click to add sort"
        type="button"
      >
        <span>{label}</span>
        <span className="sky-table-sort-indicator" aria-hidden="true">
          {activeSort ? directionIcon : '↕'}
        </span>
        {activeSort && (
          <span className="sky-table-sort-priority" aria-hidden="true">
            {activeIndex + 1}
          </span>
        )}
      </button>
    </th>
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
  availablePageSizes,
  filteredCount,
  onPageChange,
  onPageSizeChange,
  page,
  pageCount,
  pageSize,
  rangeEnd,
  rangeStart,
  rowsSelectId,
  selectId,
}) {
  return (
    <div className="sky-pagination-row sky-canonical-operations-pagination-row">
      <div className="small sky-muted sky-canonical-operations-pagination-summary">
        Showing {rangeStart}–{rangeEnd} of {filteredCount} record(s)
      </div>
      <div className="sky-pagination-controls sky-canonical-operations-pagination-controls" aria-label={ariaLabel}>
        <button
          aria-label="First page"
          className="btn btn-sm sky-btn-ghost sky-pagination-nav-button"
          disabled={page <= 1}
          onClick={() => onPageChange(1)}
          title="First page"
          type="button"
        >
          «
        </button>
        <button
          aria-label="Previous page"
          className="btn btn-sm sky-btn-ghost sky-pagination-nav-button"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
          title="Previous page"
          type="button"
        >
          ‹
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
          aria-label="Next page"
          className="btn btn-sm sky-btn-ghost sky-pagination-nav-button"
          disabled={page >= pageCount}
          onClick={() => onPageChange(page + 1)}
          title="Next page"
          type="button"
        >
          ›
        </button>
        <button
          aria-label="Last page"
          className="btn btn-sm sky-btn-ghost sky-pagination-nav-button"
          disabled={page >= pageCount}
          onClick={() => onPageChange(pageCount)}
          title="Last page"
          type="button"
        >
          »
        </button>
      </div>
      <div className="sky-canonical-rows-control">
        <label className="sky-pagination-select-label" htmlFor={rowsSelectId}>Rows</label>
        <select
          className="form-select form-select-sm sky-form-control sky-pagination-select sky-canonical-rows-select"
          id={rowsSelectId}
          onChange={(event) => onPageSizeChange(event.target.value)}
          value={pageSize}
        >
          {availablePageSizes.map((size) => (
            <option key={size} value={size}>{size}</option>
          ))}
        </select>
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

function ProjectTable({ loading, onSelect, onSort, projects, selectedProjectName, sorts }) {
  return (
    <div className="table-responsive sky-table-card sky-functional-history-table-card sky-canonical-operations-table-frame">
      <table className="table table-sm table-hover sky-table sky-canonical-operations-table align-middle mb-0">
        <thead>
          <tr>
            <DockerSortableHeader field="name" label="Project" onSort={onSort} sorts={sorts} />
            <DockerSortableHeader field="state" label="State" onSort={onSort} sorts={sorts} />
            <DockerSortableHeader field="status" label="Status" onSort={onSort} sorts={sorts} />
            <DockerSortableHeader align="end" field="serviceCount" label="Services" onSort={onSort} sorts={sorts} />
            <DockerSortableHeader align="end" field="containerCount" label="Containers" onSort={onSort} sorts={sorts} />
            <DockerSortableHeader align="end" field="healthyCount" label="Healthy" onSort={onSort} sorts={sorts} />
          </tr>
        </thead>
        <tbody>
          {projects.length === 0 ? (
            <EmptyRow colSpan={6} loading={loading} noun="projects" />
          ) : (
            projects.map((project) => {
              const selfManaged = project.control?.mode === 'SELF_MANAGED_PROTECTED';
              const selected = selectedProjectName === project.name;

              return (
                <tr
                  className={`sky-clickable-row ${selected ? 'sky-selected-row' : ''}`}
                  key={project.name}
                  onClick={() => onSelect(project)}
                >
                  <td>
                    <div className="fw-bold">{project.name}</div>
                    {selfManaged && (
                      <div className="small sky-muted">Supervisor-managed control-plane project</div>
                    )}
                  </td>
                  <td><StatusPill status={project.state} /></td>
                  <td>{project.status || '—'}</td>
                  <td className="text-end">{project.serviceCount ?? 0}</td>
                  <td className="text-end">
                    {project.runningCount ?? 0}/{project.containerCount ?? 0}
                  </td>
                  <td className="text-end">{project.healthyCount ?? 0}</td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}

function ContainerTable({ containers, loading, onSelect, onSort, selectedContainerId, sorts }) {
  return (
    <div className="table-responsive sky-table-card sky-functional-history-table-card sky-canonical-operations-table-frame">
      <table className="table table-sm table-hover sky-table sky-canonical-operations-table align-middle mb-0">
        <thead>
          <tr>
            <DockerSortableHeader field="name" label="Container" onSort={onSort} sorts={sorts} />
            <DockerSortableHeader field="project" label="Project" onSort={onSort} sorts={sorts} />
            <DockerSortableHeader field="service" label="Service" onSort={onSort} sorts={sorts} />
            <DockerSortableHeader field="image" label="Image" onSort={onSort} sorts={sorts} />
            <DockerSortableHeader field="state" label="State" onSort={onSort} sorts={sorts} />
            <DockerSortableHeader field="health" label="Health" onSort={onSort} sorts={sorts} />
            <DockerSortableHeader field="ports" label="Ports" onSort={onSort} sorts={sorts} />
            <DockerSortableHeader field="control" label="Control" onSort={onSort} sorts={sorts} />
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
                    <div className="fw-bold">{container.name || '—'}</div>
                    <div className="small sky-mono sky-muted">{container.id || '—'}</div>
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

function ImageTable({ images, loading, onSelect, onSort, selectedImageKey, sorts }) {
  return (
    <div className="table-responsive sky-table-card sky-functional-history-table-card sky-canonical-operations-table-frame">
      <table className="table table-sm table-hover sky-table sky-canonical-operations-table align-middle mb-0">
        <thead>
          <tr>
            <DockerSortableHeader field="repository" label="Repository" onSort={onSort} sorts={sorts} />
            <DockerSortableHeader field="tag" label="Tag" onSort={onSort} sorts={sorts} />
            <DockerSortableHeader field="id" label="Image ID" onSort={onSort} sorts={sorts} />
            <DockerSortableHeader field="size" label="Size" onSort={onSort} sorts={sorts} />
            <DockerSortableHeader field="createdSince" label="Created" onSort={onSort} sorts={sorts} />
            <DockerSortableHeader field="usage" label="Usage" onSort={onSort} sorts={sorts} />
            <DockerSortableHeader field="cleanup" label="Cleanup" onSort={onSort} sorts={sorts} />
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
                  <td className="fw-bold">{image.repository || '—'}</td>
                  <td>{image.tag || '—'}</td>
                  <td className="sky-mono">{image.id || '—'}</td>
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

function StorageTable({ loading, onSelect, onSort, selectedVolumeName, sorts, volumes }) {
  return (
    <div className="table-responsive sky-table-card sky-functional-history-table-card sky-canonical-operations-table-frame">
      <table className="table table-sm table-hover sky-table sky-canonical-operations-table align-middle mb-0">
        <thead>
          <tr>
            <DockerSortableHeader field="name" label="Name" onSort={onSort} sorts={sorts} />
            <DockerSortableHeader field="driver" label="Driver" onSort={onSort} sorts={sorts} />
            <DockerSortableHeader field="scope" label="Scope" onSort={onSort} sorts={sorts} />
            <DockerSortableHeader field="usage" label="Usage" onSort={onSort} sorts={sorts} />
            <DockerSortableHeader field="policy" label="Policy" onSort={onSort} sorts={sorts} />
          </tr>
        </thead>
        <tbody>
          {volumes.length === 0 ? (
            <EmptyRow colSpan={5} loading={loading} noun="volumes" />
          ) : (
            volumes.map((volume) => {
              const selected = selectedVolumeName === volume.name;
              return (
                <tr
                  className={`sky-clickable-row ${selected ? 'sky-selected-row' : ''}`}
                  key={volume.name}
                  onClick={() => onSelect(volume)}
                >
                  <td className="fw-bold">{volume.name}</td>
                  <td>{volume.driver || '—'}</td>
                  <td>{volume.scope || '—'}</td>
                  <td>{volume.cleanup?.usageCount ?? '—'}</td>
                  <td><CleanupPill cleanup={volume.cleanup} /></td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}

function NetworkTable({ loading, networks, onSelect, onSort, selectedNetworkName, sorts }) {
  return (
    <div className="table-responsive sky-table-card sky-functional-history-table-card sky-canonical-operations-table-frame">
      <table className="table table-sm table-hover sky-table sky-canonical-operations-table align-middle mb-0">
        <thead>
          <tr>
            <DockerSortableHeader field="name" label="Name" onSort={onSort} sorts={sorts} />
            <DockerSortableHeader field="driver" label="Driver" onSort={onSort} sorts={sorts} />
            <DockerSortableHeader field="scope" label="Scope" onSort={onSort} sorts={sorts} />
            <DockerSortableHeader field="usage" label="Usage" onSort={onSort} sorts={sorts} />
            <DockerSortableHeader field="cleanup" label="Cleanup" onSort={onSort} sorts={sorts} />
          </tr>
        </thead>
        <tbody>
          {networks.length === 0 ? (
            <EmptyRow colSpan={5} loading={loading} noun="networks" />
          ) : (
            networks.map((network) => {
              const selected = selectedNetworkName === network.name;
              return (
                <tr
                  className={`sky-clickable-row ${selected ? 'sky-selected-row' : ''}`}
                  key={network.id || network.name}
                  onClick={() => onSelect(network)}
                >
                  <td className="fw-bold">{network.name}</td>
                  <td>{network.driver || '—'}</td>
                  <td>{network.scope || '—'}</td>
                  <td>{network.cleanup?.usageCount ?? '—'}</td>
                  <td><CleanupPill cleanup={network.cleanup} /></td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}

function DockerInventory({ view }) {
  const config = VIEW_CONFIG[view] || VIEW_CONFIG.containers;
  const inventoryDefaultSorts = DOCKER_INVENTORY_DEFAULT_SORTS[view] || [];
  const [searchParams] = useSearchParams();
  const initialQuery = (searchParams.get('q') || '').trim();
  const initialProjectFilter = (searchParams.get('project') || '').trim();
  const { hasPermission } = useAuth();
  const canControl = hasPermission('INFRASTRUCTURE_DOCKER_CONTROL');
  const canCleanup = hasPermission('INFRASTRUCTURE_DOCKER_CLEANUP');
  const [controlError, setControlError] = useState('');
  const [sorts, setSorts] = useState(() => inventoryDefaultSorts);
  const [sortingCustomized, setSortingCustomized] = useState(false);
  const [controlNotice, setControlNotice] = useState('');
  const [controlling, setControlling] = useState('');
  const [selectedProjectName, setSelectedProjectName] = useState('');
  const [projectFilters, setProjectFilters] = useState(() =>
    view === 'projects' && initialQuery
      ? { ...DEFAULT_PROJECT_FILTERS, q: initialQuery }
      : DEFAULT_PROJECT_FILTERS,
  );
  const [projectPage, setProjectPage] = useState(1);
  const [selectedContainerId, setSelectedContainerId] = useState('');
  const [containerDetail, setContainerDetail] = useState(null);
  const [containerDetailError, setContainerDetailError] = useState('');
  const [containerDetailLoading, setContainerDetailLoading] = useState(false);
  const [containerControlling, setContainerControlling] = useState('');
  const [containerFilters, setContainerFilters] = useState(() =>
    view === 'containers'
      ? { ...DEFAULT_CONTAINER_FILTERS, q: initialQuery, project: initialProjectFilter }
      : DEFAULT_CONTAINER_FILTERS,
  );
  const [containerPage, setContainerPage] = useState(1);
  const [selectedResource, setSelectedResource] = useState(null);
  const [resourceDetail, setResourceDetail] = useState(null);
  const [resourceDetailError, setResourceDetailError] = useState('');
  const [resourceDetailLoading, setResourceDetailLoading] = useState(false);
  const [resourceControlling, setResourceControlling] = useState('');
  const [imageFilters, setImageFilters] = useState(() =>
    view === 'images' && initialQuery
      ? { ...DEFAULT_IMAGE_FILTERS, q: initialQuery }
      : DEFAULT_IMAGE_FILTERS,
  );
  const [imagePage, setImagePage] = useState(1);
  const [storageFilters, setStorageFilters] = useState(DEFAULT_STORAGE_FILTERS);
  const [storagePage, setStoragePage] = useState(1);
  const [networkFilters, setNetworkFilters] = useState(() =>
    view === 'networks' && initialQuery
      ? { ...DEFAULT_NETWORK_FILTERS, q: initialQuery }
      : DEFAULT_NETWORK_FILTERS,
  );
  const [networkPage, setNetworkPage] = useState(1);
  const [pageSize, setPageSize] = useState(DOCKER_BROWSER_DEFAULT_PAGE_SIZE);
  const browserCardRef = useRef(null);
  const { error, loadOverview, loading, overview, pollingState, refreshingAt } =
    useDockerOverview();
  const projects = Array.isArray(overview?.projects) ? overview.projects : [];
  const containers = Array.isArray(overview?.containers) ? overview.containers : [];
  const images = Array.isArray(overview?.images) ? overview.images : [];
  const volumes = Array.isArray(overview?.volumes) ? overview.volumes : [];
  const networks = Array.isArray(overview?.networks) ? overview.networks : [];

  const projectStateOptions = useMemo(
    () => uniqueSorted(projects.map((project) => project.state)),
    [projects],
  );
  const projectStatusOptions = useMemo(
    () => uniqueSorted(projects.map((project) => project.status)),
    [projects],
  );

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
  const storageDriverOptions = useMemo(
    () => uniqueSorted(volumes.map((volume) => volume.driver)),
    [volumes],
  );
  const storageScopeOptions = useMemo(
    () => uniqueSorted(volumes.map((volume) => volume.scope)),
    [volumes],
  );
  const networkDriverOptions = useMemo(
    () => uniqueSorted(networks.map((network) => network.driver)),
    [networks],
  );

  const filteredProjects = useMemo(() => {
    const query = projectFilters.q.trim().toLowerCase();
    return projects.filter((project) => {
      if (projectFilters.state && project.state !== projectFilters.state) return false;
      if (projectFilters.status && project.status !== projectFilters.status) return false;
      if (!query) return true;
      return [project.name, project.state, project.status, project.configFiles]
        .some((value) => String(value || '').toLowerCase().includes(query));
    });
  }, [projectFilters, projects]);

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


  const filteredVolumes = useMemo(() => {
    const query = storageFilters.q.trim().toLowerCase();
    return volumes.filter((volume) => {
      if (storageFilters.driver && volume.driver !== storageFilters.driver) return false;
      if (storageFilters.scope && volume.scope !== storageFilters.scope) return false;
      if (!query) return true;
      return [volume.name, volume.driver, volume.scope, volume.project]
        .some((value) => String(value || '').toLowerCase().includes(query));
    });
  }, [storageFilters, volumes]);

  const filteredNetworks = useMemo(() => {
    const query = networkFilters.q.trim().toLowerCase();
    return networks.filter((network) => {
      const cleanup = network.cleanup || {};
      const usageCount = Number(cleanup.usageCount ?? 0);
      const cleanupState = cleanup.mode === 'SYSTEM_PROTECTED'
        ? 'SYSTEM_PROTECTED'
        : cleanup.eligible
          ? 'UNUSED'
          : usageCount > 0
            ? 'ATTACHED'
            : 'PROTECTED';
      if (networkFilters.driver && network.driver !== networkFilters.driver) return false;
      if (networkFilters.cleanup && cleanupState !== networkFilters.cleanup) return false;
      if (!query) return true;
      return [network.name, network.id, network.driver, network.scope, network.project]
        .some((value) => String(value || '').toLowerCase().includes(query));
    });
  }, [networkFilters, networks]);

  const sortedProjects = useMemo(
    () => (view === 'projects' ? sortInventoryItems(filteredProjects, sorts, 'projects') : filteredProjects),
    [filteredProjects, sorts, view],
  );
  const sortedContainers = useMemo(
    () => (view === 'containers' ? sortInventoryItems(filteredContainers, sorts, 'containers') : filteredContainers),
    [filteredContainers, sorts, view],
  );
  const sortedImages = useMemo(
    () => (view === 'images' ? sortInventoryItems(filteredImages, sorts, 'images') : filteredImages),
    [filteredImages, sorts, view],
  );
  const sortedVolumes = useMemo(
    () => (view === 'storage' ? sortInventoryItems(filteredVolumes, sorts, 'storage') : filteredVolumes),
    [filteredVolumes, sorts, view],
  );
  const sortedNetworks = useMemo(
    () => (view === 'networks' ? sortInventoryItems(filteredNetworks, sorts, 'networks') : filteredNetworks),
    [filteredNetworks, sorts, view],
  );

  const activeFilteredCount = view === 'projects'
    ? filteredProjects.length
    : view === 'containers'
      ? filteredContainers.length
      : view === 'images'
        ? filteredImages.length
        : view === 'storage'
          ? filteredVolumes.length
          : filteredNetworks.length;
  const availablePageSizes = useMemo(
    () => getAvailableTablePageSizes(activeFilteredCount),
    [activeFilteredCount],
  );

  const projectPageCount = Math.max(1, Math.ceil(filteredProjects.length / pageSize));
  const currentProjectPage = Math.min(projectPage, projectPageCount);
  const pagedProjects = useMemo(() => {
    const offset = (currentProjectPage - 1) * pageSize;
    return sortedProjects.slice(offset, offset + pageSize);
  }, [currentProjectPage, pageSize, sortedProjects]);
  const projectRangeStart = filteredProjects.length === 0
    ? 0
    : (currentProjectPage - 1) * pageSize + 1;
  const projectRangeEnd = filteredProjects.length === 0
    ? 0
    : projectRangeStart + pagedProjects.length - 1;

  const containerPageCount = Math.max(1, Math.ceil(filteredContainers.length / pageSize));
  const currentContainerPage = Math.min(containerPage, containerPageCount);
  const pagedContainers = useMemo(() => {
    const offset = (currentContainerPage - 1) * pageSize;
    return sortedContainers.slice(offset, offset + pageSize);
  }, [currentContainerPage, pageSize, sortedContainers]);
  const containerRangeStart = filteredContainers.length === 0
    ? 0
    : (currentContainerPage - 1) * pageSize + 1;
  const containerRangeEnd = filteredContainers.length === 0
    ? 0
    : containerRangeStart + pagedContainers.length - 1;

  const imagePageCount = Math.max(1, Math.ceil(filteredImages.length / pageSize));
  const currentImagePage = Math.min(imagePage, imagePageCount);
  const pagedImages = useMemo(() => {
    const offset = (currentImagePage - 1) * pageSize;
    return sortedImages.slice(offset, offset + pageSize);
  }, [currentImagePage, pageSize, sortedImages]);
  const imageRangeStart = filteredImages.length === 0
    ? 0
    : (currentImagePage - 1) * pageSize + 1;
  const imageRangeEnd = filteredImages.length === 0
    ? 0
    : imageRangeStart + pagedImages.length - 1;

  const storagePageCount = Math.max(1, Math.ceil(filteredVolumes.length / pageSize));
  const currentStoragePage = Math.min(storagePage, storagePageCount);
  const pagedVolumes = useMemo(() => {
    const offset = (currentStoragePage - 1) * pageSize;
    return sortedVolumes.slice(offset, offset + pageSize);
  }, [currentStoragePage, pageSize, sortedVolumes]);
  const storageRangeStart = filteredVolumes.length === 0
    ? 0
    : (currentStoragePage - 1) * pageSize + 1;
  const storageRangeEnd = filteredVolumes.length === 0
    ? 0
    : storageRangeStart + pagedVolumes.length - 1;

  const networkPageCount = Math.max(1, Math.ceil(filteredNetworks.length / pageSize));
  const currentNetworkPage = Math.min(networkPage, networkPageCount);
  const pagedNetworks = useMemo(() => {
    const offset = (currentNetworkPage - 1) * pageSize;
    return sortedNetworks.slice(offset, offset + pageSize);
  }, [currentNetworkPage, pageSize, sortedNetworks]);
  const networkRangeStart = filteredNetworks.length === 0
    ? 0
    : (currentNetworkPage - 1) * pageSize + 1;
  const networkRangeEnd = filteredNetworks.length === 0
    ? 0
    : networkRangeStart + pagedNetworks.length - 1;
  const selectedImageKey = selectedResource?.resourceType === 'IMAGE'
    ? getImageSelectionKey(selectedResource.resource)
    : '';
  const selectedVolumeName = selectedResource?.resourceType === 'VOLUME'
    ? selectedResource.resource?.name || ''
    : '';
  const selectedNetworkName = selectedResource?.resourceType === 'NETWORK'
    ? selectedResource.resource?.name || ''
    : '';

  useEffect(() => {
    const normalizedPageSize = normalizeTablePageSize(pageSize, activeFilteredCount);
    if (normalizedPageSize !== pageSize) setPageSize(normalizedPageSize);
  }, [activeFilteredCount, pageSize]);

  useEffect(() => {
    if (projectPage > projectPageCount) setProjectPage(projectPageCount);
  }, [projectPage, projectPageCount]);

  useEffect(() => {
    if (containerPage > containerPageCount) setContainerPage(containerPageCount);
  }, [containerPage, containerPageCount]);

  useEffect(() => {
    if (imagePage > imagePageCount) setImagePage(imagePageCount);
  }, [imagePage, imagePageCount]);

  useEffect(() => {
    if (storagePage > storagePageCount) setStoragePage(storagePageCount);
  }, [storagePage, storagePageCount]);

  useEffect(() => {
    if (networkPage > networkPageCount) setNetworkPage(networkPageCount);
  }, [networkPage, networkPageCount]);

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

  const selectResource = useCallback((resourceType, resource) => {
    if (!getResourceReference(resourceType, resource)) return;
    setSelectedResource({ resourceType, resource });
    setResourceDetail(null);
    setResourceDetailError('');
    setResourceControlling('');
    loadResourceDetail(resourceType, resource);
  }, [loadResourceDetail]);

  const selectImage = useCallback((image) => {
    selectResource('IMAGE', image);
  }, [selectResource]);

  const selectProject = useCallback((project) => {
    if (!project?.name) return;
    setSelectedProjectName(project.name);
    setControlError('');
    setControlNotice('');
  }, []);

  useEffect(() => {
    if (view !== 'projects' || loading) return;
    if (pagedProjects.some((project) => project.name === selectedProjectName)) return;
    const firstProject = pagedProjects[0];
    if (firstProject?.name) {
      selectProject(firstProject);
      return;
    }
    setSelectedProjectName('');
  }, [loading, pagedProjects, selectProject, selectedProjectName, view]);

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


  useEffect(() => {
    if (view !== 'storage' || loading) return;
    if (pagedVolumes.some((volume) => volume.name === selectedVolumeName)) return;
    const firstVolume = pagedVolumes[0];
    if (firstVolume) {
      selectResource('VOLUME', firstVolume);
      return;
    }
    setSelectedResource(null);
    setResourceDetail(null);
    setResourceDetailError('');
  }, [loading, pagedVolumes, selectResource, selectedVolumeName, view]);

  useEffect(() => {
    if (view !== 'networks' || loading) return;
    if (pagedNetworks.some((network) => network.name === selectedNetworkName)) return;
    const firstNetwork = pagedNetworks[0];
    if (firstNetwork) {
      selectResource('NETWORK', firstNetwork);
      return;
    }
    setSelectedResource(null);
    setResourceDetail(null);
    setResourceDetailError('');
  }, [loading, pagedNetworks, selectResource, selectedNetworkName, view]);

  function resetCurrentPage() {
    if (view === 'projects') setProjectPage(1);
    else if (view === 'containers') setContainerPage(1);
    else if (view === 'images') setImagePage(1);
    else if (view === 'storage') setStoragePage(1);
    else if (view === 'networks') setNetworkPage(1);
  }

  function changePageSize(value) {
    const nextPageSize = normalizeTablePageSize(value, activeFilteredCount);
    if (nextPageSize === pageSize) return;

    let selectedIndex = -1;
    let currentPage = 1;

    if (view === 'projects') {
      selectedIndex = sortedProjects.findIndex((project) => project.name === selectedProjectName);
      currentPage = currentProjectPage;
    } else if (view === 'containers') {
      selectedIndex = sortedContainers.findIndex((container) => container.id === selectedContainerId);
      currentPage = currentContainerPage;
    } else if (view === 'images') {
      selectedIndex = sortedImages.findIndex((image) => getImageSelectionKey(image) === selectedImageKey);
      currentPage = currentImagePage;
    } else if (view === 'storage') {
      selectedIndex = sortedVolumes.findIndex((volume) => volume.name === selectedVolumeName);
      currentPage = currentStoragePage;
    } else if (view === 'networks') {
      selectedIndex = sortedNetworks.findIndex((network) => network.name === selectedNetworkName);
      currentPage = currentNetworkPage;
    }

    const absoluteIndex = selectedIndex >= 0
      ? selectedIndex
      : Math.max(0, (currentPage - 1) * pageSize);
    const nextPage = getPageForAbsoluteIndex(absoluteIndex, nextPageSize);

    setPageSize(nextPageSize);
    if (view === 'projects') setProjectPage(nextPage);
    else if (view === 'containers') setContainerPage(nextPage);
    else if (view === 'images') setImagePage(nextPage);
    else if (view === 'storage') setStoragePage(nextPage);
    else if (view === 'networks') setNetworkPage(nextPage);

    window.requestAnimationFrame(() => {
      browserCardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }

  function applySorting(nextSorts, customized) {
    setSorts(nextSorts);
    setSortingCustomized(customized);
    resetCurrentPage();
  }

  function updateSorting(field, event) {
    const nextState = getNextSortState({
      sorts,
      defaultSorts: inventoryDefaultSorts,
      sortingCustomized,
      field,
      shiftKey: Boolean(event?.shiftKey),
    });
    applySorting(nextState.sorts, nextState.customized);
  }

  function clearSorting() {
    applySorting(inventoryDefaultSorts, false);
  }

  function updateProjectFilter(name, value) {
    setProjectFilters((current) => ({ ...current, [name]: value }));
    setProjectPage(1);
  }

  function clearProjectFilters() {
    setProjectFilters(DEFAULT_PROJECT_FILTERS);
    setProjectPage(1);
  }

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


  function updateStorageFilter(name, value) {
    setStorageFilters((current) => ({ ...current, [name]: value }));
    setStoragePage(1);
  }

  function clearStorageFilters() {
    setStorageFilters(DEFAULT_STORAGE_FILTERS);
    setStoragePage(1);
  }

  function updateNetworkFilter(name, value) {
    setNetworkFilters((current) => ({ ...current, [name]: value }));
    setNetworkPage(1);
  }

  function clearNetworkFilters() {
    setNetworkFilters(DEFAULT_NETWORK_FILTERS);
    setNetworkPage(1);
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

      {error && <DismissibleAlert tone="danger">{error}</DismissibleAlert>}
      {controlError && <DismissibleAlert tone="danger">{controlError}</DismissibleAlert>}
      {controlNotice && <DismissibleAlert tone="success">{controlNotice}</DismissibleAlert>}
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
        <>
          <section ref={browserCardRef} className="sky-card mb-4 sky-workflow-history-browser sky-docker-record-browser sky-table-browser-anchor">
            <div className="sky-card-header">
              <div>
                <div className="sky-page-kicker">Project browser</div>
                <h2 className="h5 mb-0">Project inventory</h2>
                <p className="sky-muted small mb-0">
                  Search and filter Docker Compose workloads, then inspect and operate the selected
                  project in the detail workspace below.
                </p>
              </div>
              <div className="sky-history-browser-filter-grid">
                <div className="sky-run-tools-search-filter">
                  <label className="form-label" htmlFor="dockerProjectSearch">Search</label>
                  <input
                    className="form-control sky-form-control"
                    id="dockerProjectSearch"
                    onChange={(event) => updateProjectFilter('q', event.target.value)}
                    placeholder="Project, state, status, Compose file..."
                    type="search"
                    value={projectFilters.q}
                  />
                </div>
                <div>
                  <label className="form-label" htmlFor="dockerProjectStateFilter">State</label>
                  <select
                    className="form-select sky-form-control"
                    id="dockerProjectStateFilter"
                    onChange={(event) => updateProjectFilter('state', event.target.value)}
                    value={projectFilters.state}
                  >
                    <option value="">All states</option>
                    {projectStateOptions.map((state) => (
                      <option key={state} value={state}>{state}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="form-label" htmlFor="dockerProjectStatusFilter">Status</label>
                  <select
                    className="form-select sky-form-control"
                    id="dockerProjectStatusFilter"
                    onChange={(event) => updateProjectFilter('status', event.target.value)}
                    value={projectFilters.status}
                  >
                    <option value="">All statuses</option>
                    {projectStatusOptions.map((status) => (
                      <option key={status} value={status}>{status}</option>
                    ))}
                  </select>
                </div>
                <div className="sky-run-tools-filter-actions">
                  {sortingCustomized && (
                    <button className="btn btn-sm sky-btn-ghost" onClick={clearSorting} type="button">
                      Clear sorting
                    </button>
                  )}
                  <button
                    className="btn btn-sm sky-btn-ghost"
                    onClick={clearProjectFilters}
                    type="button"
                  >
                    Clear filters
                  </button>
                </div>
              </div>
            </div>
            <ProjectTable
              loading={loading}
              onSelect={selectProject}
              onSort={updateSorting}
              projects={pagedProjects}
              selectedProjectName={selectedProjectName}
              sorts={sorts}
            />
            <DockerBrowserPagination
              ariaLabel="Docker project pagination"
              availablePageSizes={availablePageSizes}
              filteredCount={filteredProjects.length}
              onPageChange={setProjectPage}
              onPageSizeChange={changePageSize}
              page={currentProjectPage}
              pageCount={projectPageCount}
              pageSize={pageSize}
              rangeEnd={projectRangeEnd}
              rangeStart={projectRangeStart}
              rowsSelectId="dockerProjectRowsSelect"
              selectId="dockerProjectPageSelect"
            />
          </section>

          {selectedProjectName && (
            <DockerProjectDetailsModal
              canControl={canControl}
              containers={containers}
              controlError={controlError}
              controlNotice={controlNotice}
              controlling={controlling}
              embedded
              onControl={handleProjectControl}
              onRefresh={() => loadOverview()}
              project={
                projects.find((project) => project.name === selectedProjectName) ||
                { name: selectedProjectName }
              }
            />
          )}
        </>
      )}

      {view === 'containers' && (
        <>
          <section ref={browserCardRef} className="sky-card mb-4 sky-workflow-history-browser sky-docker-record-browser sky-table-browser-anchor">
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
                  {sortingCustomized && (
                    <button className="btn btn-sm sky-btn-ghost" onClick={clearSorting} type="button">
                      Clear sorting
                    </button>
                  )}
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
              onSort={updateSorting}
              selectedContainerId={selectedContainerId}
              sorts={sorts}
            />
            <DockerBrowserPagination
              ariaLabel="Docker container pagination"
              availablePageSizes={availablePageSizes}
              filteredCount={filteredContainers.length}
              onPageChange={setContainerPage}
              onPageSizeChange={changePageSize}
              page={currentContainerPage}
              pageCount={containerPageCount}
              pageSize={pageSize}
              rangeEnd={containerRangeEnd}
              rangeStart={containerRangeStart}
              rowsSelectId="dockerContainerRowsSelect"
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
          <section ref={browserCardRef} className="sky-card mb-4 sky-workflow-history-browser sky-docker-record-browser sky-table-browser-anchor">
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
                  {sortingCustomized && (
                    <button className="btn btn-sm sky-btn-ghost" onClick={clearSorting} type="button">
                      Clear sorting
                    </button>
                  )}
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
              onSort={updateSorting}
              selectedImageKey={selectedImageKey}
              sorts={sorts}
            />
            <DockerBrowserPagination
              ariaLabel="Docker image pagination"
              availablePageSizes={availablePageSizes}
              filteredCount={filteredImages.length}
              onPageChange={setImagePage}
              onPageSizeChange={changePageSize}
              page={currentImagePage}
              pageCount={imagePageCount}
              pageSize={pageSize}
              rangeEnd={imageRangeEnd}
              rangeStart={imageRangeStart}
              rowsSelectId="dockerImageRowsSelect"
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
        <>
          <section ref={browserCardRef} className="sky-card mb-4 sky-workflow-history-browser sky-docker-record-browser sky-table-browser-anchor">
            <div className="sky-card-header">
              <div>
                <div className="sky-page-kicker">Storage browser</div>
                <h2 className="h5 mb-0">Volume inventory</h2>
                <p className="sky-muted small mb-0">
                  Search and filter persistent Docker volumes, then inspect the selected storage resource in the detail workspace below.
                </p>
              </div>
              <div className="sky-history-browser-filter-grid">
                <div className="sky-run-tools-search-filter">
                  <label className="form-label" htmlFor="dockerStorageSearch">Search</label>
                  <input
                    className="form-control sky-form-control"
                    id="dockerStorageSearch"
                    onChange={(event) => updateStorageFilter('q', event.target.value)}
                    placeholder="Volume, driver, scope, project..."
                    type="search"
                    value={storageFilters.q}
                  />
                </div>
                <div>
                  <label className="form-label" htmlFor="dockerStorageDriverFilter">Driver</label>
                  <select
                    className="form-select sky-form-control"
                    id="dockerStorageDriverFilter"
                    onChange={(event) => updateStorageFilter('driver', event.target.value)}
                    value={storageFilters.driver}
                  >
                    <option value="">All drivers</option>
                    {storageDriverOptions.map((driver) => <option key={driver} value={driver}>{driver}</option>)}
                  </select>
                </div>
                <div>
                  <label className="form-label" htmlFor="dockerStorageScopeFilter">Scope</label>
                  <select
                    className="form-select sky-form-control"
                    id="dockerStorageScopeFilter"
                    onChange={(event) => updateStorageFilter('scope', event.target.value)}
                    value={storageFilters.scope}
                  >
                    <option value="">All scopes</option>
                    {storageScopeOptions.map((scope) => <option key={scope} value={scope}>{scope}</option>)}
                  </select>
                </div>
                <div className="sky-run-tools-filter-actions">
                  {sortingCustomized && (
                    <button className="btn btn-sm sky-btn-ghost" onClick={clearSorting} type="button">
                      Clear sorting
                    </button>
                  )}
                  <button className="btn btn-sm sky-btn-ghost" onClick={clearStorageFilters} type="button">
                    Clear filters
                  </button>
                </div>
              </div>
            </div>
            <StorageTable
              loading={loading}
              onSelect={(volume) => selectResource('VOLUME', volume)}
              onSort={updateSorting}
              selectedVolumeName={selectedVolumeName}
              sorts={sorts}
              volumes={pagedVolumes}
            />
            <DockerBrowserPagination
              ariaLabel="Docker storage pagination"
              availablePageSizes={availablePageSizes}
              filteredCount={filteredVolumes.length}
              onPageChange={setStoragePage}
              onPageSizeChange={changePageSize}
              page={currentStoragePage}
              pageCount={storagePageCount}
              pageSize={pageSize}
              rangeEnd={storageRangeEnd}
              rangeStart={storageRangeStart}
              rowsSelectId="dockerStorageRowsSelect"
              selectId="dockerStoragePageSelect"
            />
          </section>

          {selectedResource?.resourceType === 'VOLUME' && (
            <DockerResourceDetailsModal
              canCleanup={canCleanup}
              controlling={resourceControlling}
              detail={resourceDetail}
              embedded
              error={resourceDetailError}
              loading={resourceDetailLoading}
              onControl={handleResourceControl}
              onRefresh={() => loadResourceDetail('VOLUME', selectedResource.resource)}
              resourceTypeHint="VOLUME"
            />
          )}
        </>
      )}

      {view === 'networks' && (
        <>
          <section ref={browserCardRef} className="sky-card mb-4 sky-workflow-history-browser sky-docker-record-browser sky-table-browser-anchor">
            <div className="sky-card-header">
              <div>
                <div className="sky-page-kicker">Network browser</div>
                <h2 className="h5 mb-0">Network inventory</h2>
                <p className="sky-muted small mb-0">
                  Search and filter Docker networks, then inspect topology and cleanup policy in the selected-network workspace below.
                </p>
              </div>
              <div className="sky-history-browser-filter-grid">
                <div className="sky-run-tools-search-filter">
                  <label className="form-label" htmlFor="dockerNetworkSearch">Search</label>
                  <input
                    className="form-control sky-form-control"
                    id="dockerNetworkSearch"
                    onChange={(event) => updateNetworkFilter('q', event.target.value)}
                    placeholder="Network, driver, scope, project..."
                    type="search"
                    value={networkFilters.q}
                  />
                </div>
                <div>
                  <label className="form-label" htmlFor="dockerNetworkDriverFilter">Driver</label>
                  <select
                    className="form-select sky-form-control"
                    id="dockerNetworkDriverFilter"
                    onChange={(event) => updateNetworkFilter('driver', event.target.value)}
                    value={networkFilters.driver}
                  >
                    <option value="">All drivers</option>
                    {networkDriverOptions.map((driver) => <option key={driver} value={driver}>{driver}</option>)}
                  </select>
                </div>
                <div>
                  <label className="form-label" htmlFor="dockerNetworkCleanupFilter">Cleanup</label>
                  <select
                    className="form-select sky-form-control"
                    id="dockerNetworkCleanupFilter"
                    onChange={(event) => updateNetworkFilter('cleanup', event.target.value)}
                    value={networkFilters.cleanup}
                  >
                    <option value="">All cleanup states</option>
                    <option value="SYSTEM_PROTECTED">System protected</option>
                    <option value="ATTACHED">Attached</option>
                    <option value="UNUSED">Unused</option>
                  </select>
                </div>
                <div className="sky-run-tools-filter-actions">
                  {sortingCustomized && (
                    <button className="btn btn-sm sky-btn-ghost" onClick={clearSorting} type="button">
                      Clear sorting
                    </button>
                  )}
                  <button className="btn btn-sm sky-btn-ghost" onClick={clearNetworkFilters} type="button">
                    Clear filters
                  </button>
                </div>
              </div>
            </div>
            <NetworkTable
              loading={loading}
              networks={pagedNetworks}
              onSelect={(network) => selectResource('NETWORK', network)}
              onSort={updateSorting}
              selectedNetworkName={selectedNetworkName}
              sorts={sorts}
            />
            <DockerBrowserPagination
              ariaLabel="Docker network pagination"
              availablePageSizes={availablePageSizes}
              filteredCount={filteredNetworks.length}
              onPageChange={setNetworkPage}
              onPageSizeChange={changePageSize}
              page={currentNetworkPage}
              pageCount={networkPageCount}
              pageSize={pageSize}
              rangeEnd={networkRangeEnd}
              rangeStart={networkRangeStart}
              rowsSelectId="dockerNetworkRowsSelect"
              selectId="dockerNetworkPageSelect"
            />
          </section>

          {selectedResource?.resourceType === 'NETWORK' && (
            <DockerResourceDetailsModal
              canCleanup={canCleanup}
              controlling={resourceControlling}
              detail={resourceDetail}
              embedded
              error={resourceDetailError}
              loading={resourceDetailLoading}
              onControl={handleResourceControl}
              onRefresh={() => loadResourceDetail('NETWORK', selectedResource.resource)}
              resourceTypeHint="NETWORK"
            />
          )}
        </>
      )}
    </>
  );
}

export default DockerInventory;
