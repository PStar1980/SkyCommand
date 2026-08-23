import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../context/AuthContext.jsx';
import adminService from '../services/adminService';

import DismissibleAlert from '../components/ui/DismissibleAlert.jsx';
const DEFAULT_FILTERS = {
  q: '',
  appCode: 'ALL',
  resource: '',
  action: '',
  active: '',
  limit: '50',
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

function AdminPrivileges() {
  const { hasPermission } = useAuth();
  const canWritePermissions = hasPermission('ADMIN_PERMISSION_WRITE');

  const [applications, setApplications] = useState([]);
  const [permissions, setPermissions] = useState([]);
  const [selectedPermissionId, setSelectedPermissionId] = useState('');
  const [selectedPermission, setSelectedPermission] = useState(null);
  const [selectedRoles, setSelectedRoles] = useState([]);
  const [filters, setFilters] = useState(DEFAULT_FILTERS);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState(DEFAULT_CREATE_FORM);
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

  async function loadPermissions(
    nextFilters = filters,
    preferredPermissionId = selectedPermissionId,
  ) {
    setLoading(true);
    setError('');

    try {
      const result = await adminService.listPermissions(nextFilters);
      const nextPermissions = result.items || [];
      setPermissions(nextPermissions);
      setTotal(result.total || 0);

      if (nextPermissions.length === 0) {
        setSelectedPermissionId('');
        setSelectedPermission(null);
        setSelectedRoles([]);
        return;
      }

      const stillVisible = nextPermissions.some(
        (permission) => permission.permissionId === preferredPermissionId,
      );
      setSelectedPermissionId(
        stillVisible ? preferredPermissionId : nextPermissions[0].permissionId,
      );
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
          adminService.listPermissions(DEFAULT_FILTERS),
        ]);

        if (!active) {
          return;
        }

        setApplications(applicationsResult.items || []);
        setPermissions(permissionsResult.items || []);
        setTotal(permissionsResult.total || 0);
        setSelectedPermissionId(permissionsResult.items?.[0]?.permissionId || '');
      } catch (loadError) {
        if (active) {
          setError(loadError.message || 'Failed to load privileges.');
        }
      } finally {
        if (active) {
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

  async function handleApplyFilters(event) {
    event.preventDefault();
    await loadPermissions(filters);
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

      <section className="sky-card mb-3">
        <div className="sky-card-body">
          <form className="row g-3 align-items-end" onSubmit={handleApplyFilters}>
            <div className="col-md-3">
              <label className="form-label" htmlFor="permissionSearch">
                Search
              </label>
              <input
                className="form-control sky-form-control"
                id="permissionSearch"
                onChange={(event) => updateFilter('q', event.target.value)}
                placeholder="Code, resource, action, description..."
                value={filters.q}
              />
            </div>
            <div className="col-md-2">
              <label className="form-label" htmlFor="permissionAppFilter">
                Application
              </label>
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
            <div className="col-md-2">
              <label className="form-label" htmlFor="permissionResourceFilter">
                Resource
              </label>
              <select
                className="form-select sky-form-control"
                id="permissionResourceFilter"
                onChange={(event) => updateFilter('resource', event.target.value)}
                value={filters.resource}
              >
                <option value="">All</option>
                {resources.map((resource) => (
                  <option key={resource} value={resource}>
                    {resource}
                  </option>
                ))}
              </select>
            </div>
            <div className="col-md-2">
              <label className="form-label" htmlFor="permissionActionFilter">
                Action
              </label>
              <select
                className="form-select sky-form-control"
                id="permissionActionFilter"
                onChange={(event) => updateFilter('action', event.target.value)}
                value={filters.action}
              >
                <option value="">All</option>
                {actions.map((action) => (
                  <option key={action} value={action}>
                    {action}
                  </option>
                ))}
              </select>
            </div>
            <div className="col-md-1">
              <label className="form-label" htmlFor="permissionActiveFilter">
                Active
              </label>
              <select
                className="form-select sky-form-control"
                id="permissionActiveFilter"
                onChange={(event) => updateFilter('active', event.target.value)}
                value={filters.active}
              >
                <option value="">All</option>
                <option value="true">Active</option>
                <option value="false">Inactive</option>
              </select>
            </div>
            <div className="col-md-1">
              <label className="form-label" htmlFor="permissionLimit">
                Limit
              </label>
              <select
                className="form-select sky-form-control"
                id="permissionLimit"
                onChange={(event) => updateFilter('limit', event.target.value)}
                value={filters.limit}
              >
                <option value="25">25</option>
                <option value="50">50</option>
                <option value="100">100</option>
              </select>
            </div>
            <div className="col-md-1 d-grid">
              <button className="btn sky-btn-ghost" disabled={loading} type="submit">
                Go
              </button>
            </div>
          </form>
        </div>
      </section>

      <div className="row g-3">
        <div className="col-xl-7">
          <section className="sky-card sky-table-card">
            {loading ? (
              <div className="sky-empty-state">
                <div className="spinner-border text-info" role="status" aria-label="Loading" />
                <div className="mt-3">Loading privileges...</div>
              </div>
            ) : permissions.length === 0 ? (
              <div className="sky-empty-state">No privileges matched the current filters.</div>
            ) : (
              <div className="table-responsive">
                <table className="table table-hover sky-table">
                  <thead>
                    <tr>
                      <th>Privilege</th>
                      <th>Application</th>
                      <th>Resource</th>
                      <th>Action</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {permissions.map((permission) => (
                      <tr
                        className={`sky-clickable-row ${
                          selectedPermissionId === permission.permissionId ? 'sky-selected-row' : ''
                        }`}
                        key={permission.permissionId}
                        onClick={() => setSelectedPermissionId(permission.permissionId)}
                      >
                        <td>
                          <div className="fw-bold sky-detail-value sky-mono">
                            {permission.permissionCode}
                          </div>
                          <div className="small sky-muted sky-truncate">
                            {permission.description || '—'}
                          </div>
                        </td>
                        <td>
                          <span className="sky-pill sky-pill-info">
                            {permission.appCode || 'APP'}
                          </span>
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
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
          <div className="small sky-muted mt-2">
            Showing {permissions.length} of {total}
          </div>
        </div>

        <div className="col-xl-5">
          <section className="sky-card">
            <div className="sky-card-header">
              <h2 className="h5 mb-0">Privilege detail</h2>
            </div>
            <div className="sky-card-body">
              {detailLoading ? (
                <div className="sky-empty-state">Loading privilege detail...</div>
              ) : selectedPermission ? (
                <>
                  <div className="d-flex flex-wrap align-items-center gap-2 mb-3">
                    <span className={`sky-pill ${activePill(selectedPermission.active)}`}>
                      {selectedPermission.active ? 'ACTIVE' : 'INACTIVE'}
                    </span>
                    <span className="sky-pill sky-pill-info">
                      {selectedPermission.appCode || 'APP'}
                    </span>
                    <span className="sky-pill sky-pill-info">
                      {selectedRoles.length} role{selectedRoles.length === 1 ? '' : 's'}
                    </span>
                    <span className="sky-pill sky-pill-info">
                      Updated {formatDate(selectedPermission.updatedAt)}
                    </span>
                  </div>

                  <form onSubmit={handleSavePermission}>
                    <div className="row g-3">
                      <div className="col-md-12">
                        <label className="form-label" htmlFor="editPermissionApp">
                          Application
                        </label>
                        <input
                          className="form-control sky-form-control sky-mono"
                          disabled
                          id="editPermissionApp"
                          value={selectedPermission.appTitle || selectedPermission.appCode || '—'}
                        />
                      </div>
                      <div className="col-md-12">
                        <label className="form-label" htmlFor="editPermissionCode">
                          Permission code
                        </label>
                        <input
                          className="form-control sky-form-control sky-mono"
                          disabled={!canWritePermissions || saving}
                          id="editPermissionCode"
                          onChange={(event) =>
                            updateEditField(
                              'permissionCode',
                              normalizePermissionCode(event.target.value),
                            )
                          }
                          required
                          value={editForm.permissionCode}
                        />
                      </div>
                      <div className="col-md-6">
                        <label className="form-label" htmlFor="editResource">
                          Resource
                        </label>
                        <input
                          className="form-control sky-form-control sky-mono"
                          disabled={!canWritePermissions || saving}
                          id="editResource"
                          onChange={(event) =>
                            updateEditField('resource', normalizeResourceAction(event.target.value))
                          }
                          required
                          value={editForm.resource}
                        />
                      </div>
                      <div className="col-md-6">
                        <label className="form-label" htmlFor="editAction">
                          Action
                        </label>
                        <input
                          className="form-control sky-form-control sky-mono"
                          disabled={!canWritePermissions || saving}
                          id="editAction"
                          onChange={(event) =>
                            updateEditField('action', normalizeResourceAction(event.target.value))
                          }
                          required
                          value={editForm.action}
                        />
                      </div>
                      <div className="col-md-12">
                        <label className="form-label" htmlFor="editPermissionDescription">
                          Description
                        </label>
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

                  <hr className="border-secondary my-4" />

                  <div className="row g-3 align-items-end">
                    <div className="col-md-7">
                      <label className="form-label" htmlFor="editPermissionActive">
                        Privilege status
                      </label>
                      <select
                        className="form-select sky-form-control"
                        disabled={!canWritePermissions || saving}
                        id="editPermissionActive"
                        onChange={(event) =>
                          updateEditField('active', event.target.value === 'true')
                        }
                        value={String(editForm.active)}
                      >
                        <option value="true">ACTIVE</option>
                        <option value="false">INACTIVE</option>
                      </select>
                    </div>
                    {canWritePermissions && (
                      <div className="col-md-5 d-grid">
                        <button
                          className="btn sky-btn-ghost"
                          disabled={saving}
                          onClick={handleSavePermissionStatus}
                          type="button"
                        >
                          Save status
                        </button>
                      </div>
                    )}
                  </div>

                  <hr className="border-secondary my-4" />

                  <div className="sky-detail-label mb-2">Granted through roles</div>
                  {selectedRoles.length > 0 ? (
                    <div className="table-responsive">
                      <table className="table sky-table">
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
                                <div className="fw-bold sky-detail-value sky-mono">
                                  {role.roleCode}
                                </div>
                                <div className="small sky-muted">{role.roleName}</div>
                              </td>
                              <td>
                                <span className="sky-pill sky-pill-info">
                                  {role.roleAppCode || role.appCode || 'APP'}
                                </span>
                              </td>
                              <td>
                                <span
                                  className={`sky-pill ${activePill(role.rolePermissionActive)}`}
                                >
                                  {role.rolePermissionActive ? 'GRANTED' : 'INACTIVE'}
                                </span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <div className="sky-empty-state py-3">
                      No roles currently grant this privilege.
                    </div>
                  )}
                </>
              ) : (
                <div className="sky-empty-state">Select a privilege to inspect.</div>
              )}
            </div>
          </section>
        </div>
      </div>
    </>
  );
}

export default AdminPrivileges;
