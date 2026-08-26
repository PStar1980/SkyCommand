import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import adminService from '../services/adminService';

import DismissibleAlert from '../components/ui/DismissibleAlert.jsx';
import { getNextSortState, sortItemsBySorts } from '../utils/tableSorting.js';
const USER_STATUSES = ['ACTIVE', 'PENDING', 'LOCKED', 'DISABLED'];
const DEFAULT_ADMIN_APP_CODE = 'SKYSERVER_ADMIN';
const USER_PAGE_SIZE = 10;
const USER_FETCH_LIMIT = 200;
const USER_DEFAULT_SORTS = [{ field: 'user', direction: 'asc' }];
const DEFAULT_CREATE_FORM = {
  email: '',
  username: '',
  displayName: '',
  password: '',
  status: 'ACTIVE',
  roleCodes: ['VIEWER'],
};

function getInitialUserFilters(searchParams) {
  return {
    q: searchParams.get('q') || '',
    status: searchParams.get('status') || '',
    appCode: searchParams.get('appCode') || '',
    roleCode: searchParams.get('roleCode') || '',
  };
}

function formatDate(value) {
  if (!value) {
    return '—';
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

function getUserSortValue(user, field) {
  if (field === 'user') {
    return `${user?.displayName || ''} ${user?.username || ''} ${user?.email || ''}`.trim();
  }

  if (field === 'status') {
    const statusRank = { ACTIVE: 1, PENDING: 2, LOCKED: 3, DISABLED: 4 };
    return statusRank[String(user?.status || '').toUpperCase()] ?? 99;
  }

  if (field === 'system') {
    return user?.isSystemUser ? 1 : 0;
  }

  if (field === 'lastLogin') {
    if (!user?.lastLoginAt) {
      return null;
    }

    const timestamp = Date.parse(user.lastLoginAt);
    return Number.isFinite(timestamp) ? timestamp : null;
  }

  return user?.[field] ?? '';
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
  const [searchParams] = useSearchParams();
  const initialFilters = getInitialUserFilters(searchParams);
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
  const [filters, setFilters] = useState(() => initialFilters);
  const [total, setTotal] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [sorts, setSorts] = useState(() => USER_DEFAULT_SORTS);
  const [sortingCustomized, setSortingCustomized] = useState(false);
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
  const initialLoadCompleteRef = useRef(false);

  const activeRoles = useMemo(
    () =>
      roles.filter(
        (role) => role.active && (!role.appCode || role.appCode === DEFAULT_ADMIN_APP_CODE),
      ),
    [roles],
  );
  const filterRoles = useMemo(
    () =>
      roles.filter((role) => role.active && (!filters.appCode || role.appCode === filters.appCode)),
    [filters.appCode, roles],
  );
  const selectedIsCurrentUser = currentUser?.userId && selectedUser?.userId === currentUser.userId;
  const sortedUsers = useMemo(
    () => sortItemsBySorts(users, sorts, getUserSortValue),
    [sorts, users],
  );
  const pageCount = Math.max(1, Math.ceil(sortedUsers.length / USER_PAGE_SIZE));
  const safeCurrentPage = Math.min(currentPage, pageCount);
  const rangeStart = sortedUsers.length === 0 ? 0 : (safeCurrentPage - 1) * USER_PAGE_SIZE + 1;
  const rangeEnd = Math.min(safeCurrentPage * USER_PAGE_SIZE, sortedUsers.length);
  const visibleUsers = useMemo(
    () =>
      sortedUsers.slice(
        (safeCurrentPage - 1) * USER_PAGE_SIZE,
        safeCurrentPage * USER_PAGE_SIZE,
      ),
    [safeCurrentPage, sortedUsers],
  );

  async function loadRoles() {
    const result = await adminService.listRoles({ limit: 200 });
    setRoles(result.items || []);
  }

  async function fetchAllUsers(nextFilters = filters) {
    const items = [];
    let offset = 0;
    let totalCount = 0;

    while (true) {
      const result = await adminService.listUsers({
        ...nextFilters,
        limit: USER_FETCH_LIMIT,
        offset,
      });
      const batch = result.items || [];
      totalCount = Number(result.total || 0);
      items.push(...batch);

      if (batch.length === 0 || items.length >= totalCount || batch.length < USER_FETCH_LIMIT) {
        break;
      }

      offset += batch.length;
    }

    return { items, total: totalCount };
  }

  async function loadUsers(nextFilters = filters, preferredUserId = selectedUserId) {
    setLoading(true);
    setError('');

    try {
      const result = await fetchAllUsers(nextFilters);
      const nextUsers = result.items || [];
      const sortedNextUsers = sortItemsBySorts(nextUsers, sorts, getUserSortValue);

      setUsers(nextUsers);
      setTotal(result.total || nextUsers.length);

      if (nextUsers.length === 0) {
        setCurrentPage(1);
        setSelectedUserId('');
        setSelectedUser(null);
        setSelectedPermissions([]);
        setApplicationForm([]);
        setSessions([]);
        return;
      }

      const preferredVisible = nextUsers.some((item) => item.userId === preferredUserId);
      const resolvedUserId = preferredVisible
        ? preferredUserId
        : sortedNextUsers[0]?.userId || '';
      const selectedIndex = sortedNextUsers.findIndex((item) => item.userId === resolvedUserId);

      setSelectedUserId(resolvedUserId);
      setCurrentPage(selectedIndex >= 0 ? Math.floor(selectedIndex / USER_PAGE_SIZE) + 1 : 1);
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
          fetchAllUsers(filters),
        ]);

        if (!active) {
          return;
        }

        const nextUsers = usersResult.items || [];
        const sortedNextUsers = sortItemsBySorts(nextUsers, USER_DEFAULT_SORTS, getUserSortValue);

        setRoles(rolesResult.items || []);
        setApplications(applicationsResult.items || []);
        setUsers(nextUsers);
        setTotal(usersResult.total || nextUsers.length);
        setCurrentPage(1);
        setSelectedUserId(sortedNextUsers[0]?.userId || '');
      } catch (loadError) {
        if (active) {
          setError(loadError.message || 'Failed to load access-control data.');
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
    loadSelectedUser(selectedUserId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedUserId]);

  useEffect(() => {
    if (!initialLoadCompleteRef.current) {
      return undefined;
    }

    const timeoutId = window.setTimeout(() => {
      loadUsers(filters, '');
    }, 250);

    return () => window.clearTimeout(timeoutId);
    // loadUsers intentionally uses the filter snapshot from this render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.q, filters.status, filters.appCode, filters.roleCode]);

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

  function clearFilters() {
    setFilters({
      q: '',
      status: '',
      appCode: '',
      roleCode: '',
    });
    setCurrentPage(1);
  }

  function applySorting(nextSorts, customized) {
    const nextSortedUsers = sortItemsBySorts(users, nextSorts, getUserSortValue);
    const selectedIndex = selectedUserId
      ? nextSortedUsers.findIndex((item) => item.userId === selectedUserId)
      : -1;

    setSorts(nextSorts);
    setSortingCustomized(customized);
    setCurrentPage(selectedIndex >= 0 ? Math.floor(selectedIndex / USER_PAGE_SIZE) + 1 : 1);
  }

  function updateSorting(field, event) {
    const nextState = getNextSortState({
      sorts,
      defaultSorts: USER_DEFAULT_SORTS,
      sortingCustomized,
      field,
      shiftKey: Boolean(event?.shiftKey),
    });
    applySorting(nextState.sorts, nextState.customized);
  }

  function clearSorting() {
    applySorting(USER_DEFAULT_SORTS, false);
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
            <span className="sky-table-sort-priority" aria-hidden="true">
              {activeIndex + 1}
            </span>
          )}
        </button>
      </th>
    );
  }

  function goToPage(page) {
    const nextPage = Math.min(Math.max(1, Number(page) || 1), pageCount);
    const nextPageStart = (nextPage - 1) * USER_PAGE_SIZE;
    const nextUser = sortedUsers[nextPageStart] || null;

    setCurrentPage(nextPage);
    if (nextUser) {
      setSelectedUserId(nextUser.userId);
    }
  }

  function renderPagination() {
    return (
      <div className="sky-pagination-row sky-canonical-operations-pagination-row">
        <div className="small sky-muted sky-canonical-operations-pagination-summary">
          Showing {rangeStart}-{rangeEnd} of {total} user(s)
        </div>
        <div
          className="sky-pagination-controls sky-canonical-operations-pagination-controls"
          aria-label="Users pagination"
        >
          <button
            aria-label="First page"
            className="btn btn-sm sky-pagination-nav-button"
            disabled={safeCurrentPage <= 1 || loading}
            onClick={() => goToPage(1)}
            title="First page"
            type="button"
          >
            «
          </button>
          <button
            aria-label="Previous page"
            className="btn btn-sm sky-pagination-nav-button"
            disabled={safeCurrentPage <= 1 || loading}
            onClick={() => goToPage(safeCurrentPage - 1)}
            title="Previous page"
            type="button"
          >
            ‹
          </button>
          <label className="sky-pagination-select-label" htmlFor="usersPageSelect">
            Page
          </label>
          <select
            className="form-select form-select-sm sky-form-control sky-pagination-select"
            disabled={loading}
            id="usersPageSelect"
            onChange={(event) => goToPage(event.target.value)}
            value={safeCurrentPage}
          >
            {Array.from({ length: pageCount }, (_, index) => index + 1).map((page) => (
              <option key={page} value={page}>
                {page}
              </option>
            ))}
          </select>
          <span className="small sky-muted">of {pageCount}</span>
          <button
            aria-label="Next page"
            className="btn btn-sm sky-pagination-nav-button"
            disabled={safeCurrentPage >= pageCount || loading}
            onClick={() => goToPage(safeCurrentPage + 1)}
            title="Next page"
            type="button"
          >
            ›
          </button>
          <button
            aria-label="Last page"
            className="btn btn-sm sky-pagination-nav-button"
            disabled={safeCurrentPage >= pageCount || loading}
            onClick={() => goToPage(pageCount)}
            title="Last page"
            type="button"
          >
            »
          </button>
        </div>
        <div className="sky-canonical-operations-pagination-balance" aria-hidden="true" />
      </div>
    );
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

      {error && <DismissibleAlert tone="danger">{error}</DismissibleAlert>}
      {success && <DismissibleAlert tone="success">{success}</DismissibleAlert>}

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

      <section className="sky-card sky-functional-history-browser sky-admin-users-browser">
        <div className="sky-card-header">
          <div>
            <div className="sky-page-kicker">User browser</div>
            <h2 className="h5 mb-0">User directory</h2>
            <p className="sky-muted small mb-0">
              Search and filter shared identities, then select a row to manage the complete user
              workspace below.
            </p>
          </div>

          <div className="sky-run-tools-filter-grid">
            <div className="sky-run-tools-search-filter">
              <label className="form-label" htmlFor="userSearch">
                Search
              </label>
              <input
                className="form-control sky-form-control"
                id="userSearch"
                onChange={(event) => updateFilter('q', event.target.value)}
                placeholder="Email, username, display name..."
                type="search"
                value={filters.q}
              />
            </div>
            <div>
              <label className="form-label" htmlFor="userStatusFilter">
                Status
              </label>
              <select
                className="form-select sky-form-control"
                id="userStatusFilter"
                onChange={(event) => updateFilter('status', event.target.value)}
                value={filters.status}
              >
                <option value="">All statuses</option>
                {USER_STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {status}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="form-label" htmlFor="userAppFilter">
                Application access
              </label>
              <select
                className="form-select sky-form-control"
                id="userAppFilter"
                onChange={(event) =>
                  setFilters((current) => ({
                    ...current,
                    appCode: event.target.value,
                    roleCode: '',
                  }))
                }
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
            <div>
              <label className="form-label" htmlFor="userRoleFilter">
                Role
              </label>
              <select
                className="form-select sky-form-control"
                id="userRoleFilter"
                onChange={(event) => updateFilter('roleCode', event.target.value)}
                value={filters.roleCode}
              >
                <option value="">All roles</option>
                {filterRoles.map((role) => (
                  <option key={`${role.appCode || 'APP'}-${role.roleCode}`} value={role.roleCode}>
                    {role.roleCode} · {role.roleName}
                  </option>
                ))}
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
                {renderSortableHeader('User', 'user')}
                {renderSortableHeader('Status', 'status')}
                {renderSortableHeader('System', 'system')}
                {renderSortableHeader('Last login', 'lastLogin')}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan="4">
                    <div className="sky-empty-state py-4">
                      <div className="spinner-border text-info" role="status" aria-label="Loading" />
                    </div>
                  </td>
                </tr>
              ) : visibleUsers.length === 0 ? (
                <tr>
                  <td colSpan="4">
                    <div className="sky-empty-state py-4">No users match the current filters.</div>
                  </td>
                </tr>
              ) : (
                visibleUsers.map((item) => (
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
                      <span className={`sky-pill ${statusClass(item.status)}`}>{item.status}</span>
                    </td>
                    <td>{item.isSystemUser ? 'Yes' : 'No'}</td>
                    <td>{formatDate(item.lastLoginAt)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        {renderPagination()}
      </section>

      <section className="sky-card sky-admin-user-detail-card">
        <div className="sky-card-header d-flex flex-wrap align-items-start justify-content-between gap-3">
          <div>
            <div className="sky-page-kicker">User detail</div>
            <h2 className="h5 mb-1">
              {selectedUser
                ? selectedUser.displayName || selectedUser.username || selectedUser.email
                : 'Selected user workspace'}
            </h2>
            {selectedUser && <div className="small sky-muted">{selectedUser.email}</div>}
          </div>
          {selectedUser && (
            <div className="d-flex flex-wrap align-items-center gap-2">
              <span className={`sky-pill ${statusClass(selectedUser.status)}`}>
                {selectedUser.status}
              </span>
              {selectedUser.isSystemUser && <span className="sky-pill sky-pill-info">System user</span>}
              <span className="sky-pill sky-pill-info">
                {selectedPermissions.length} permission{selectedPermissions.length === 1 ? '' : 's'}
              </span>
              <span className="sky-pill sky-pill-info">
                {applicationAccessCount(applicationForm)} app
                {applicationAccessCount(applicationForm) === 1 ? '' : 's'} active
              </span>
            </div>
          )}
        </div>

        <div className="sky-card-body">
          {detailLoading ? (
            <div className="sky-empty-state py-5">Loading user detail...</div>
          ) : selectedUser ? (
            <div className="sky-admin-user-detail-stack">
              <section className="sky-admin-user-detail-section">
                <div className="sky-admin-user-detail-section-header">
                  <div>
                    <div className="sky-detail-label">Identity &amp; account</div>
                    <div className="small sky-muted">
                      Maintain the shared identity and account lifecycle state for this user.
                    </div>
                  </div>
                  {selectedIsCurrentUser && (
                    <span className="sky-pill sky-pill-warning">Self-protection enabled</span>
                  )}
                </div>

                <div className="sky-admin-user-identity-grid">
                  <form className="sky-admin-user-detail-pane" onSubmit={handleSaveProfile}>
                    <div className="sky-detail-label mb-3">Profile</div>
                    <div className="row g-3">
                      <div className="col-lg-6">
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
                      <div className="col-lg-3 col-md-6">
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
                      <div className="col-lg-3 col-md-6">
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

                  <div className="sky-admin-user-detail-pane">
                    <div className="sky-detail-label mb-3">Account status</div>
                    <div className="row g-3 align-items-end">
                      <div className="col-md-8">
                        <label className="form-label" htmlFor="editStatus">
                          Lifecycle state
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
                      </div>
                      {canWriteUsers && (
                        <div className="col-md-4 d-grid">
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
                    <div className="small sky-muted mt-3">
                      {selectedIsCurrentUser
                        ? 'Self-status changes are blocked to protect the active administrator session.'
                        : 'Use account status to lock, disable, reactivate, or stage the selected identity.'}
                    </div>
                  </div>
                </div>
              </section>

              <section className="sky-admin-user-detail-section">
                <div className="sky-admin-user-detail-section-header">
                  <div>
                    <div className="sky-detail-label">Access &amp; roles</div>
                    <div className="small sky-muted">
                      Control application memberships and SkyCommand administrative role assignments.
                    </div>
                  </div>
                  {selectedIsCurrentUser && (
                    <span className="sky-pill sky-pill-warning">Self access changes blocked</span>
                  )}
                </div>

                <div className="sky-admin-user-access-grid">
                  <div className="sky-admin-user-detail-pane">
                    <div className="d-flex flex-wrap justify-content-between gap-2 mb-3">
                      <div>
                        <div className="sky-detail-label">Application access</div>
                        <div className="small sky-muted">
                          Shared identity, separate keys. Grant an application without granting the others.
                        </div>
                      </div>
                    </div>

                    {applicationForm.length > 0 ? (
                      <div className="sky-app-access-list">
                        {applicationForm.map((application) => {
                          const enabled = application.status === 'ACTIVE';

                          return (
                            <div className="sky-app-access-card" key={application.appCode}>
                              <div className="d-flex flex-wrap align-items-start justify-content-between gap-2">
                                <div>
                                  <div className="fw-bold sky-detail-value">{application.title}</div>
                                  <div className="small sky-mono sky-muted">{application.appCode}</div>
                                  {application.description && (
                                    <div className="small sky-muted mt-1">{application.description}</div>
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
                    ) : (
                      <div className="sky-empty-state py-3">No application memberships available.</div>
                    )}

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

                  <div className="sky-admin-user-detail-pane">
                    <div className="sky-detail-label mb-3">SkyCommand Admin roles</div>
                    <label className="form-label" htmlFor="editRoles">
                      Role assignments
                    </label>
                    <select
                      className="form-select sky-form-control sky-admin-user-role-select"
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
                </div>
              </section>

              <section className="sky-admin-user-detail-section">
                <div className="sky-admin-user-detail-section-header">
                  <div>
                    <div className="sky-detail-label">Security &amp; sessions</div>
                    <div className="small sky-muted">
                      Reset credentials and inspect or revoke active sessions for the selected user.
                    </div>
                  </div>
                </div>

                <div className="sky-admin-user-security-grid">
                  <div className="sky-admin-user-detail-pane">
                    <div className="sky-detail-label mb-3">Password reset</div>
                    {canWriteUsers ? (
                      <form onSubmit={handleResetPassword}>
                        <label className="form-label" htmlFor="resetPassword">
                          New temporary password
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
                          placeholder="Minimum 12 characters"
                          required
                          type="password"
                          value={passwordForm.password}
                        />
                        <div className="form-check form-switch mt-3">
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
                    ) : (
                      <div className="small sky-muted">
                        Your current permissions do not allow password resets.
                      </div>
                    )}
                  </div>

                  <div className="sky-admin-user-detail-pane">
                    <div className="d-flex flex-wrap justify-content-between gap-2 mb-3">
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
                        <table className="table table-sm sky-table mb-0">
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
                  </div>
                </div>
              </section>
            </div>
          ) : (
            <div className="sky-empty-state py-5">Select a user to inspect.</div>
          )}
        </div>
      </section>
    </>
  );
}

export default AdminUsers;
