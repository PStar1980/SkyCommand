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

const ROLE_PAGE_SIZE = 10;
const ROLE_FETCH_LIMIT = 200;
const ROLE_DEFAULT_SORTS = [{ field: 'role', direction: 'asc' }];

const DEFAULT_FILTERS = {
  q: '',
  appCode: 'ALL',
  active: '',
};

const DEFAULT_CREATE_FORM = {
  appCode: 'SKYSERVER_ADMIN',
  roleCode: '',
  roleName: '',
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

function getSelectedCodesFromEvent(event) {
  return Array.from(event.target.selectedOptions).map((option) => option.value);
}

function permissionCodesFromRolePermissions(rolePermissions = []) {
  return rolePermissions
    .filter(
      (permission) =>
        permission.rolePermissionActive !== false && permission.permissionActive !== false,
    )
    .map((permission) => permission.permissionCode)
    .filter(Boolean);
}

function activePill(active) {
  return active ? 'sky-pill-success' : 'sky-pill-danger';
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


function getRoleSortValue(role, field) {
  if (field === 'role') {
    const priority = { SUPER_ADMIN: 1, ADMIN: 2, OPERATOR: 3, VIEWER: 4 };
    const roleCode = String(role?.roleCode || '').toUpperCase();
    return `${String(priority[roleCode] ?? 99).padStart(2, '0')} ${roleCode} ${role?.roleName || ''}`;
  }

  if (field === 'application') {
    return `${role?.appTitle || ''} ${role?.appCode || ''}`.trim();
  }

  if (field === 'status') {
    return role?.active ? 1 : 0;
  }

  if (field === 'system') {
    return role?.isSystemRole ? 1 : 0;
  }

  if (field === 'updated') {
    const timestamp = Date.parse(role?.updatedAt || '');
    return Number.isFinite(timestamp) ? timestamp : null;
  }

  return role?.[field] ?? '';
}

function AdminRoles() {
  const { hasPermission } = useAuth();
  const canWriteRoles = hasPermission('ADMIN_ROLE_WRITE');
  const canReadPermissions = hasPermission('ADMIN_PERMISSION_READ');
  const canWritePermissions = hasPermission('ADMIN_PERMISSION_WRITE');

  const [applications, setApplications] = useState([]);
  const [roles, setRoles] = useState([]);
  const [permissions, setPermissions] = useState([]);
  const [selectedRoleId, setSelectedRoleId] = useState('');
  const [selectedRole, setSelectedRole] = useState(null);
  const [selectedUsers, setSelectedUsers] = useState([]);
  const [filters, setFilters] = useState(DEFAULT_FILTERS);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(ROLE_PAGE_SIZE);
  const [sorts, setSorts] = useState(() => ROLE_DEFAULT_SORTS);
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
    roleCode: '',
    roleName: '',
    description: '',
    active: true,
    permissionCodes: [],
  });

  const activePermissions = useMemo(() => {
    const selectedAppCode = selectedRole?.appCode || null;

    return permissions.filter(
      (permission) =>
        permission.active && (!selectedAppCode || permission.appCode === selectedAppCode),
    );
  }, [permissions, selectedRole]);

  const sortedRoles = useMemo(
    () => sortItemsBySorts(roles, sorts, getRoleSortValue),
    [roles, sorts],
  );
  const availablePageSizes = useMemo(
    () => getAvailableTablePageSizes(sortedRoles.length),
    [sortedRoles.length],
  );
  const pageCount = Math.max(1, Math.ceil(sortedRoles.length / pageSize));
  const safeCurrentPage = Math.min(currentPage, pageCount);
  const visibleRoles = useMemo(
    () => sortedRoles.slice((safeCurrentPage - 1) * pageSize, safeCurrentPage * pageSize),
    [pageSize, safeCurrentPage, sortedRoles],
  );
  const rangeStart = visibleRoles.length === 0 ? 0 : (safeCurrentPage - 1) * pageSize + 1;
  const rangeEnd = rangeStart === 0 ? 0 : rangeStart + visibleRoles.length - 1;


  useEffect(() => {
    const normalizedPageSize = normalizeTablePageSize(pageSize, sortedRoles.length);
    if (normalizedPageSize === pageSize) return;

    const selectedIndex = selectedRoleId
      ? sortedRoles.findIndex((role) => role.roleId === selectedRoleId)
      : -1;
    setPageSize(normalizedPageSize);
    setCurrentPage(selectedIndex >= 0 ? getPageForAbsoluteIndex(selectedIndex, normalizedPageSize) : 1);
  }, [pageSize, selectedRoleId, sortedRoles]);

  async function loadPermissions(nextAppCode = 'ALL') {
    if (!canReadPermissions) {
      return;
    }

    const result = await adminService.listPermissions({ appCode: nextAppCode, limit: 200 });
    setPermissions(result.items || []);
  }

  async function fetchAllRoles(nextFilters = filters) {
    const items = [];
    let offset = 0;
    let totalCount = 0;

    while (true) {
      const result = await adminService.listRoles({
        ...nextFilters,
        limit: ROLE_FETCH_LIMIT,
        offset,
      });
      const batch = result.items || [];
      totalCount = Number(result.total || 0);
      items.push(...batch);

      if (batch.length === 0 || items.length >= totalCount || batch.length < ROLE_FETCH_LIMIT) {
        break;
      }

      offset += batch.length;
    }

    return { items, total: totalCount };
  }

  async function loadRoles(nextFilters = filters, preferredRoleId = selectedRoleId) {
    setLoading(true);
    setError('');

    try {
      const result = await fetchAllRoles(nextFilters);
      const nextRoles = result.items || [];
      const sortedNextRoles = sortItemsBySorts(nextRoles, sorts, getRoleSortValue);
      setRoles(nextRoles);

      if (nextRoles.length === 0) {
        setCurrentPage(1);
        setSelectedRoleId('');
        setSelectedRole(null);
        setSelectedUsers([]);
        return;
      }

      const preferredRoleExists = nextRoles.some((role) => role.roleId === preferredRoleId);
      const resolvedRoleId = preferredRoleExists ? preferredRoleId : sortedNextRoles[0]?.roleId || '';
      const selectedIndex = sortedNextRoles.findIndex((role) => role.roleId === resolvedRoleId);
      setCurrentPage(selectedIndex >= 0 ? getPageForAbsoluteIndex(selectedIndex, pageSize) : 1);
      setSelectedRoleId(resolvedRoleId);
    } catch (loadError) {
      setError(loadError.message || 'Failed to load roles.');
    } finally {
      setLoading(false);
    }
  }

  async function loadSelectedRole(roleId) {
    if (!roleId) {
      setSelectedRole(null);
      setSelectedUsers([]);
      return;
    }

    setDetailLoading(true);
    setError('');

    try {
      const result = await adminService.getRole(roleId);
      const rolePermissions = result.permissions || [];
      setSelectedRole(result.role || null);
      setSelectedUsers(result.users || []);
      setEditForm({
        roleCode: result.role?.roleCode || '',
        roleName: result.role?.roleName || '',
        description: result.role?.description || '',
        active: result.role?.active !== false,
        permissionCodes: permissionCodesFromRolePermissions(rolePermissions),
      });
    } catch (loadError) {
      setError(loadError.message || 'Failed to load role detail.');
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
        const [applicationsResult, rolesResult, permissionsResult] = await Promise.all([
          adminService.listApplications({ active: true, limit: 200 }),
          fetchAllRoles(DEFAULT_FILTERS),
          canReadPermissions
            ? adminService.listPermissions({ appCode: 'ALL', limit: 200 })
            : Promise.resolve({ items: [] }),
        ]);

        if (!active) {
          return;
        }

        setApplications(applicationsResult.items || []);
        const nextRoles = rolesResult.items || [];
        const sortedNextRoles = sortItemsBySorts(nextRoles, ROLE_DEFAULT_SORTS, getRoleSortValue);
        setRoles(nextRoles);
        setSelectedRoleId(sortedNextRoles[0]?.roleId || '');
        setPermissions(permissionsResult.items || []);
      } catch (loadError) {
        if (active) {
          setError(loadError.message || 'Failed to load role data.');
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
    loadSelectedRole(selectedRoleId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedRoleId]);

  useEffect(() => {
    if (!initialLoadCompleteRef.current) {
      return undefined;
    }

    const timeoutId = window.setTimeout(() => {
      Promise.all([loadRoles(filters, ''), loadPermissions(filters.appCode)]);
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


  function toggleCreatePanel() {
    setCreateForm((currentForm) => ({
      ...currentForm,
      appCode: getCreateAppCode(filters),
    }));
    setCreateOpen((currentValue) => !currentValue);
  }

  async function handleCreateRole(event) {
    event.preventDefault();
    setSaving(true);
    setError('');
    setSuccess('');

    try {
      const result = await adminService.createRole({
        appCode: createForm.appCode,
        roleCode: createForm.roleCode,
        roleName: createForm.roleName,
        description: createForm.description || null,
        active: createForm.active,
      });

      setCreateForm({ ...DEFAULT_CREATE_FORM, appCode: getCreateAppCode(filters) });
      setCreateOpen(false);
      setSuccess(`Created role ${result.role?.roleCode || createForm.roleCode}.`);
      await Promise.all([
        loadRoles(filters, result.role?.roleId),
        loadPermissions(filters.appCode),
      ]);
      if (result.role?.roleId) {
        setSelectedRoleId(result.role.roleId);
      }
    } catch (saveError) {
      setError(saveError.message || 'Failed to create role.');
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveRole(event) {
    event.preventDefault();

    if (!selectedRole) {
      return;
    }

    setSaving(true);
    setError('');
    setSuccess('');

    try {
      await adminService.updateRole(selectedRole.roleId, {
        roleCode: editForm.roleCode,
        roleName: editForm.roleName,
        description: editForm.description || null,
      });
      setSuccess('Role updated.');
      await loadRoles(filters, selectedRole.roleId);
      await loadSelectedRole(selectedRole.roleId);
    } catch (saveError) {
      setError(saveError.message || 'Failed to update role.');
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveRoleStatus() {
    if (!selectedRole) {
      return;
    }

    setSaving(true);
    setError('');
    setSuccess('');

    try {
      await adminService.updateRoleStatus(selectedRole.roleId, {
        active: editForm.active,
      });
      setSuccess(`Role ${editForm.active ? 'activated' : 'deactivated'}.`);
      await loadRoles(filters, selectedRole.roleId);
      await loadSelectedRole(selectedRole.roleId);
    } catch (saveError) {
      setError(saveError.message || 'Failed to update role status.');
    } finally {
      setSaving(false);
    }
  }

  async function handleSavePermissions() {
    if (!selectedRole) {
      return;
    }

    setSaving(true);
    setError('');
    setSuccess('');

    try {
      await adminService.updateRolePermissions(selectedRole.roleId, {
        permissionCodes: editForm.permissionCodes,
      });
      setSuccess('Role permission assignments updated.');
      await loadPermissions(filters.appCode);
      await loadSelectedRole(selectedRole.roleId);
    } catch (saveError) {
      setError(saveError.message || 'Failed to update role permissions.');
    } finally {
      setSaving(false);
    }
  }


  function clearFilters() {
    setFilters(DEFAULT_FILTERS);
    setCurrentPage(1);
  }

  function applySorting(nextSorts, customized) {
    const sortedItems = sortItemsBySorts(roles, nextSorts, getRoleSortValue);
    const selectedIndex = selectedRoleId
      ? sortedItems.findIndex((role) => role.roleId === selectedRoleId)
      : -1;

    setSorts(nextSorts);
    setSortingCustomized(customized);
    setCurrentPage(selectedIndex >= 0 ? getPageForAbsoluteIndex(selectedIndex, pageSize) : 1);
  }

  function updateSorting(field, event) {
    const nextState = getNextSortState({
      sorts,
      defaultSorts: ROLE_DEFAULT_SORTS,
      sortingCustomized,
      field,
      shiftKey: Boolean(event?.shiftKey),
    });
    applySorting(nextState.sorts, nextState.customized);
  }

  function clearSorting() {
    applySorting(ROLE_DEFAULT_SORTS, false);
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
    const firstRole = sortedRoles[(nextPage - 1) * pageSize] || null;
    setCurrentPage(nextPage);
    if (firstRole) {
      setSelectedRoleId(firstRole.roleId);
    }
  }

  function changePageSize(value) {
    const nextPageSize = Number(value);

    if (!availablePageSizes.includes(nextPageSize) || nextPageSize === pageSize) {
      return;
    }

    const selectedIndex = selectedRoleId
      ? sortedRoles.findIndex((role) => role.roleId === selectedRoleId)
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
          Showing {rangeStart}–{rangeEnd} of {sortedRoles.length} role(s)
        </div>
        <div className="sky-pagination-controls sky-canonical-operations-pagination-controls" aria-label="Roles pagination">
          <button aria-label="First page" className="btn btn-sm sky-pagination-nav-button" disabled={safeCurrentPage <= 1 || loading} onClick={() => goToPage(1)} title="First page" type="button">«</button>
          <button aria-label="Previous page" className="btn btn-sm sky-pagination-nav-button" disabled={safeCurrentPage <= 1 || loading} onClick={() => goToPage(safeCurrentPage - 1)} title="Previous page" type="button">‹</button>
          <label className="sky-pagination-select-label" htmlFor="rolesPageSelect">Page</label>
          <select className="form-select form-select-sm sky-form-control sky-pagination-select" disabled={loading} id="rolesPageSelect" onChange={(event) => goToPage(event.target.value)} value={safeCurrentPage}>
            {Array.from({ length: pageCount }, (_, index) => index + 1).map((page) => <option key={page} value={page}>{page}</option>)}
          </select>
          <span className="small sky-muted">of {pageCount}</span>
          <button aria-label="Next page" className="btn btn-sm sky-pagination-nav-button" disabled={safeCurrentPage >= pageCount || loading} onClick={() => goToPage(safeCurrentPage + 1)} title="Next page" type="button">›</button>
          <button aria-label="Last page" className="btn btn-sm sky-pagination-nav-button" disabled={safeCurrentPage >= pageCount || loading} onClick={() => goToPage(pageCount)} title="Last page" type="button">»</button>
        </div>
        <div className="sky-canonical-rows-control">
          <label className="sky-pagination-select-label" htmlFor="rolesRowsSelect">Rows</label>
          <select
            className="form-select form-select-sm sky-form-control sky-pagination-select sky-canonical-rows-select"
            disabled={loading}
            id="rolesRowsSelect"
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

  return (
    <>
      <header className="sky-page-header">
        <div>
          <div className="sky-page-kicker">Access control</div>
          <h1 className="sky-page-title">Roles</h1>
          <p className="sky-page-subtitle">
            Define role groups across Sky applications, inspect assigned users, and curate the
            permissions each app role grants.
          </p>
        </div>
        <div className="d-flex flex-wrap gap-2">
          {canWriteRoles && (
            <button className="btn sky-btn-primary" onClick={toggleCreatePanel} type="button">
              {createOpen ? 'Close creator' : 'Create role'}
            </button>
          )}
          <button
            className="btn sky-btn-ghost"
            disabled={loading}
            onClick={() => Promise.all([loadRoles(filters), loadPermissions(filters.appCode)])}
            type="button"
          >
            {loading ? 'Refreshing...' : 'Refresh'}
          </button>
        </div>
      </header>

      {error && <DismissibleAlert tone="danger">{error}</DismissibleAlert>}
      {success && <DismissibleAlert tone="success">{success}</DismissibleAlert>}

      {createOpen && canWriteRoles && (
        <section className="sky-card mb-3">
          <div className="sky-card-header">
            <h2 className="h5 mb-0">Create role</h2>
          </div>
          <div className="sky-card-body">
            <form onSubmit={handleCreateRole}>
              <div className="row g-3">
                <div className="col-md-3">
                  <label className="form-label" htmlFor="createRoleApp">
                    Application
                  </label>
                  <select
                    className="form-select sky-form-control"
                    id="createRoleApp"
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
                  <label className="form-label" htmlFor="createRoleCode">
                    Role code
                  </label>
                  <input
                    className="form-control sky-form-control sky-mono"
                    id="createRoleCode"
                    onChange={(event) =>
                      updateCreateField('roleCode', event.target.value.toUpperCase())
                    }
                    placeholder="REPORT_ADMIN"
                    required
                    value={createForm.roleCode}
                  />
                </div>
                <div className="col-md-3">
                  <label className="form-label" htmlFor="createRoleName">
                    Role name
                  </label>
                  <input
                    className="form-control sky-form-control"
                    id="createRoleName"
                    onChange={(event) => updateCreateField('roleName', event.target.value)}
                    required
                    value={createForm.roleName}
                  />
                </div>
                <div className="col-md-2">
                  <label className="form-label" htmlFor="createRoleDescription">
                    Description
                  </label>
                  <input
                    className="form-control sky-form-control"
                    id="createRoleDescription"
                    onChange={(event) => updateCreateField('description', event.target.value)}
                    value={createForm.description}
                  />
                </div>
                <div className="col-md-1 d-flex align-items-end">
                  <div className="form-check form-switch mb-2">
                    <input
                      checked={createForm.active}
                      className="form-check-input"
                      id="createRoleActive"
                      onChange={(event) => updateCreateField('active', event.target.checked)}
                      type="checkbox"
                    />
                  </div>
                </div>
              </div>
              <button className="btn sky-btn-primary mt-3" disabled={saving} type="submit">
                {saving ? 'Creating...' : 'Create role'}
              </button>
            </form>
          </div>
        </section>
      )}

      <section ref={browserCardRef} className="sky-card sky-functional-history-browser sky-admin-roles-browser sky-table-browser-anchor">
        <div className="sky-card-header">
          <div>
            <div className="sky-page-kicker">Role browser</div>
            <h2 className="h5 mb-0">Role directory</h2>
            <p className="sky-muted small mb-0">
              Search and filter application roles, then select a row to manage role identity,
              permissions, and membership below.
            </p>
          </div>

          <div className="sky-admin-roles-filter-grid">
            <div className="sky-admin-roles-search-filter">
              <label className="form-label" htmlFor="roleSearch">Search</label>
              <input
                className="form-control sky-form-control"
                id="roleSearch"
                onChange={(event) => updateFilter('q', event.target.value)}
                placeholder="Role code, role name, description..."
                type="search"
                value={filters.q}
              />
            </div>
            <div>
              <label className="form-label" htmlFor="roleAppFilter">Application</label>
              <select
                className="form-select sky-form-control"
                id="roleAppFilter"
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
              <label className="form-label" htmlFor="roleActiveFilter">Status</label>
              <select
                className="form-select sky-form-control"
                id="roleActiveFilter"
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
                {renderSortableHeader('Role', 'role')}
                {renderSortableHeader('Application', 'application')}
                {renderSortableHeader('Status', 'status')}
                {renderSortableHeader('System', 'system')}
                {renderSortableHeader('Updated', 'updated')}
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
              ) : visibleRoles.length === 0 ? (
                <tr>
                  <td colSpan="5">
                    <div className="sky-empty-state py-4">No roles match the current filters.</div>
                  </td>
                </tr>
              ) : (
                visibleRoles.map((role) => (
                  <tr
                    className={`sky-clickable-row ${selectedRoleId === role.roleId ? 'sky-selected-row' : ''}`}
                    key={role.roleId}
                    onClick={() => setSelectedRoleId(role.roleId)}
                  >
                    <td>
                      <div className="fw-bold sky-mono">{role.roleCode}</div>
                      <div className="small sky-muted">{role.roleName}</div>
                    </td>
                    <td>
                      <span className="sky-pill sky-pill-info">{role.appCode || 'APP'}</span>
                      <div className="small sky-muted mt-1">{role.appTitle || '—'}</div>
                    </td>
                    <td>
                      <span className={`sky-pill ${activePill(role.active)}`}>
                        {role.active ? 'ACTIVE' : 'INACTIVE'}
                      </span>
                    </td>
                    <td>{role.isSystemRole ? 'Yes' : 'No'}</td>
                    <td>{formatDate(role.updatedAt)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        {renderPagination()}
      </section>

      <section className="sky-card sky-admin-role-detail-card">
        <div className="sky-card-header d-flex flex-wrap align-items-start justify-content-between gap-3">
          <div>
            <div className="sky-page-kicker">Role detail</div>
            <h2 className="h5 mb-1">
              {selectedRole ? selectedRole.roleName || selectedRole.roleCode : 'Selected role workspace'}
            </h2>
            {selectedRole && <div className="small sky-muted sky-mono">{selectedRole.roleCode}</div>}
          </div>
          {selectedRole && (
            <div className="d-flex flex-wrap align-items-center gap-2">
              <span className={`sky-pill ${activePill(selectedRole.active)}`}>
                {selectedRole.active ? 'ACTIVE' : 'INACTIVE'}
              </span>
              <span className="sky-pill sky-pill-info">{selectedRole.appCode || 'APP'}</span>
              {selectedRole.isSystemRole && <span className="sky-pill">System role</span>}
              <span className="sky-pill sky-pill-info">
                {editForm.permissionCodes.length} permission{editForm.permissionCodes.length === 1 ? '' : 's'}
              </span>
              <span className="sky-pill sky-pill-info">
                {selectedUsers.length} user{selectedUsers.length === 1 ? '' : 's'}
              </span>
            </div>
          )}
        </div>

        <div className="sky-card-body">
          {detailLoading ? (
            <div className="sky-empty-state py-5">Loading role detail...</div>
          ) : selectedRole ? (
            <div className="sky-admin-role-detail-stack">
              <section className="sky-admin-role-workspace-section">
                <div className="sky-detail-label">Role identity &amp; lifecycle</div>
                <div className="small sky-muted mb-3">
                  Maintain the role identity, application ownership, description, and lifecycle state.
                </div>

                <form onSubmit={handleSaveRole}>
                  <div className="sky-admin-role-identity-grid">
                    <div>
                      <label className="form-label" htmlFor="editRoleApp">Application</label>
                      <input
                        className="form-control sky-form-control sky-mono"
                        disabled
                        id="editRoleApp"
                        value={selectedRole.appTitle || selectedRole.appCode || '—'}
                      />
                    </div>
                    <div>
                      <label className="form-label" htmlFor="editRoleCode">Role code</label>
                      <input
                        className="form-control sky-form-control sky-mono"
                        disabled={!canWriteRoles || selectedRole.isSystemRole || saving}
                        id="editRoleCode"
                        onChange={(event) => updateEditField('roleCode', event.target.value.toUpperCase())}
                        required
                        value={editForm.roleCode}
                      />
                    </div>
                    <div>
                      <label className="form-label" htmlFor="editRoleName">Role name</label>
                      <input
                        className="form-control sky-form-control"
                        disabled={!canWriteRoles || saving}
                        id="editRoleName"
                        onChange={(event) => updateEditField('roleName', event.target.value)}
                        required
                        value={editForm.roleName}
                      />
                    </div>
                    <div className="sky-admin-role-description-field">
                      <label className="form-label" htmlFor="editRoleDescription">Description</label>
                      <textarea
                        className="form-control sky-form-control"
                        disabled={!canWriteRoles || saving}
                        id="editRoleDescription"
                        onChange={(event) => updateEditField('description', event.target.value)}
                        rows="3"
                        value={editForm.description}
                      />
                    </div>
                  </div>

                  {canWriteRoles && (
                    <button className="btn sky-btn-primary mt-3" disabled={saving} type="submit">
                      Save role
                    </button>
                  )}
                </form>

                <div className="sky-admin-role-status-row">
                  <div>
                    <label className="form-label" htmlFor="editRoleActive">Role status</label>
                    <select
                      className="form-select sky-form-control"
                      disabled={!canWriteRoles || saving}
                      id="editRoleActive"
                      onChange={(event) => updateEditField('active', event.target.value === 'true')}
                      value={String(editForm.active)}
                    >
                      <option value="true">ACTIVE</option>
                      <option value="false">INACTIVE</option>
                    </select>
                  </div>
                  {canWriteRoles && (
                    <button
                      className="btn sky-btn-ghost"
                      disabled={saving}
                      onClick={handleSaveRoleStatus}
                      type="button"
                    >
                      Save status
                    </button>
                  )}
                </div>
              </section>

              <section className="sky-admin-role-workspace-section">
                <div className="sky-detail-label">Permissions &amp; membership</div>
                <div className="small sky-muted mb-3">
                  Curate the permissions granted by this role and review the users currently assigned to it.
                </div>

                <div className="sky-admin-role-access-grid">
                  <div className="sky-admin-role-permissions-panel">
                    <div className="sky-detail-label mb-2">Permission assignments</div>
                    {canReadPermissions ? (
                      <>
                        <label className="form-label" htmlFor="editRolePermissions">
                          Permissions for {selectedRole.appTitle || selectedRole.appCode}
                        </label>
                        <select
                          className="form-select sky-form-control sky-admin-role-permission-select"
                          disabled={!canWritePermissions || saving}
                          id="editRolePermissions"
                          multiple
                          onChange={(event) => updateEditField('permissionCodes', getSelectedCodesFromEvent(event))}
                          value={editForm.permissionCodes}
                        >
                          {activePermissions.map((permission) => (
                            <option key={permission.permissionCode} value={permission.permissionCode}>
                              {permission.permissionCode} · {permission.resource}/{permission.action}
                            </option>
                          ))}
                        </select>
                        <div className="form-text sky-muted">
                          Hold Ctrl/Cmd to select multiple permissions. Only same-app permissions are assignable.
                        </div>
                        {canWritePermissions && (
                          <button
                            className="btn sky-btn-ghost mt-3"
                            disabled={saving}
                            onClick={handleSavePermissions}
                            type="button"
                          >
                            Save permissions
                          </button>
                        )}
                      </>
                    ) : (
                      <div className="sky-empty-state py-3">
                        Permission assignment details require ADMIN_PERMISSION_READ.
                      </div>
                    )}
                  </div>

                  <div className="sky-admin-role-users-panel">
                    <div className="d-flex align-items-center justify-content-between gap-2 mb-2">
                      <div className="sky-detail-label">Assigned users</div>
                      <span className="sky-pill sky-pill-info">{selectedUsers.length}</span>
                    </div>
                    {selectedUsers.length > 0 ? (
                      <div className="table-responsive sky-admin-role-users-table-wrap">
                        <table className="table table-sm sky-table align-middle mb-0">
                          <thead>
                            <tr>
                              <th>User</th>
                              <th>Status</th>
                            </tr>
                          </thead>
                          <tbody>
                            {selectedUsers.map((item) => (
                              <tr key={item.userId}>
                                <td>
                                  <div className="fw-bold sky-detail-value">
                                    {item.displayName || item.username || item.email}
                                  </div>
                                  <div className="small sky-muted">{item.email}</div>
                                </td>
                                <td>{item.userStatus || '—'}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <div className="sky-empty-state py-3">No users currently have this role.</div>
                    )}
                  </div>
                </div>
              </section>
            </div>
          ) : (
            <div className="sky-empty-state py-5">Select a role to inspect.</div>
          )}
        </div>
      </section>
    </>
  );
}

export default AdminRoles;
