import { useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '../context/AuthContext.jsx';
import adminService from '../services/adminService';

import DismissibleAlert from '../components/ui/DismissibleAlert.jsx';
import { getNextSortState, sortItemsBySorts } from '../utils/tableSorting.js';
import {
  getAvailableTablePageSizes,
  getPageForAbsoluteIndex,
  normalizeTablePageSize,
} from '../utils/tablePageSize.js';

const PRIVILEGE_PAGE_SIZE = 10;
const PRIVILEGE_FETCH_LIMIT = 200;
const PRIVILEGE_DEFAULT_SORTS = [{ field: 'privilege', direction: 'asc' }];

const DEFAULT_FILTERS = {
  q: '',
  appCode: 'ALL',
  resource: '',
  action: '',
  active: '',
};

const DEFAULT_CREATE_FORM = {
  appCode: 'SKYSERVER_ADMIN',
  permissionCode: '',
  resource: '',
  action: '',
  description: '',
  active: true,
};

function formatDate(value) {
  if (!value) {
    return '—';
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

function activePill(active) {
  return active ? 'sky-pill-success' : 'sky-pill-danger';
}

function normalizePermissionCode(value) {
  return String(value || '')
    .toUpperCase()
    .replace(/[^A-Z0-9_]/g, '_');
}

function normalizeResourceAction(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '_');
}

function formatApplicationLabel(application) {
  if (!application) {
    return 'Unknown app';
  }

  return application.title || application.appCode || 'Unknown app';
}

function getCreateAppCode(filters) {
  return filters.appCode && filters.appCode !== 'ALL' ? filters.appCode : 'SKYSERVER_ADMIN';
}

function getPrivilegeSortValue(permission, field) {
  if (field === 'privilege') {
    return `${permission?.permissionCode || ''} ${permission?.description || ''}`.trim();
  }

  if (field === 'application') {
    return `${permission?.appTitle || ''} ${permission?.appCode || ''}`.trim();
  }

  if (field === 'resource') return permission?.resource || '';
  if (field === 'action') return permission?.action || '';
  if (field === 'status') return permission?.active ? 1 : 0;

  return permission?.[field] ?? '';
}

function AdminPrivileges() {
  const { hasPermission } = useAuth();
  const canWritePermissions = hasPermission('ADMIN_PERMISSION_WRITE');

  const [applications, setApplications] = useState([]);
  const [permissions, setPermissions] = useState([]);
  const [selectedPermissionId, setSelectedPermissionId] = useState('');
  const [selectedPermission, setSelectedPermission] = useState(null);
  const [selectedRoles, setSelectedRoles] = useState([]);
  const [filters, setFilters] = useState(DEFAULT_FILTERS);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(PRIVILEGE_PAGE_SIZE);
  const [sorts, setSorts] = useState(() => PRIVILEGE_DEFAULT_SORTS);
  const [sortingCustomized, setSortingCustomized] = useState(false);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState(DEFAULT_CREATE_FORM);
  const initialLoadCompleteRef = useRef(false);
  const browserCardRef = useRef(null);
  const [editForm, setEditForm] = useState({
    permissionCode: '',
    resource: '',
    action: '',
    description: '',
    active: true,
  });

  const resources = useMemo(
    () => [...new Set(permissions.map((permission) => permission.resource).filter(Boolean))].sort(),
    [permissions],
  );

  const actions = useMemo(
    () => [...new Set(permissions.map((permission) => permission.action).filter(Boolean))].sort(),
    [permissions],
  );

  const sortedPermissions = useMemo(
    () => sortItemsBySorts(permissions, sorts, getPrivilegeSortValue),
    [permissions, sorts],
  );
  const availablePageSizes = useMemo(
    () => getAvailableTablePageSizes(sortedPermissions.length),
    [sortedPermissions.length],
  );
  const pageCount = Math.max(1, Math.ceil(sortedPermissions.length / pageSize));
  const safeCurrentPage = Math.min(currentPage, pageCount);
  const visiblePermissions = useMemo(
    () => sortedPermissions.slice(
      (safeCurrentPage - 1) * pageSize,
      safeCurrentPage * pageSize,
    ),
    [pageSize, safeCurrentPage, sortedPermissions],
  );
  const rangeStart = visiblePermissions.length === 0 ? 0 : (safeCurrentPage - 1) * pageSize + 1;
  const rangeEnd = rangeStart === 0 ? 0 : rangeStart + visiblePermissions.length - 1;

  useEffect(() => {
    const normalizedPageSize = normalizeTablePageSize(pageSize, sortedPermissions.length);
    if (normalizedPageSize === pageSize) return;

    const selectedIndex = selectedPermissionId
      ? sortedPermissions.findIndex((permission) => permission.permissionId === selectedPermissionId)
      : -1;
    setPageSize(normalizedPageSize);
    setCurrentPage(selectedIndex >= 0 ? getPageForAbsoluteIndex(selectedIndex, normalizedPageSize) : 1);
  }, [pageSize, selectedPermissionId, sortedPermissions]);

  async function fetchAllPermissions(nextFilters = filters) {
    const items = [];
    let offset = 0;
    let totalCount = 0;

    while (true) {
      const result = await adminService.listPermissions({
        ...nextFilters,
        limit: PRIVILEGE_FETCH_LIMIT,
        offset,
      });
      const batch = result.items || [];
      totalCount = Number(result.total || 0);
      items.push(...batch);

      if (batch.length === 0 || items.length >= totalCount || batch.length < PRIVILEGE_FETCH_LIMIT) {
        break;
      }

      offset += batch.length;
    }

    return { items, total: totalCount };
  }

  async function loadPermissions(
    nextFilters = filters,
    preferredPermissionId = selectedPermissionId,
  ) {
    setLoading(true);
    setError('');

    try {
      const result = await fetchAllPermissions(nextFilters);
      const nextPermissions = result.items || [];
      const sortedNextPermissions = sortItemsBySorts(nextPermissions, sorts, getPrivilegeSortValue);
      setPermissions(nextPermissions);

      if (nextPermissions.length === 0) {
        setCurrentPage(1);
        setSelectedPermissionId('');
        setSelectedPermission(null);
        setSelectedRoles([]);
        return;
      }

      const preferredExists = nextPermissions.some(
        (permission) => permission.permissionId === preferredPermissionId,
      );
      const resolvedPermissionId = preferredExists
        ? preferredPermissionId
        : sortedNextPermissions[0]?.permissionId || '';
      const selectedIndex = sortedNextPermissions.findIndex(
        (permission) => permission.permissionId === resolvedPermissionId,
      );
      setCurrentPage(selectedIndex >= 0 ? getPageForAbsoluteIndex(selectedIndex, pageSize) : 1);
      setSelectedPermissionId(resolvedPermissionId);
    } catch (loadError) {
      setError(loadError.message || 'Failed to load privileges.');
    } finally {
      setLoading(false);
    }
  }

  async function loadSelectedPermission(permissionId) {
    if (!permissionId) {
      setSelectedPermission(null);
      setSelectedRoles([]);
      return;
    }

    setDetailLoading(true);
    setError('');

    try {
      const result = await adminService.getPermission(permissionId);
      setSelectedPermission(result.permission || null);
      setSelectedRoles(result.roles || []);
      setEditForm({
        permissionCode: result.permission?.permissionCode || '',
        resource: result.permission?.resource || '',
        action: result.permission?.action || '',
        description: result.permission?.description || '',
        active: result.permission?.active !== false,
      });
    } catch (loadError) {
      setError(loadError.message || 'Failed to load privilege detail.');
    } finally {
      setDetailLoading(false);
    }
  }

  useEffect(() => {
    let active = true;

    async function loadInitialData() {
      setLoading(true);
      setError('');

      try {
        const [applicationsResult, permissionsResult] = await Promise.all([
          adminService.listApplications({ active: true, limit: 200 }),
          fetchAllPermissions(DEFAULT_FILTERS),
        ]);

        if (!active) {
          return;
        }

        setApplications(applicationsResult.items || []);
        const nextPermissions = permissionsResult.items || [];
        const sortedNextPermissions = sortItemsBySorts(
          nextPermissions,
          PRIVILEGE_DEFAULT_SORTS,
          getPrivilegeSortValue,
        );
        setPermissions(nextPermissions);
        setSelectedPermissionId(sortedNextPermissions[0]?.permissionId || '');
      } catch (loadError) {
        if (active) {
          setError(loadError.message || 'Failed to load privileges.');
        }
      } finally {
        if (active) {
          initialLoadCompleteRef.current = true;
          setLoading(false);
        }
      }
    }

    loadInitialData();

    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    loadSelectedPermission(selectedPermissionId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPermissionId]);

  useEffect(() => {
    if (!initialLoadCompleteRef.current) {
      return undefined;
    }

    const timeoutId = window.setTimeout(() => {
      loadPermissions(filters, '');
    }, 250);

    return () => window.clearTimeout(timeoutId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters]);

  function updateFilter(name, value) {
    setFilters((currentFilters) => ({
      ...currentFilters,
      [name]: value,
    }));
  }

  function updateCreateField(name, value) {
    setCreateForm((currentForm) => ({
      ...currentForm,
      [name]: value,
    }));
  }

  function updateEditField(name, value) {
    setEditForm((currentForm) => ({
      ...currentForm,
      [name]: value,
    }));
  }

  function clearFilters() {
    setFilters(DEFAULT_FILTERS);
    setCurrentPage(1);
  }

  function applySorting(nextSorts, customized) {
    const sortedItems = sortItemsBySorts(permissions, nextSorts, getPrivilegeSortValue);
    const selectedIndex = selectedPermissionId
      ? sortedItems.findIndex((permission) => permission.permissionId === selectedPermissionId)
      : -1;

    setSorts(nextSorts);
    setSortingCustomized(customized);
    setCurrentPage(selectedIndex >= 0 ? getPageForAbsoluteIndex(selectedIndex, pageSize) : 1);
  }

  function updateSorting(field, event) {
    const nextState = getNextSortState({
      sorts,
      defaultSorts: PRIVILEGE_DEFAULT_SORTS,
      sortingCustomized,
      field,
      shiftKey: Boolean(event?.shiftKey),
    });
    applySorting(nextState.sorts, nextState.customized);
  }

  function clearSorting() {
    applySorting(PRIVILEGE_DEFAULT_SORTS, false);
  }

  function renderSortableHeader(label, field) {
    const activeIndex = sorts.findIndex((sort) => sort.field === field);
    const activeSort = activeIndex >= 0 ? sorts[activeIndex] : null;
    const directionIcon = activeSort?.direction === 'asc' ? '↑' : '↓';
    const sortDescription = activeSort
      ? `${activeSort.direction === 'asc' ? 'ascending' : 'descending'}, priority ${activeIndex + 1}`
      : 'not currently sorted';

    return (
      <th>
        <button
          aria-label={`${label}: ${sortDescription}. Click to sort; Shift+click to add to multi-column sorting.`}
          className={`sky-table-sort-button ${activeSort ? 'is-active' : ''}`}
          onClick={(event) => updateSorting(field, event)}
          title="Click to sort · Shift+click to add sort"
          type="button"
        >
          <span>{label}</span>
          <span className="sky-table-sort-indicator" aria-hidden="true">
            {activeSort ? directionIcon : '↕'}
          </span>
          {activeSort && (
            <span className="sky-table-sort-priority" aria-hidden="true">{activeIndex + 1}</span>
          )}
        </button>
      </th>
    );
  }

  function goToPage(page) {
    const nextPage = Math.min(Math.max(1, Number(page) || 1), pageCount);
    const firstPermission = sortedPermissions[(nextPage - 1) * pageSize] || null;
    setCurrentPage(nextPage);
    if (firstPermission) {
      setSelectedPermissionId(firstPermission.permissionId);
    }
  }

  function changePageSize(value) {
    const nextPageSize = Number(value);
    if (!availablePageSizes.includes(nextPageSize) || nextPageSize === pageSize) return;

    const selectedIndex = selectedPermissionId
      ? sortedPermissions.findIndex((permission) => permission.permissionId === selectedPermissionId)
      : -1;
    setPageSize(nextPageSize);
    setCurrentPage(selectedIndex >= 0 ? getPageForAbsoluteIndex(selectedIndex, nextPageSize) : 1);
    window.requestAnimationFrame(() => {
      browserCardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }

  function renderPagination() {
    return (
      <div className="sky-pagination-row sky-canonical-operations-pagination-row">
        <div className="small sky-muted sky-canonical-operations-pagination-summary">
          Showing {rangeStart}–{rangeEnd} of {sortedPermissions.length} privilege(s)
        </div>
        <div className="sky-pagination-controls sky-canonical-operations-pagination-controls" aria-label="Privileges pagination">
          <button aria-label="First page" className="btn btn-sm sky-pagination-nav-button" disabled={safeCurrentPage <= 1 || loading} onClick={() => goToPage(1)} title="First page" type="button">«</button>
          <button aria-label="Previous page" className="btn btn-sm sky-pagination-nav-button" disabled={safeCurrentPage <= 1 || loading} onClick={() => goToPage(safeCurrentPage - 1)} title="Previous page" type="button">‹</button>
          <label className="sky-pagination-select-label" htmlFor="privilegesPageSelect">Page</label>
          <select className="form-select form-select-sm sky-form-control sky-pagination-select" disabled={loading} id="privilegesPageSelect" onChange={(event) => goToPage(event.target.value)} value={safeCurrentPage}>
            {Array.from({ length: pageCount }, (_, index) => index + 1).map((page) => <option key={page} value={page}>{page}</option>)}
          </select>
          <span className="small sky-muted">of {pageCount}</span>
          <button aria-label="Next page" className="btn btn-sm sky-pagination-nav-button" disabled={safeCurrentPage >= pageCount || loading} onClick={() => goToPage(safeCurrentPage + 1)} title="Next page" type="button">›</button>
          <button aria-label="Last page" className="btn btn-sm sky-pagination-nav-button" disabled={safeCurrentPage >= pageCount || loading} onClick={() => goToPage(pageCount)} title="Last page" type="button">»</button>
        </div>
        <div className="sky-canonical-rows-control">
          <label className="sky-pagination-select-label" htmlFor="privilegesRowsSelect">Rows</label>
          <select
            className="form-select form-select-sm sky-form-control sky-pagination-select sky-canonical-rows-select"
            disabled={loading}
            id="privilegesRowsSelect"
            onChange={(event) => changePageSize(event.target.value)}
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

  function toggleCreatePanel() {
    setCreateForm((currentForm) => ({
      ...currentForm,
      appCode: getCreateAppCode(filters),
    }));
    setCreateOpen((currentValue) => !currentValue);
  }

  async function handleCreatePermission(event) {
    event.preventDefault();
    setSaving(true);
    setError('');
    setSuccess('');

    try {
      const result = await adminService.createPermission({
        appCode: createForm.appCode,
        permissionCode: createForm.permissionCode,
        resource: createForm.resource,
        action: createForm.action,
        description: createForm.description || null,
        active: createForm.active,
      });

      setCreateForm({ ...DEFAULT_CREATE_FORM, appCode: getCreateAppCode(filters) });
      setCreateOpen(false);
      setSuccess(
        `Created privilege ${result.permission?.permissionCode || createForm.permissionCode}.`,
      );
      await loadPermissions(filters, result.permission?.permissionId);
      if (result.permission?.permissionId) {
        setSelectedPermissionId(result.permission.permissionId);
      }
    } catch (saveError) {
      setError(saveError.message || 'Failed to create privilege.');
    } finally {
      setSaving(false);
    }
  }

  async function handleSavePermission(event) {
    event.preventDefault();

    if (!selectedPermission) {
      return;
    }

    setSaving(true);
    setError('');
    setSuccess('');

    try {
      await adminService.updatePermission(selectedPermission.permissionId, {
        permissionCode: editForm.permissionCode,
        resource: editForm.resource,
        action: editForm.action,
        description: editForm.description || null,
      });
      setSuccess('Privilege updated.');
      await loadPermissions(filters, selectedPermission.permissionId);
      await loadSelectedPermission(selectedPermission.permissionId);
    } catch (saveError) {
      setError(saveError.message || 'Failed to update privilege.');
    } finally {
      setSaving(false);
    }
  }

  async function handleSavePermissionStatus() {
    if (!selectedPermission) {
      return;
    }

    setSaving(true);
    setError('');
    setSuccess('');

    try {
      await adminService.updatePermissionStatus(selectedPermission.permissionId, {
        active: editForm.active,
      });
      setSuccess(`Privilege ${editForm.active ? 'activated' : 'deactivated'}.`);
      await loadPermissions(filters, selectedPermission.permissionId);
      await loadSelectedPermission(selectedPermission.permissionId);
    } catch (saveError) {
      setError(saveError.message || 'Failed to update privilege status.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <header className="sky-page-header">
        <div>
          <div className="sky-page-kicker">Access control</div>
          <h1 className="sky-page-title">Privileges</h1>
          <p className="sky-page-subtitle">
            Inspect and maintain app-scoped atomic permissions used by roles, protected routes, and
            the API authorization layer.
          </p>
        </div>
        <div className="d-flex flex-wrap gap-2">
          {canWritePermissions && (
            <button className="btn sky-btn-primary" onClick={toggleCreatePanel} type="button">
              {createOpen ? 'Close creator' : 'Create privilege'}
            </button>
          )}
          <button
            className="btn sky-btn-ghost"
            disabled={loading}
            onClick={() => loadPermissions(filters)}
            type="button"
          >
            {loading ? 'Refreshing...' : 'Refresh'}
          </button>
        </div>
      </header>

      {error && <DismissibleAlert tone="danger">{error}</DismissibleAlert>}
      {success && <DismissibleAlert tone="success">{success}</DismissibleAlert>}

      {createOpen && canWritePermissions && (
        <section className="sky-card mb-3">
          <div className="sky-card-header">
            <h2 className="h5 mb-0">Create privilege</h2>
          </div>
          <div className="sky-card-body">
            <form onSubmit={handleCreatePermission}>
              <div className="row g-3">
                <div className="col-md-3">
                  <label className="form-label" htmlFor="createPermissionApp">
                    Application
                  </label>
                  <select
                    className="form-select sky-form-control"
                    id="createPermissionApp"
                    onChange={(event) => updateCreateField('appCode', event.target.value)}
                    required
                    value={createForm.appCode}
                  >
                    {applications.map((application) => (
                      <option key={application.appCode} value={application.appCode}>
                        {formatApplicationLabel(application)}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="col-md-3">
                  <label className="form-label" htmlFor="createPermissionCode">
                    Permission code
                  </label>
                  <input
                    className="form-control sky-form-control sky-mono"
                    id="createPermissionCode"
                    onChange={(event) =>
                      updateCreateField(
                        'permissionCode',
                        normalizePermissionCode(event.target.value),
                      )
                    }
                    placeholder="REPORT_READ"
                    required
                    value={createForm.permissionCode}
                  />
                </div>
                <div className="col-md-2">
                  <label className="form-label" htmlFor="createResource">
                    Resource
                  </label>
                  <input
                    className="form-control sky-form-control sky-mono"
                    id="createResource"
                    onChange={(event) =>
                      updateCreateField('resource', normalizeResourceAction(event.target.value))
                    }
                    placeholder="report"
                    required
                    value={createForm.resource}
                  />
                </div>
                <div className="col-md-2">
                  <label className="form-label" htmlFor="createAction">
                    Action
                  </label>
                  <input
                    className="form-control sky-form-control sky-mono"
                    id="createAction"
                    onChange={(event) =>
                      updateCreateField('action', normalizeResourceAction(event.target.value))
                    }
                    placeholder="read"
                    required
                    value={createForm.action}
                  />
                </div>
                <div className="col-md-2">
                  <label className="form-label" htmlFor="createPermissionActive">
                    Status
                  </label>
                  <select
                    className="form-select sky-form-control"
                    id="createPermissionActive"
                    onChange={(event) => updateCreateField('active', event.target.value === 'true')}
                    value={String(createForm.active)}
                  >
                    <option value="true">ACTIVE</option>
                    <option value="false">INACTIVE</option>
                  </select>
                </div>
                <div className="col-12">
                  <label className="form-label" htmlFor="createPermissionDescription">
                    Description
                  </label>
                  <textarea
                    className="form-control sky-form-control"
                    id="createPermissionDescription"
                    onChange={(event) => updateCreateField('description', event.target.value)}
                    rows="2"
                    value={createForm.description}
                  />
                </div>
              </div>
              <button className="btn sky-btn-primary mt-3" disabled={saving} type="submit">
                {saving ? 'Creating...' : 'Create privilege'}
              </button>
            </form>
          </div>
        </section>
      )}

      <section ref={browserCardRef} className="sky-card sky-functional-history-browser sky-admin-privileges-browser sky-table-browser-anchor">
        <div className="sky-card-header">
          <div>
            <div className="sky-page-kicker">Privilege browser</div>
            <h2 className="h5 mb-0">Privilege directory</h2>
            <p className="sky-muted small mb-0">
              Search and filter app-scoped atomic permissions, then select a row to manage the complete privilege workspace below.
            </p>
          </div>
          <div className="sky-admin-privileges-filter-grid">
            <div className="sky-admin-privileges-search-filter">
              <label className="form-label" htmlFor="permissionSearch">Search</label>
              <input
                className="form-control sky-form-control"
                id="permissionSearch"
                onChange={(event) => updateFilter('q', event.target.value)}
                placeholder="Code, resource, action, description..."
                type="search"
                value={filters.q}
              />
            </div>
            <div>
              <label className="form-label" htmlFor="permissionAppFilter">Application</label>
              <select
                className="form-select sky-form-control"
                id="permissionAppFilter"
                onChange={(event) => updateFilter('appCode', event.target.value)}
                value={filters.appCode}
              >
                <option value="ALL">All applications</option>
                {applications.map((application) => (
                  <option key={application.appCode} value={application.appCode}>
                    {formatApplicationLabel(application)}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="form-label" htmlFor="permissionResourceFilter">Resource</label>
              <select
                className="form-select sky-form-control"
                id="permissionResourceFilter"
                onChange={(event) => updateFilter('resource', event.target.value)}
                value={filters.resource}
              >
                <option value="">All resources</option>
                {resources.map((resource) => (
                  <option key={resource} value={resource}>{resource}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="form-label" htmlFor="permissionActionFilter">Action</label>
              <select
                className="form-select sky-form-control"
                id="permissionActionFilter"
                onChange={(event) => updateFilter('action', event.target.value)}
                value={filters.action}
              >
                <option value="">All actions</option>
                {actions.map((action) => (
                  <option key={action} value={action}>{action}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="form-label" htmlFor="permissionActiveFilter">Status</label>
              <select
                className="form-select sky-form-control"
                id="permissionActiveFilter"
                onChange={(event) => updateFilter('active', event.target.value)}
                value={filters.active}
              >
                <option value="">All statuses</option>
                <option value="true">Active</option>
                <option value="false">Inactive</option>
              </select>
            </div>
            <div className="sky-run-tools-filter-actions">
              {sortingCustomized && (
                <button className="btn btn-sm sky-btn-ghost" onClick={clearSorting} type="button">
                  Clear sorting
                </button>
              )}
              <button className="btn btn-sm sky-btn-ghost" onClick={clearFilters} type="button">
                Clear filters
              </button>
            </div>
          </div>
        </div>

        <div className="table-responsive sky-table-card sky-functional-history-table-card sky-canonical-operations-table-frame">
          <table className="table table-sm table-hover sky-table sky-canonical-operations-table align-middle mb-0">
            <thead>
              <tr>
                {renderSortableHeader('Privilege', 'privilege')}
                {renderSortableHeader('Application', 'application')}
                {renderSortableHeader('Resource', 'resource')}
                {renderSortableHeader('Action', 'action')}
                {renderSortableHeader('Status', 'status')}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan="5">
                    <div className="sky-empty-state py-4">
                      <div className="spinner-border text-info" role="status" aria-label="Loading" />
                    </div>
                  </td>
                </tr>
              ) : visiblePermissions.length === 0 ? (
                <tr>
                  <td colSpan="5">
                    <div className="sky-empty-state py-4">No privileges match the current filters.</div>
                  </td>
                </tr>
              ) : (
                visiblePermissions.map((permission) => (
                  <tr
                    className={`sky-clickable-row ${selectedPermissionId === permission.permissionId ? 'sky-selected-row' : ''}`}
                    key={permission.permissionId}
                    onClick={() => setSelectedPermissionId(permission.permissionId)}
                  >
                    <td>
                      <div className="fw-bold sky-mono">{permission.permissionCode}</div>
                      <div className="small sky-muted sky-truncate">{permission.description || '—'}</div>
                    </td>
                    <td>
                      <span className="sky-pill sky-pill-info">{permission.appCode || 'APP'}</span>
                      <div className="small sky-muted mt-1">{permission.appTitle || '—'}</div>
                    </td>
                    <td className="sky-mono">{permission.resource}</td>
                    <td className="sky-mono">{permission.action}</td>
                    <td>
                      <span className={`sky-pill ${activePill(permission.active)}`}>
                        {permission.active ? 'ACTIVE' : 'INACTIVE'}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        {renderPagination()}
      </section>

      <section className="sky-card sky-admin-privilege-detail-card">
        <div className="sky-card-header d-flex flex-wrap align-items-start justify-content-between gap-3">
          <div>
            <div className="sky-page-kicker">Privilege detail</div>
            <h2 className="h5 mb-1">
              {selectedPermission ? selectedPermission.permissionCode : 'Selected privilege workspace'}
            </h2>
            {selectedPermission && (
              <div className="small sky-muted">
                {selectedPermission.resource}/{selectedPermission.action}
              </div>
            )}
          </div>
          {selectedPermission && (
            <div className="d-flex flex-wrap align-items-center gap-2">
              <span className={`sky-pill ${activePill(selectedPermission.active)}`}>
                {selectedPermission.active ? 'ACTIVE' : 'INACTIVE'}
              </span>
              <span className="sky-pill sky-pill-info">{selectedPermission.appCode || 'APP'}</span>
              <span className="sky-pill sky-pill-info">
                {selectedRoles.length} role{selectedRoles.length === 1 ? '' : 's'}
              </span>
              <span className="sky-pill sky-pill-info">Updated {formatDate(selectedPermission.updatedAt)}</span>
            </div>
          )}
        </div>

        <div className="sky-card-body">
          {detailLoading ? (
            <div className="sky-empty-state py-5">Loading privilege detail...</div>
          ) : selectedPermission ? (
            <div className="sky-admin-privilege-detail-stack">
              <section className="sky-admin-privilege-workspace-section">
                <div className="sky-detail-label">Privilege identity &amp; lifecycle</div>
                <div className="small sky-muted mb-3">
                  Maintain the application-scoped permission identity, authorization target, description, and lifecycle state.
                </div>

                <form onSubmit={handleSavePermission}>
                  <div className="sky-admin-privilege-identity-grid">
                    <div>
                      <label className="form-label" htmlFor="editPermissionApp">Application</label>
                      <input
                        className="form-control sky-form-control sky-mono"
                        disabled
                        id="editPermissionApp"
                        value={selectedPermission.appTitle || selectedPermission.appCode || '—'}
                      />
                    </div>
                    <div>
                      <label className="form-label" htmlFor="editPermissionCode">Permission code</label>
                      <input
                        className="form-control sky-form-control sky-mono"
                        disabled={!canWritePermissions || saving}
                        id="editPermissionCode"
                        onChange={(event) => updateEditField('permissionCode', normalizePermissionCode(event.target.value))}
                        required
                        value={editForm.permissionCode}
                      />
                    </div>
                    <div>
                      <label className="form-label" htmlFor="editResource">Resource</label>
                      <input
                        className="form-control sky-form-control sky-mono"
                        disabled={!canWritePermissions || saving}
                        id="editResource"
                        onChange={(event) => updateEditField('resource', normalizeResourceAction(event.target.value))}
                        required
                        value={editForm.resource}
                      />
                    </div>
                    <div>
                      <label className="form-label" htmlFor="editAction">Action</label>
                      <input
                        className="form-control sky-form-control sky-mono"
                        disabled={!canWritePermissions || saving}
                        id="editAction"
                        onChange={(event) => updateEditField('action', normalizeResourceAction(event.target.value))}
                        required
                        value={editForm.action}
                      />
                    </div>
                    <div className="sky-admin-privilege-description-field">
                      <label className="form-label" htmlFor="editPermissionDescription">Description</label>
                      <textarea
                        className="form-control sky-form-control"
                        disabled={!canWritePermissions || saving}
                        id="editPermissionDescription"
                        onChange={(event) => updateEditField('description', event.target.value)}
                        rows="3"
                        value={editForm.description}
                      />
                    </div>
                  </div>

                  {canWritePermissions && (
                    <button className="btn sky-btn-primary mt-3" disabled={saving} type="submit">
                      Save privilege
                    </button>
                  )}
                </form>

                <div className="sky-admin-privilege-status-row">
                  <div>
                    <label className="form-label" htmlFor="editPermissionActive">Privilege status</label>
                    <select
                      className="form-select sky-form-control"
                      disabled={!canWritePermissions || saving}
                      id="editPermissionActive"
                      onChange={(event) => updateEditField('active', event.target.value === 'true')}
                      value={String(editForm.active)}
                    >
                      <option value="true">ACTIVE</option>
                      <option value="false">INACTIVE</option>
                    </select>
                  </div>
                  {canWritePermissions && (
                    <button
                      className="btn sky-btn-ghost"
                      disabled={saving}
                      onClick={handleSavePermissionStatus}
                      type="button"
                    >
                      Save status
                    </button>
                  )}
                </div>
              </section>

              <section className="sky-admin-privilege-workspace-section">
                <div className="sky-detail-label">Role grants &amp; usage</div>
                <div className="small sky-muted mb-3">
                  Review the roles that currently inherit this atomic privilege.
                </div>

                <div className="sky-admin-privilege-grants-panel">
                  {selectedRoles.length > 0 ? (
                    <div className="table-responsive sky-admin-privilege-grants-table-wrap">
                      <table className="table table-sm sky-table align-middle mb-0">
                        <thead>
                          <tr>
                            <th>Role</th>
                            <th>Application</th>
                            <th>Status</th>
                          </tr>
                        </thead>
                        <tbody>
                          {selectedRoles.map((role) => (
                            <tr key={role.roleId}>
                              <td>
                                <div className="fw-bold sky-detail-value sky-mono">{role.roleCode}</div>
                                <div className="small sky-muted">{role.roleName}</div>
                              </td>
                              <td>
                                <span className="sky-pill sky-pill-info">
                                  {role.roleAppCode || role.appCode || 'APP'}
                                </span>
                              </td>
                              <td>
                                <span className={`sky-pill ${activePill(role.rolePermissionActive)}`}>
                                  {role.rolePermissionActive ? 'GRANTED' : 'INACTIVE'}
                                </span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <div className="sky-empty-state py-3">No roles currently grant this privilege.</div>
                  )}
                </div>
              </section>
            </div>
          ) : (
            <div className="sky-empty-state py-5">Select a privilege to inspect.</div>
          )}
        </div>
      </section>
    </>
  );
}

export default AdminPrivileges;
