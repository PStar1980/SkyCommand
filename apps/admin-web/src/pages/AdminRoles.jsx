import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../context/AuthContext.jsx';
import adminService from '../services/adminService';

const DEFAULT_FILTERS = {
  q: '',
  appCode: 'ALL',
  active: '',
  limit: '50',
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
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState(DEFAULT_CREATE_FORM);
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

  async function loadPermissions(nextAppCode = 'ALL') {
    if (!canReadPermissions) {
      return;
    }

    const result = await adminService.listPermissions({ appCode: nextAppCode, limit: 200 });
    setPermissions(result.items || []);
  }

  async function loadRoles(nextFilters = filters, preferredRoleId = selectedRoleId) {
    setLoading(true);
    setError('');

    try {
      const result = await adminService.listRoles(nextFilters);
      const nextRoles = result.items || [];
      setRoles(nextRoles);
      setTotal(result.total || 0);

      if (nextRoles.length === 0) {
        setSelectedRoleId('');
        setSelectedRole(null);
        setSelectedUsers([]);
        return;
      }

      const stillVisible = nextRoles.some((role) => role.roleId === preferredRoleId);
      setSelectedRoleId(stillVisible ? preferredRoleId : nextRoles[0].roleId);
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
          adminService.listRoles(DEFAULT_FILTERS),
          canReadPermissions
            ? adminService.listPermissions({ appCode: 'ALL', limit: 200 })
            : Promise.resolve({ items: [] }),
        ]);

        if (!active) {
          return;
        }

        setApplications(applicationsResult.items || []);
        setRoles(rolesResult.items || []);
        setTotal(rolesResult.total || 0);
        setSelectedRoleId(rolesResult.items?.[0]?.roleId || '');
        setPermissions(permissionsResult.items || []);
      } catch (loadError) {
        if (active) {
          setError(loadError.message || 'Failed to load role data.');
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
    loadSelectedRole(selectedRoleId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedRoleId]);

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
    await Promise.all([loadRoles(filters), loadPermissions(filters.appCode)]);
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

      {error && <div className="alert alert-danger">{error}</div>}
      {success && <div className="alert alert-success">{success}</div>}

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

      <section className="sky-card mb-3">
        <div className="sky-card-body">
          <form className="row g-3 align-items-end" onSubmit={handleApplyFilters}>
            <div className="col-md-4">
              <label className="form-label" htmlFor="roleSearch">
                Search
              </label>
              <input
                className="form-control sky-form-control"
                id="roleSearch"
                onChange={(event) => updateFilter('q', event.target.value)}
                placeholder="Role code, role name, description..."
                value={filters.q}
              />
            </div>
            <div className="col-md-3">
              <label className="form-label" htmlFor="roleAppFilter">
                Application
              </label>
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
            <div className="col-md-2">
              <label className="form-label" htmlFor="roleActiveFilter">
                Active
              </label>
              <select
                className="form-select sky-form-control"
                id="roleActiveFilter"
                onChange={(event) => updateFilter('active', event.target.value)}
                value={filters.active}
              >
                <option value="">All</option>
                <option value="true">Active</option>
                <option value="false">Inactive</option>
              </select>
            </div>
            <div className="col-md-1">
              <label className="form-label" htmlFor="roleLimit">
                Limit
              </label>
              <select
                className="form-select sky-form-control"
                id="roleLimit"
                onChange={(event) => updateFilter('limit', event.target.value)}
                value={filters.limit}
              >
                <option value="25">25</option>
                <option value="50">50</option>
                <option value="100">100</option>
              </select>
            </div>
            <div className="col-md-2 d-grid">
              <button className="btn sky-btn-ghost" disabled={loading} type="submit">
                Apply
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
                <div className="mt-3">Loading roles...</div>
              </div>
            ) : roles.length === 0 ? (
              <div className="sky-empty-state">No roles matched the current filters.</div>
            ) : (
              <div className="table-responsive">
                <table className="table table-hover sky-table">
                  <thead>
                    <tr>
                      <th>Role</th>
                      <th>Application</th>
                      <th>Status</th>
                      <th>System</th>
                      <th>Updated</th>
                    </tr>
                  </thead>
                  <tbody>
                    {roles.map((role) => (
                      <tr
                        className={`sky-clickable-row ${
                          selectedRoleId === role.roleId ? 'sky-selected-row' : ''
                        }`}
                        key={role.roleId}
                        onClick={() => setSelectedRoleId(role.roleId)}
                      >
                        <td>
                          <div className="fw-bold sky-detail-value sky-mono">{role.roleCode}</div>
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
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
          <div className="small sky-muted mt-2">
            Showing {roles.length} of {total}
          </div>
        </div>

        <div className="col-xl-5">
          <section className="sky-card">
            <div className="sky-card-header">
              <h2 className="h5 mb-0">Role detail</h2>
            </div>
            <div className="sky-card-body">
              {detailLoading ? (
                <div className="sky-empty-state">Loading role detail...</div>
              ) : selectedRole ? (
                <>
                  <div className="d-flex flex-wrap align-items-center gap-2 mb-3">
                    <span className={`sky-pill ${activePill(selectedRole.active)}`}>
                      {selectedRole.active ? 'ACTIVE' : 'INACTIVE'}
                    </span>
                    <span className="sky-pill sky-pill-info">{selectedRole.appCode || 'APP'}</span>
                    {selectedRole.isSystemRole && <span className="sky-pill">System role</span>}
                    <span className="sky-pill sky-pill-info">
                      {editForm.permissionCodes.length} permission
                      {editForm.permissionCodes.length === 1 ? '' : 's'}
                    </span>
                    <span className="sky-pill sky-pill-info">
                      {selectedUsers.length} user{selectedUsers.length === 1 ? '' : 's'}
                    </span>
                  </div>

                  <form onSubmit={handleSaveRole}>
                    <div className="row g-3">
                      <div className="col-md-12">
                        <label className="form-label" htmlFor="editRoleApp">
                          Application
                        </label>
                        <input
                          className="form-control sky-form-control sky-mono"
                          disabled
                          id="editRoleApp"
                          value={selectedRole.appTitle || selectedRole.appCode || '—'}
                        />
                      </div>
                      <div className="col-md-5">
                        <label className="form-label" htmlFor="editRoleCode">
                          Role code
                        </label>
                        <input
                          className="form-control sky-form-control sky-mono"
                          disabled={!canWriteRoles || selectedRole.isSystemRole || saving}
                          id="editRoleCode"
                          onChange={(event) =>
                            updateEditField('roleCode', event.target.value.toUpperCase())
                          }
                          required
                          value={editForm.roleCode}
                        />
                      </div>
                      <div className="col-md-7">
                        <label className="form-label" htmlFor="editRoleName">
                          Role name
                        </label>
                        <input
                          className="form-control sky-form-control"
                          disabled={!canWriteRoles || saving}
                          id="editRoleName"
                          onChange={(event) => updateEditField('roleName', event.target.value)}
                          required
                          value={editForm.roleName}
                        />
                      </div>
                      <div className="col-md-12">
                        <label className="form-label" htmlFor="editRoleDescription">
                          Description
                        </label>
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

                  <hr className="border-secondary my-4" />

                  <div className="row g-3 align-items-end">
                    <div className="col-md-7">
                      <label className="form-label" htmlFor="editRoleActive">
                        Role status
                      </label>
                      <select
                        className="form-select sky-form-control"
                        disabled={!canWriteRoles || saving}
                        id="editRoleActive"
                        onChange={(event) =>
                          updateEditField('active', event.target.value === 'true')
                        }
                        value={String(editForm.active)}
                      >
                        <option value="true">ACTIVE</option>
                        <option value="false">INACTIVE</option>
                      </select>
                    </div>
                    {canWriteRoles && (
                      <div className="col-md-5 d-grid">
                        <button
                          className="btn sky-btn-ghost"
                          disabled={saving}
                          onClick={handleSaveRoleStatus}
                          type="button"
                        >
                          Save status
                        </button>
                      </div>
                    )}
                  </div>

                  <hr className="border-secondary my-4" />

                  {canReadPermissions ? (
                    <div>
                      <label className="form-label" htmlFor="editRolePermissions">
                        Permission assignments for {selectedRole.appTitle || selectedRole.appCode}
                      </label>
                      <select
                        className="form-select sky-form-control"
                        disabled={!canWritePermissions || saving}
                        id="editRolePermissions"
                        multiple
                        onChange={(event) =>
                          updateEditField('permissionCodes', getSelectedCodesFromEvent(event))
                        }
                        value={editForm.permissionCodes}
                      >
                        {activePermissions.map((permission) => (
                          <option key={permission.permissionCode} value={permission.permissionCode}>
                            {permission.permissionCode} · {permission.resource}/{permission.action}
                          </option>
                        ))}
                      </select>
                      <div className="form-text sky-muted">
                        Hold Ctrl/Cmd to select multiple permissions. Only same-app permissions are
                        assignable.
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
                    </div>
                  ) : (
                    <div className="sky-empty-state py-3">
                      Permission assignment details require ADMIN_PERMISSION_READ.
                    </div>
                  )}

                  <hr className="border-secondary my-4" />

                  <div className="sky-detail-label mb-2">Assigned users</div>
                  {selectedUsers.length > 0 ? (
                    <div className="table-responsive">
                      <table className="table sky-table">
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
                </>
              ) : (
                <div className="sky-empty-state">Select a role to inspect.</div>
              )}
            </div>
          </section>
        </div>
      </div>
    </>
  );
}

export default AdminRoles;
