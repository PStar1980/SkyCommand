import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../context/AuthContext.jsx';
import adminService from '../services/adminService';

const USER_STATUSES = ['ACTIVE', 'PENDING', 'LOCKED', 'DISABLED'];
const DEFAULT_ADMIN_APP_CODE = 'SKYSERVER_ADMIN';
const DEFAULT_CREATE_FORM = {
  email: '',
  username: '',
  displayName: '',
  password: '',
  status: 'ACTIVE',
  roleCodes: ['VIEWER'],
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

function statusClass(status) {
  if (status === 'ACTIVE') {
    return 'sky-pill-success';
  }

  if (status === 'LOCKED' || status === 'DISABLED') {
    return 'sky-pill-danger';
  }

  if (status === 'PENDING') {
    return 'sky-pill-warning';
  }

  return 'sky-pill-info';
}

function membershipStatusClass(status) {
  if (status === 'ACTIVE') {
    return 'sky-pill-success';
  }

  if (status === 'DISABLED') {
    return 'sky-pill-danger';
  }

  return 'sky-pill-info';
}

function normalizeApplicationForm(applications = []) {
  return applications.map((application) => ({
    appCode: application.appCode,
    title: application.title,
    description: application.description,
    active: application.active,
    status: application.membershipStatus === 'ACTIVE' ? 'ACTIVE' : 'DISABLED',
    roleCodes: application.assignedRoleCodes || [],
    roles: application.roles || [],
  }));
}

function getDefaultRoleCode(application) {
  const preferredByApp = {
    SKYSERVER_ADMIN: 'VIEWER',
    SKYWEB: 'SKYWEB_USER',
  };
  const preferredCode = preferredByApp[application.appCode];
  const preferredRole = application.roles?.find((role) => role.roleCode === preferredCode);

  return preferredRole?.roleCode || application.roles?.[0]?.roleCode || null;
}

function applicationAccessCount(applications = []) {
  return applications.filter((application) => application.status === 'ACTIVE').length;
}

function getSelectedCodesFromEvent(event) {
  return Array.from(event.target.selectedOptions).map((option) => option.value);
}

function cleanPayload(payload) {
  return Object.fromEntries(
    Object.entries(payload).filter(([, value]) => value !== undefined && value !== null),
  );
}

function roleCodesFromUserRoles(userRoles = []) {
  return userRoles
    .filter(
      (role) =>
        role.userRoleActive !== false &&
        role.roleActive !== false &&
        (!role.appCode || role.appCode === DEFAULT_ADMIN_APP_CODE),
    )
    .map((role) => role.roleCode)
    .filter(Boolean);
}

function AdminUsers() {
  const { hasPermission, user: currentUser } = useAuth();
  const canWriteUsers = hasPermission('ADMIN_USER_WRITE');
  const canWriteRoles = hasPermission('ADMIN_ROLE_WRITE');

  const [users, setUsers] = useState([]);
  const [roles, setRoles] = useState([]);
  const [applications, setApplications] = useState([]);
  const [selectedUserId, setSelectedUserId] = useState('');
  const [selectedUser, setSelectedUser] = useState(null);
  const [selectedPermissions, setSelectedPermissions] = useState([]);
  const [applicationForm, setApplicationForm] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [filters, setFilters] = useState({ q: '', status: '', appCode: '', limit: 50 });
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState(DEFAULT_CREATE_FORM);
  const [editForm, setEditForm] = useState({
    email: '',
    username: '',
    displayName: '',
    status: 'ACTIVE',
    roleCodes: [],
  });
  const [passwordForm, setPasswordForm] = useState({ password: '', revokeSessions: true });

  const activeRoles = useMemo(
    () =>
      roles.filter(
        (role) => role.active && (!role.appCode || role.appCode === DEFAULT_ADMIN_APP_CODE),
      ),
    [roles],
  );
  const selectedIsCurrentUser = currentUser?.userId && selectedUser?.userId === currentUser.userId;

  async function loadRoles() {
    const result = await adminService.listRoles({ limit: 200 });
    setRoles(result.items || []);
  }

  async function loadUsers(nextFilters = filters, preferredUserId = selectedUserId) {
    setLoading(true);
    setError('');

    try {
      const result = await adminService.listUsers(nextFilters);
      const nextUsers = result.items || [];
      setUsers(nextUsers);
      setTotal(result.total || 0);

      if (nextUsers.length === 0) {
        setSelectedUserId('');
        setSelectedUser(null);
        setSelectedPermissions([]);
        setApplicationForm([]);
        setSessions([]);
        return;
      }

      const stillVisible = nextUsers.some((item) => item.userId === preferredUserId);
      setSelectedUserId(stillVisible ? preferredUserId : nextUsers[0].userId);
    } catch (loadError) {
      setError(loadError.message || 'Failed to load users.');
    } finally {
      setLoading(false);
    }
  }

  async function loadSelectedUser(userId) {
    if (!userId) {
      setSelectedUser(null);
      setSelectedPermissions([]);
      setApplicationForm([]);
      setSessions([]);
      return;
    }

    setDetailLoading(true);
    setError('');

    try {
      const [userResult, sessionResult] = await Promise.all([
        adminService.getUser(userId),
        adminService.getUserSessions(userId),
      ]);

      const userRoles = userResult.roles || [];
      const roleCodes = roleCodesFromUserRoles(userRoles);

      setSelectedUser(userResult.user || null);
      setSelectedPermissions(userResult.permissions || []);
      setApplicationForm(normalizeApplicationForm(userResult.applications || []));
      setSessions(sessionResult.items || []);
      setEditForm({
        email: userResult.user?.email || '',
        username: userResult.user?.username || '',
        displayName: userResult.user?.displayName || '',
        status: userResult.user?.status || 'ACTIVE',
        roleCodes,
      });
      setPasswordForm({ password: '', revokeSessions: true });
    } catch (loadError) {
      setError(loadError.message || 'Failed to load user detail.');
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
        const [rolesResult, applicationsResult, usersResult] = await Promise.all([
          adminService.listRoles({ limit: 200 }),
          adminService.listApplications({ active: true, limit: 100 }),
          adminService.listUsers(filters),
        ]);

        if (!active) {
          return;
        }

        setRoles(rolesResult.items || []);
        setApplications(applicationsResult.items || []);
        setUsers(usersResult.items || []);
        setTotal(usersResult.total || 0);
        setSelectedUserId(usersResult.items?.[0]?.userId || '');
      } catch (loadError) {
        if (active) {
          setError(loadError.message || 'Failed to load access-control data.');
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
    loadSelectedUser(selectedUserId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedUserId]);

  function updateFilter(name, value) {
    const nextFilters = {
      ...filters,
      [name]: value,
    };

    setFilters(nextFilters);
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
    await loadUsers(filters);
  }

  async function handleCreateUser(event) {
    event.preventDefault();
    setSaving(true);
    setError('');
    setSuccess('');

    try {
      const result = await adminService.createUser({
        email: createForm.email,
        username: createForm.username || null,
        displayName: createForm.displayName || null,
        password: createForm.password,
        status: createForm.status,
        roleCodes: createForm.roleCodes,
      });

      setCreateForm(DEFAULT_CREATE_FORM);
      setCreateOpen(false);
      setSuccess(`Created user ${result.user?.email || createForm.email}.`);
      await loadUsers(filters, result.user?.userId);
      if (result.user?.userId) {
        setSelectedUserId(result.user.userId);
      }
    } catch (saveError) {
      setError(saveError.message || 'Failed to create user.');
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveProfile(event) {
    event.preventDefault();

    if (!selectedUser) {
      return;
    }

    setSaving(true);
    setError('');
    setSuccess('');

    try {
      await adminService.updateUser(
        selectedUser.userId,
        cleanPayload({
          email: editForm.email,
          username: editForm.username || null,
          displayName: editForm.displayName || null,
        }),
      );
      setSuccess('User profile updated.');
      await loadUsers(filters, selectedUser.userId);
      await loadSelectedUser(selectedUser.userId);
    } catch (saveError) {
      setError(saveError.message || 'Failed to update user profile.');
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveStatus() {
    if (!selectedUser) {
      return;
    }

    setSaving(true);
    setError('');
    setSuccess('');

    try {
      const result = await adminService.updateUserStatus(selectedUser.userId, {
        status: editForm.status,
      });
      setSuccess(
        `User status updated to ${result.user?.status || editForm.status}. Revoked sessions: ${
          result.revokedSessionCount || 0
        }.`,
      );
      await loadUsers(filters, selectedUser.userId);
      await loadSelectedUser(selectedUser.userId);
    } catch (saveError) {
      setError(saveError.message || 'Failed to update user status.');
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveRoles() {
    if (!selectedUser) {
      return;
    }

    setSaving(true);
    setError('');
    setSuccess('');

    try {
      await adminService.updateUserRoles(selectedUser.userId, {
        roleCodes: editForm.roleCodes,
      });
      setSuccess('User role assignments updated.');
      await loadRoles();
      await loadSelectedUser(selectedUser.userId);
    } catch (saveError) {
      setError(saveError.message || 'Failed to update user roles.');
    } finally {
      setSaving(false);
    }
  }

  function updateApplicationStatus(appCode, enabled) {
    setApplicationForm((currentApplications) =>
      currentApplications.map((application) => {
        if (application.appCode !== appCode) {
          return application;
        }

        const defaultRoleCode = getDefaultRoleCode(application);
        const nextRoleCodes =
          enabled && application.roleCodes.length === 0 && defaultRoleCode
            ? [defaultRoleCode]
            : application.roleCodes;

        return {
          ...application,
          status: enabled ? 'ACTIVE' : 'DISABLED',
          roleCodes: enabled ? nextRoleCodes : [],
        };
      }),
    );
  }

  function updateApplicationRole(appCode, roleCode, enabled) {
    setApplicationForm((currentApplications) =>
      currentApplications.map((application) => {
        if (application.appCode !== appCode) {
          return application;
        }

        const nextRoleCodes = enabled
          ? [...new Set([...application.roleCodes, roleCode])]
          : application.roleCodes.filter((currentRoleCode) => currentRoleCode !== roleCode);

        return {
          ...application,
          status: nextRoleCodes.length > 0 ? 'ACTIVE' : application.status,
          roleCodes: nextRoleCodes,
        };
      }),
    );
  }

  async function handleSaveApplications() {
    if (!selectedUser) {
      return;
    }

    setSaving(true);
    setError('');
    setSuccess('');

    try {
      const result = await adminService.updateUserApplications(selectedUser.userId, {
        applications: applicationForm.map((application) => ({
          appCode: application.appCode,
          status: application.status,
          roleCodes: application.status === 'ACTIVE' ? application.roleCodes : [],
        })),
      });

      setSuccess(
        `Application access updated. Revoked sessions: ${result.revokedSessionCount || 0}.`,
      );
      await loadSelectedUser(selectedUser.userId);
    } catch (saveError) {
      setError(saveError.message || 'Failed to update application access.');
    } finally {
      setSaving(false);
    }
  }

  async function handleResetPassword(event) {
    event.preventDefault();

    if (!selectedUser) {
      return;
    }

    setSaving(true);
    setError('');
    setSuccess('');

    try {
      const result = await adminService.resetUserPassword(selectedUser.userId, passwordForm);
      setSuccess(`Password reset complete. Revoked sessions: ${result.revokedSessionCount || 0}.`);
      setPasswordForm({ password: '', revokeSessions: true });
      await loadSelectedUser(selectedUser.userId);
    } catch (saveError) {
      setError(saveError.message || 'Failed to reset password.');
    } finally {
      setSaving(false);
    }
  }

  async function handleRevokeSessions() {
    if (!selectedUser) {
      return;
    }

    setSaving(true);
    setError('');
    setSuccess('');

    try {
      const result = await adminService.revokeUserSessions(selectedUser.userId, {
        reason: 'ADMIN_WEB_REVOKE_USER_SESSIONS',
      });
      setSuccess(`Revoked ${result.revokedSessionCount || 0} active session(s).`);
      await loadSelectedUser(selectedUser.userId);
    } catch (saveError) {
      setError(saveError.message || 'Failed to revoke sessions.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <header className="sky-page-header">
        <div>
          <div className="sky-page-kicker">Access control</div>
          <h1 className="sky-page-title">Users</h1>
          <p className="sky-page-subtitle">
            Manage shared identities, application access, user status, role assignments, password
            resets, and active sessions.
          </p>
        </div>
        <div className="d-flex flex-wrap gap-2">
          {canWriteUsers && (
            <button
              className="btn sky-btn-primary"
              onClick={() => setCreateOpen((currentValue) => !currentValue)}
              type="button"
            >
              {createOpen ? 'Close creator' : 'Create user'}
            </button>
          )}
          <button
            className="btn sky-btn-ghost"
            disabled={loading}
            onClick={() => loadUsers(filters)}
            type="button"
          >
            {loading ? 'Refreshing...' : 'Refresh'}
          </button>
        </div>
      </header>

      {error && <div className="alert alert-danger">{error}</div>}
      {success && <div className="alert alert-success">{success}</div>}

      {createOpen && canWriteUsers && (
        <section className="sky-card mb-3">
          <div className="sky-card-header">
            <h2 className="h5 mb-0">Create user</h2>
          </div>
          <div className="sky-card-body">
            <form onSubmit={handleCreateUser}>
              <div className="row g-3">
                <div className="col-md-4">
                  <label className="form-label" htmlFor="createEmail">
                    Email
                  </label>
                  <input
                    className="form-control sky-form-control"
                    id="createEmail"
                    onChange={(event) => updateCreateField('email', event.target.value)}
                    required
                    type="email"
                    value={createForm.email}
                  />
                </div>
                <div className="col-md-4">
                  <label className="form-label" htmlFor="createUsername">
                    Username
                  </label>
                  <input
                    className="form-control sky-form-control"
                    id="createUsername"
                    onChange={(event) => updateCreateField('username', event.target.value)}
                    value={createForm.username}
                  />
                </div>
                <div className="col-md-4">
                  <label className="form-label" htmlFor="createDisplayName">
                    Display name
                  </label>
                  <input
                    className="form-control sky-form-control"
                    id="createDisplayName"
                    onChange={(event) => updateCreateField('displayName', event.target.value)}
                    value={createForm.displayName}
                  />
                </div>
                <div className="col-md-4">
                  <label className="form-label" htmlFor="createPassword">
                    Temporary password
                  </label>
                  <input
                    className="form-control sky-form-control"
                    id="createPassword"
                    minLength={12}
                    onChange={(event) => updateCreateField('password', event.target.value)}
                    required
                    type="password"
                    value={createForm.password}
                  />
                  <div className="form-text sky-muted">Minimum 12 characters.</div>
                </div>
                <div className="col-md-3">
                  <label className="form-label" htmlFor="createStatus">
                    Status
                  </label>
                  <select
                    className="form-select sky-form-control"
                    id="createStatus"
                    onChange={(event) => updateCreateField('status', event.target.value)}
                    value={createForm.status}
                  >
                    {USER_STATUSES.map((status) => (
                      <option key={status} value={status}>
                        {status}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="col-md-5">
                  <label className="form-label" htmlFor="createRoles">
                    SkyCommand Admin roles
                  </label>
                  <select
                    className="form-select sky-form-control"
                    id="createRoles"
                    multiple
                    onChange={(event) =>
                      updateCreateField('roleCodes', getSelectedCodesFromEvent(event))
                    }
                    value={createForm.roleCodes}
                  >
                    {activeRoles.map((role) => (
                      <option key={role.roleCode} value={role.roleCode}>
                        {role.roleCode} · {role.roleName}
                      </option>
                    ))}
                  </select>
                  <div className="form-text sky-muted">Hold Ctrl/Cmd to select multiple roles.</div>
                </div>
              </div>

              <div className="mt-3">
                <button className="btn sky-btn-primary" disabled={saving} type="submit">
                  {saving ? 'Creating...' : 'Create account'}
                </button>
              </div>
            </form>
          </div>
        </section>
      )}

      <section className="sky-card mb-3">
        <div className="sky-card-body">
          <form className="row g-3 align-items-end" onSubmit={handleApplyFilters}>
            <div className="col-lg-4 col-md-6">
              <label className="form-label" htmlFor="userSearch">
                Search
              </label>
              <input
                className="form-control sky-form-control"
                id="userSearch"
                onChange={(event) => updateFilter('q', event.target.value)}
                placeholder="Email, username, display name..."
                value={filters.q}
              />
            </div>
            <div className="col-lg-2 col-md-3">
              <label className="form-label" htmlFor="userStatusFilter">
                Status
              </label>
              <select
                className="form-select sky-form-control"
                id="userStatusFilter"
                onChange={(event) => updateFilter('status', event.target.value)}
                value={filters.status}
              >
                <option value="">All</option>
                {USER_STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {status}
                  </option>
                ))}
              </select>
            </div>
            <div className="col-lg-3 col-md-3">
              <label className="form-label" htmlFor="userAppFilter">
                Application access
              </label>
              <select
                className="form-select sky-form-control"
                id="userAppFilter"
                onChange={(event) => updateFilter('appCode', event.target.value)}
                value={filters.appCode}
              >
                <option value="">All applications</option>
                {applications.map((application) => (
                  <option key={application.appCode} value={application.appCode}>
                    {application.title}
                  </option>
                ))}
              </select>
            </div>
            <div className="col-lg-1 col-md-3">
              <label className="form-label" htmlFor="userLimit">
                Limit
              </label>
              <select
                className="form-select sky-form-control"
                id="userLimit"
                onChange={(event) => updateFilter('limit', event.target.value)}
                value={filters.limit}
              >
                <option value="25">25</option>
                <option value="50">50</option>
                <option value="100">100</option>
              </select>
            </div>
            <div className="col-lg-2 col-md-3 d-grid">
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
                <div className="mt-3">Loading users...</div>
              </div>
            ) : users.length === 0 ? (
              <div className="sky-empty-state">No users matched the current filters.</div>
            ) : (
              <div className="table-responsive">
                <table className="table table-hover sky-table">
                  <thead>
                    <tr>
                      <th>User</th>
                      <th>Status</th>
                      <th>System</th>
                      <th>Last login</th>
                    </tr>
                  </thead>
                  <tbody>
                    {users.map((item) => (
                      <tr
                        className={`sky-clickable-row ${
                          selectedUserId === item.userId ? 'sky-selected-row' : ''
                        }`}
                        key={item.userId}
                        onClick={() => setSelectedUserId(item.userId)}
                      >
                        <td>
                          <div className="fw-bold sky-detail-value">
                            {item.displayName || item.username || item.email}
                          </div>
                          <div className="small sky-muted">{item.email}</div>
                        </td>
                        <td>
                          <span className={`sky-pill ${statusClass(item.status)}`}>
                            {item.status}
                          </span>
                        </td>
                        <td>{item.isSystemUser ? 'Yes' : 'No'}</td>
                        <td>{formatDate(item.lastLoginAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
          <div className="small sky-muted mt-2">
            Showing {users.length} of {total}
          </div>
        </div>

        <div className="col-xl-5">
          <section className="sky-card">
            <div className="sky-card-header">
              <h2 className="h5 mb-0">User detail</h2>
            </div>
            <div className="sky-card-body">
              {detailLoading ? (
                <div className="sky-empty-state">Loading user detail...</div>
              ) : selectedUser ? (
                <>
                  <div className="d-flex flex-wrap align-items-center gap-2 mb-3">
                    <span className={`sky-pill ${statusClass(selectedUser.status)}`}>
                      {selectedUser.status}
                    </span>
                    {selectedUser.isSystemUser && <span className="sky-pill">System user</span>}
                    <span className="sky-pill sky-pill-info">
                      {selectedPermissions.length} permission
                      {selectedPermissions.length === 1 ? '' : 's'}
                    </span>
                    <span className="sky-pill sky-pill-info">
                      {applicationAccessCount(applicationForm)} app
                      {applicationAccessCount(applicationForm) === 1 ? '' : 's'} active
                    </span>
                  </div>

                  <form onSubmit={handleSaveProfile}>
                    <div className="row g-3">
                      <div className="col-md-12">
                        <label className="form-label" htmlFor="editEmail">
                          Email
                        </label>
                        <input
                          className="form-control sky-form-control"
                          disabled={!canWriteUsers || saving}
                          id="editEmail"
                          onChange={(event) => updateEditField('email', event.target.value)}
                          required
                          type="email"
                          value={editForm.email}
                        />
                      </div>
                      <div className="col-md-6">
                        <label className="form-label" htmlFor="editUsername">
                          Username
                        </label>
                        <input
                          className="form-control sky-form-control"
                          disabled={!canWriteUsers || saving}
                          id="editUsername"
                          onChange={(event) => updateEditField('username', event.target.value)}
                          value={editForm.username}
                        />
                      </div>
                      <div className="col-md-6">
                        <label className="form-label" htmlFor="editDisplayName">
                          Display name
                        </label>
                        <input
                          className="form-control sky-form-control"
                          disabled={!canWriteUsers || saving}
                          id="editDisplayName"
                          onChange={(event) => updateEditField('displayName', event.target.value)}
                          value={editForm.displayName}
                        />
                      </div>
                    </div>

                    {canWriteUsers && (
                      <button className="btn sky-btn-primary mt-3" disabled={saving} type="submit">
                        Save profile
                      </button>
                    )}
                  </form>

                  <hr className="border-secondary my-4" />

                  <div className="row g-3 align-items-end">
                    <div className="col-md-7">
                      <label className="form-label" htmlFor="editStatus">
                        Account status
                      </label>
                      <select
                        className="form-select sky-form-control"
                        disabled={!canWriteUsers || selectedIsCurrentUser || saving}
                        id="editStatus"
                        onChange={(event) => updateEditField('status', event.target.value)}
                        value={editForm.status}
                      >
                        {USER_STATUSES.map((status) => (
                          <option key={status} value={status}>
                            {status}
                          </option>
                        ))}
                      </select>
                      {selectedIsCurrentUser && (
                        <div className="form-text sky-muted">Self-status changes are blocked.</div>
                      )}
                    </div>
                    {canWriteUsers && (
                      <div className="col-md-5 d-grid">
                        <button
                          className="btn sky-btn-ghost"
                          disabled={selectedIsCurrentUser || saving}
                          onClick={handleSaveStatus}
                          type="button"
                        >
                          Save status
                        </button>
                      </div>
                    )}
                  </div>

                  <hr className="border-secondary my-4" />

                  <div>
                    <div className="d-flex flex-wrap justify-content-between gap-2 mb-3">
                      <div>
                        <div className="sky-detail-label">Application access</div>
                        <div className="small sky-muted">
                          Shared identity, separate keys. Grant SkyWeb without granting Admin-Web.
                        </div>
                      </div>
                      {selectedIsCurrentUser && (
                        <span className="sky-pill sky-pill-warning">
                          Self access changes blocked
                        </span>
                      )}
                    </div>

                    <div className="sky-app-access-list">
                      {applicationForm.map((application) => {
                        const enabled = application.status === 'ACTIVE';

                        return (
                          <div className="sky-app-access-card" key={application.appCode}>
                            <div className="d-flex flex-wrap align-items-start justify-content-between gap-2">
                              <div>
                                <div className="fw-bold sky-detail-value">{application.title}</div>
                                <div className="small sky-mono sky-muted">
                                  {application.appCode}
                                </div>
                                {application.description && (
                                  <div className="small sky-muted mt-1">
                                    {application.description}
                                  </div>
                                )}
                              </div>
                              <span
                                className={`sky-pill ${membershipStatusClass(application.status)}`}
                              >
                                {application.status}
                              </span>
                            </div>

                            <div className="form-check form-switch mt-3">
                              <input
                                checked={enabled}
                                className="form-check-input"
                                disabled={!canWriteUsers || selectedIsCurrentUser || saving}
                                id={`app-${application.appCode}`}
                                onChange={(event) =>
                                  updateApplicationStatus(application.appCode, event.target.checked)
                                }
                                type="checkbox"
                              />
                              <label
                                className="form-check-label sky-muted"
                                htmlFor={`app-${application.appCode}`}
                              >
                                Application membership
                              </label>
                            </div>

                            {application.roles.length > 0 && (
                              <div className="mt-3">
                                <div className="sky-detail-label mb-2">App roles</div>
                                <div className="sky-role-check-grid">
                                  {application.roles.map((role) => (
                                    <label className="sky-role-check" key={role.roleCode}>
                                      <input
                                        checked={application.roleCodes.includes(role.roleCode)}
                                        disabled={
                                          !canWriteUsers ||
                                          selectedIsCurrentUser ||
                                          saving ||
                                          !enabled
                                        }
                                        onChange={(event) =>
                                          updateApplicationRole(
                                            application.appCode,
                                            role.roleCode,
                                            event.target.checked,
                                          )
                                        }
                                        type="checkbox"
                                      />
                                      <span>
                                        <span className="fw-bold">{role.roleCode}</span>
                                        <span className="small sky-muted d-block">
                                          {role.roleName}
                                        </span>
                                      </span>
                                    </label>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>

                    {canWriteUsers && (
                      <button
                        className="btn sky-btn-ghost mt-3"
                        disabled={selectedIsCurrentUser || saving}
                        onClick={handleSaveApplications}
                        type="button"
                      >
                        Save application access
                      </button>
                    )}
                  </div>

                  <hr className="border-secondary my-4" />

                  <div>
                    <label className="form-label" htmlFor="editRoles">
                      SkyCommand Admin role assignments
                    </label>
                    <select
                      className="form-select sky-form-control"
                      disabled={!canWriteRoles || selectedIsCurrentUser || saving}
                      id="editRoles"
                      multiple
                      onChange={(event) =>
                        updateEditField('roleCodes', getSelectedCodesFromEvent(event))
                      }
                      value={editForm.roleCodes}
                    >
                      {activeRoles.map((role) => (
                        <option key={role.roleCode} value={role.roleCode}>
                          {role.roleCode} · {role.roleName}
                        </option>
                      ))}
                    </select>
                    <div className="form-text sky-muted">
                      Hold Ctrl/Cmd to select multiple roles. Self role changes are blocked.
                    </div>
                    {canWriteRoles && (
                      <button
                        className="btn sky-btn-ghost mt-3"
                        disabled={selectedIsCurrentUser || saving}
                        onClick={handleSaveRoles}
                        type="button"
                      >
                        Save roles
                      </button>
                    )}
                  </div>

                  {canWriteUsers && (
                    <>
                      <hr className="border-secondary my-4" />

                      <form onSubmit={handleResetPassword}>
                        <label className="form-label" htmlFor="resetPassword">
                          Reset password
                        </label>
                        <input
                          className="form-control sky-form-control"
                          id="resetPassword"
                          minLength={12}
                          onChange={(event) =>
                            setPasswordForm((currentForm) => ({
                              ...currentForm,
                              password: event.target.value,
                            }))
                          }
                          placeholder="New temporary password"
                          required
                          type="password"
                          value={passwordForm.password}
                        />
                        <div className="form-check form-switch mt-2">
                          <input
                            checked={passwordForm.revokeSessions}
                            className="form-check-input"
                            id="revokeSessionsOnReset"
                            onChange={(event) =>
                              setPasswordForm((currentForm) => ({
                                ...currentForm,
                                revokeSessions: event.target.checked,
                              }))
                            }
                            type="checkbox"
                          />
                          <label
                            className="form-check-label sky-muted"
                            htmlFor="revokeSessionsOnReset"
                          >
                            Revoke active sessions after reset
                          </label>
                        </div>
                        <button className="btn sky-btn-ghost mt-3" disabled={saving} type="submit">
                          Reset password
                        </button>
                      </form>
                    </>
                  )}

                  <hr className="border-secondary my-4" />

                  <div className="d-flex flex-wrap justify-content-between gap-2 mb-2">
                    <div>
                      <div className="sky-detail-label">Active sessions</div>
                      <div className="small sky-muted">{sessions.length} active session(s)</div>
                    </div>
                    {canWriteUsers && (
                      <button
                        className="btn btn-sm sky-btn-ghost"
                        disabled={selectedIsCurrentUser || saving || sessions.length === 0}
                        onClick={handleRevokeSessions}
                        type="button"
                      >
                        Revoke sessions
                      </button>
                    )}
                  </div>

                  {sessions.length > 0 ? (
                    <div className="table-responsive">
                      <table className="table sky-table">
                        <thead>
                          <tr>
                            <th>Last seen</th>
                            <th>Expires</th>
                          </tr>
                        </thead>
                        <tbody>
                          {sessions.map((session) => (
                            <tr key={session.sessionId}>
                              <td>{formatDate(session.lastSeenAt || session.createdAt)}</td>
                              <td>{formatDate(session.expiresAt)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <div className="sky-empty-state py-3">No active sessions.</div>
                  )}
                </>
              ) : (
                <div className="sky-empty-state">Select a user to inspect.</div>
              )}
            </div>
          </section>
        </div>
      </div>
    </>
  );
}

export default AdminUsers;
