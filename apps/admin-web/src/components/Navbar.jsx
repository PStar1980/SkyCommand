import { useMemo, useState } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import SidebarNav from './ui/SidebarNav.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import authService from '../services/authService';

const DEFAULT_PASSWORD_FORM = {
  currentPassword: '',
  newPassword: '',
  confirmPassword: '',
  revokeOtherSessions: true,
};

const COMMAND_SEARCH_ALIASES = {
  dashboard: '/dashboard',
  home: '/dashboard',
  pulse: '/dashboard',
  tools: '/tools/run',
  run: '/tools/run',
  executions: '/tools/executions',
  history: '/tools/executions',
  workflows: '/workflows/start',
  workflow: '/workflows/start',
  worker: '/workflows/worker-health',
  health: '/workflows/worker-health',
  approvals: '/workflows/approvals',
  temporal: '/workflows/temporal/history',
  scheduler: '/automation/scheduler',
  listeners: '/automation/listeners',
  ingestion: '/data/ingestion',
  data: '/data/ingestion',
  readiness: '/configuration/production-readiness',
  repositories: '/configuration/repositories',
  repos: '/configuration/repositories',
  users: '/admin/users',
  sessions: '/admin/sessions',
  roles: '/admin/roles',
  privileges: '/admin/privileges',
  audit: '/access-control/user-history',
};

const ICON_PATHS = {
  search: 'M21 21l-4.35-4.35m1.35-5.4a6.75 6.75 0 11-13.5 0 6.75 6.75 0 0113.5 0z',
  bell: 'M15 17h5l-1.4-1.4a2 2 0 01-.6-1.42V11a6 6 0 10-12 0v3.18a2 2 0 01-.6 1.42L4 17h5m6 0a3 3 0 11-6 0',
  mail: 'M4 6h16v12H4V6zm0 0l8 6 8-6',
  spark: 'M12 3l1.85 5.15L19 10l-5.15 1.85L12 17l-1.85-5.15L5 10l5.15-1.85L12 3z',
  user: 'M20 21a8 8 0 10-16 0m8-10a4 4 0 100-8 4 4 0 000 8z',
};

function NavIcon({ name }) {
  return (
    <svg aria-hidden="true" className="sky-nav-icon" fill="none" viewBox="0 0 24 24">
      <path
        d={ICON_PATHS[name]}
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.9"
      />
    </svg>
  );
}

const PAGE_LABELS = {
  '/dashboard': 'Dashboard',
  '/tools/run': 'Run Tools',
  '/tools/executions': 'Tools History',
  '/workflows/create': 'Create Workflow',
  '/workflows/manage': 'Manage Workflows',
  '/workflows/start': 'Start Workflow',
  '/workflows/history': 'Workflow History',
  '/workflows/approvals': 'Approvals',
  '/workflows/worker-health': 'Worker Health',
  '/workflows/temporal/start': 'Temporal Start',
  '/workflows/temporal/history': 'Temporal History',
  '/automation/scheduler': 'Scheduler',
  '/automation/listeners': 'Listeners',
  '/data/ingestion': 'Ingestion Status',
  '/configuration/production-readiness': 'Production Readiness',
  '/configuration/repositories': 'Repositories',
  '/admin/users': 'Users',
  '/admin/sessions': 'Sessions',
  '/admin/roles': 'Roles',
  '/admin/privileges': 'Privileges',
  '/access-control/user-history': 'User History',
};

function getCurrentNavCrumb(navGroups, pathname) {
  for (const group of navGroups) {
    const matchedItem = group.items.find((item) => item.to === pathname);
    if (matchedItem) {
      return {
        group: group.label,
        label: matchedItem.label,
      };
    }
  }

  return {
    group: 'SkyServer Admin',
    label: PAGE_LABELS[pathname] || 'Dashboard',
  };
}

function createNavGroups(hasPermission) {
  const canViewTools = hasPermission('CORE_VIEW_TOOLS') || hasPermission('SCRIPT_EXECUTION_READ');
  const canViewWorkflows =
    hasPermission('WORKFLOW_READ') ||
    hasPermission('TEMPORAL_WORKFLOW_READ') ||
    hasPermission('WORKFLOW_APPROVAL_READ');
  const canViewAutomation =
    hasPermission('WORKER_SCHEDULE_READ') || hasPermission('WORKER_LISTENER_READ');
  const canViewData = hasPermission('INGESTION_VIEW_STATUS');
  const canViewConfiguration = hasPermission('ADMIN_REPOSITORY_READ');
  const canViewAccessControl =
    hasPermission('ADMIN_USER_READ') ||
    hasPermission('ADMIN_ROLE_READ') ||
    hasPermission('ADMIN_PERMISSION_READ') ||
    hasPermission('AUDIT_READ');

  return [
    {
      label: 'Command',
      icon: '⌘',
      visible: true,
      items: [
        {
          label: 'Dashboard',
          to: '/dashboard',
          icon: '◈',
          visible: true,
          description: 'Operational pulse',
        },
        {
          label: 'Worker Health',
          to: '/workflows/worker-health',
          icon: '●',
          visible: hasPermission('WORKFLOW_READ') || hasPermission('TEMPORAL_WORKFLOW_READ'),
          description: 'Task queue and pollers',
        },
      ],
    },
    {
      label: 'Tools',
      icon: '◧',
      visible: canViewTools,
      items: [
        {
          label: 'Run Tools',
          to: '/tools/run',
          icon: '▶',
          visible: hasPermission('CORE_VIEW_TOOLS'),
          description: 'Reusable primitives',
        },
        {
          label: 'Tools History',
          to: '/tools/executions',
          icon: '↺',
          visible: hasPermission('SCRIPT_EXECUTION_READ'),
          description: 'Tool run ledger',
        },
      ],
    },
    {
      label: 'Workflows',
      icon: '⟠',
      visible: canViewWorkflows,
      items: [
        {
          label: 'Start Workflow',
          to: '/workflows/start',
          icon: '▶',
          visible: hasPermission('WORKFLOW_READ'),
          description: 'Launch published flows',
        },
        {
          label: 'Workflow History',
          to: '/workflows/history',
          icon: '◷',
          visible: hasPermission('WORKFLOW_READ'),
          description: 'Runs and diagnostics',
        },
        {
          label: 'Manage Workflows',
          to: '/workflows/manage',
          icon: '▧',
          visible: hasPermission('WORKFLOW_WRITE'),
          description: 'Drafts and versions',
        },
        {
          label: 'Create Workflow',
          to: '/workflows/create',
          icon: '+',
          visible: hasPermission('WORKFLOW_WRITE'),
          description: 'New process graph',
        },
        {
          label: 'Approvals',
          to: '/workflows/approvals',
          icon: '☑',
          visible: hasPermission('WORKFLOW_APPROVAL_READ'),
          description: 'Human gates',
        },
        {
          label: 'Temporal History',
          to: '/workflows/temporal/history',
          icon: 'T',
          visible: hasPermission('TEMPORAL_WORKFLOW_READ'),
          description: 'Native Temporal view',
        },
      ],
    },
    {
      label: 'Automation',
      icon: '◌',
      visible: canViewAutomation,
      items: [
        {
          label: 'Scheduler',
          to: '/automation/scheduler',
          icon: '◴',
          visible: hasPermission('WORKER_SCHEDULE_READ'),
          description: 'Timed starts',
        },
        {
          label: 'Listeners',
          to: '/automation/listeners',
          icon: '◎',
          visible: hasPermission('WORKER_LISTENER_READ'),
          description: 'Event watchers',
        },
      ],
    },
    {
      label: 'Data',
      icon: '▦',
      visible: canViewData,
      items: [
        {
          label: 'Ingestion Status',
          to: '/data/ingestion',
          icon: '⇣',
          visible: hasPermission('INGESTION_VIEW_STATUS'),
          description: 'Macro sources',
        },
      ],
    },
    {
      label: 'Configuration',
      icon: '⚙',
      visible: canViewConfiguration,
      items: [
        {
          label: 'Production Readiness',
          to: '/configuration/production-readiness',
          icon: '✓',
          visible: hasPermission('ADMIN_REPOSITORY_READ'),
          description: 'Pre-flight audit',
        },
        {
          label: 'Repositories',
          to: '/configuration/repositories',
          icon: '▣',
          visible: hasPermission('ADMIN_REPOSITORY_READ'),
          description: 'Repo paths',
        },
      ],
    },
    {
      label: 'Access Control',
      icon: '◉',
      visible: canViewAccessControl,
      items: [
        {
          label: 'Users',
          to: '/admin/users',
          icon: 'U',
          visible: hasPermission('ADMIN_USER_READ'),
          description: 'Identities',
        },
        {
          label: 'Sessions',
          to: '/admin/sessions',
          icon: 'S',
          visible: hasPermission('ADMIN_USER_READ'),
          description: 'Active access',
        },
        {
          label: 'Roles',
          to: '/admin/roles',
          icon: 'R',
          visible: hasPermission('ADMIN_ROLE_READ'),
          description: 'Role grants',
        },
        {
          label: 'Privileges',
          to: '/admin/privileges',
          icon: 'P',
          visible: hasPermission('ADMIN_PERMISSION_READ'),
          description: 'Permission catalog',
        },
        {
          label: 'User History',
          to: '/access-control/user-history',
          icon: '↯',
          visible: hasPermission('AUDIT_READ'),
          description: 'Audit trail',
        },
      ],
    },
  ]
    .filter((group) => group.visible)
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => item.visible),
    }))
    .filter((group) => group.items.length > 0);
}

function Navbar() {
  const navigate = useNavigate();
  const location = useLocation();
  const { hasPermission, isAuthenticated, logout, refreshSession, user } = useAuth();
  const [passwordModalOpen, setPasswordModalOpen] = useState(false);
  const [passwordForm, setPasswordForm] = useState(DEFAULT_PASSWORD_FORM);
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [passwordError, setPasswordError] = useState('');
  const [passwordSuccess, setPasswordSuccess] = useState('');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [commandQuery, setCommandQuery] = useState('');

  const navGroups = useMemo(() => createNavGroups(hasPermission), [hasPermission]);
  const commandSearchTargets = useMemo(
    () =>
      navGroups.flatMap((group) =>
        group.items.map((item) => ({
          label: item.label,
          description: item.description,
          group: group.label,
          to: item.to,
        })),
      ),
    [navGroups],
  );
  const currentNavCrumb = useMemo(
    () => getCurrentNavCrumb(navGroups, location.pathname),
    [navGroups, location.pathname],
  );

  function openPasswordModal() {
    setPasswordForm(DEFAULT_PASSWORD_FORM);
    setPasswordError('');
    setPasswordSuccess('');
    setPasswordModalOpen(true);
  }

  function closePasswordModal() {
    if (passwordSaving) {
      return;
    }

    setPasswordModalOpen(false);
    setPasswordForm(DEFAULT_PASSWORD_FORM);
    setPasswordError('');
    setPasswordSuccess('');
  }

  function handleCommandSearch(event) {
    event.preventDefault();

    const normalizedQuery = commandQuery.trim().toLowerCase();
    if (!normalizedQuery) {
      navigate('/dashboard');
      return;
    }

    const aliasRoute = COMMAND_SEARCH_ALIASES[normalizedQuery];
    if (aliasRoute) {
      navigate(aliasRoute);
      setCommandQuery('');
      return;
    }

    const match = commandSearchTargets.find((target) => {
      const haystack =
        `${target.group} ${target.label} ${target.description} ${target.to}`.toLowerCase();
      return haystack.includes(normalizedQuery);
    });

    if (match) {
      navigate(match.to);
      setCommandQuery('');
    }
  }

  async function handleLogout() {
    await logout();
    navigate('/login', { replace: true });
  }

  async function handlePasswordSubmit(event) {
    event.preventDefault();
    setPasswordSaving(true);
    setPasswordError('');
    setPasswordSuccess('');

    try {
      const result = await authService.changePassword(passwordForm);
      setPasswordForm(DEFAULT_PASSWORD_FORM);
      setPasswordSuccess(
        result.revokedOtherSessionsCount > 0
          ? `Password changed. Revoked ${result.revokedOtherSessionsCount} other active session(s).`
          : 'Password changed successfully.',
      );
      await refreshSession();
    } catch (error) {
      setPasswordError(error.message || 'Failed to change password.');
    } finally {
      setPasswordSaving(false);
    }
  }

  if (!isAuthenticated) {
    return (
      <>
        <nav className="sky-public-navbar">
          <NavLink className="sky-public-brand" to="/">
            <span className="sky-brand-mark">⌁</span>
            <span>SkyServer Admin</span>
          </NavLink>
          <NavLink className="btn btn-sm sky-btn-primary" to="/login">
            Login
          </NavLink>
        </nav>
      </>
    );
  }

  return (
    <>
      <SidebarNav
        navGroups={navGroups}
        onClose={() => setSidebarOpen(false)}
        onNavigate={() => setSidebarOpen(false)}
        open={sidebarOpen}
        user={user}
      />

      {sidebarOpen && (
        <button
          aria-label="Close navigation overlay"
          className="sky-sidebar-scrim"
          onClick={() => setSidebarOpen(false)}
          type="button"
        />
      )}

      <header className="sky-topbar">
        <div className="sky-topbar-left">
          <button
            aria-label="Open navigation"
            className="btn btn-sm sky-topbar-menu-button"
            onClick={() => setSidebarOpen(true)}
            type="button"
          >
            ☰
          </button>
          <div className="sky-topbar-breadcrumb" aria-label="Current page location">
            <span className="sky-topbar-breadcrumb-group">{currentNavCrumb.group}</span>
            <span className="sky-topbar-breadcrumb-separator">›</span>
            <span className="sky-topbar-breadcrumb-page">{currentNavCrumb.label}</span>
          </div>
        </div>

        <div className="sky-topbar-right">
          <form className="sky-topbar-command-search" onSubmit={handleCommandSearch} role="search">
            <NavIcon name="search" />
            <input
              aria-label="Search SkyServer commands"
              onChange={(event) => setCommandQuery(event.target.value)}
              placeholder="Search tools, workflows, executions..."
              type="search"
              value={commandQuery}
            />
            <span className="sky-command-search-key">/</span>
          </form>

          <button
            aria-label="Open notifications"
            className="sky-topbar-icon-button sky-topbar-icon-button-alert"
            onClick={() => navigate('/workflows/worker-health')}
            title="Workflow and worker notifications"
            type="button"
          >
            <NavIcon name="bell" />
            <span className="sky-topbar-alert-dot" />
          </button>

          <button
            aria-label="Open messages"
            className="sky-topbar-icon-button"
            onClick={() => navigate('/access-control/user-history')}
            title="Messages and activity inbox coming soon"
            type="button"
          >
            <NavIcon name="mail" />
          </button>

          <div className="dropdown text-end">
            <button
              aria-expanded="false"
              aria-label="Open account menu"
              className="btn btn-sm sky-account-menu-button dropdown-toggle"
              data-bs-toggle="dropdown"
              title={user?.displayName || user?.username || 'Account'}
              type="button"
            >
              <NavIcon name="user" />
            </button>
            <ul className="dropdown-menu dropdown-menu-dark dropdown-menu-end sky-navbar-dropdown">
              <li className="sky-navbar-user-summary">
                <strong>{user?.displayName || user?.username || 'SkyServer user'}</strong>
                {user?.email && <span>{user.email}</span>}
              </li>
              <li>
                <hr className="dropdown-divider" />
              </li>
              <li>
                <button className="dropdown-item" onClick={openPasswordModal} type="button">
                  Change password
                </button>
              </li>
              <li>
                <hr className="dropdown-divider" />
              </li>
              <li>
                <button className="dropdown-item" onClick={handleLogout} type="button">
                  Logout
                </button>
              </li>
            </ul>
          </div>
        </div>
      </header>

      {passwordModalOpen && (
        <div className="sky-modal-backdrop" role="presentation">
          <div
            aria-modal="true"
            className="sky-modal-card"
            role="dialog"
            aria-labelledby="changePasswordTitle"
          >
            <div className="sky-modal-header">
              <div>
                <div className="sky-page-kicker">Account security</div>
                <h2 className="h5 mb-0" id="changePasswordTitle">
                  Change password
                </h2>
              </div>
              <button
                aria-label="Close"
                className="btn btn-sm sky-btn-ghost"
                disabled={passwordSaving}
                onClick={closePasswordModal}
                type="button"
              >
                Close
              </button>
            </div>

            <form className="sky-card-body" onSubmit={handlePasswordSubmit}>
              {passwordError && <div className="alert alert-danger">{passwordError}</div>}
              {passwordSuccess && <div className="alert alert-success">{passwordSuccess}</div>}

              <div className="mb-3">
                <label className="form-label sky-form-label" htmlFor="currentPassword">
                  Current password
                </label>
                <input
                  className="form-control sky-form-control"
                  id="currentPassword"
                  minLength={1}
                  onChange={(event) =>
                    setPasswordForm((current) => ({
                      ...current,
                      currentPassword: event.target.value,
                    }))
                  }
                  required
                  type="password"
                  value={passwordForm.currentPassword}
                />
              </div>

              <div className="mb-3">
                <label className="form-label sky-form-label" htmlFor="newPassword">
                  New password
                </label>
                <input
                  className="form-control sky-form-control"
                  id="newPassword"
                  minLength={12}
                  onChange={(event) =>
                    setPasswordForm((current) => ({
                      ...current,
                      newPassword: event.target.value,
                    }))
                  }
                  required
                  type="password"
                  value={passwordForm.newPassword}
                />
                <div className="small sky-muted mt-1">Minimum 12 characters.</div>
              </div>

              <div className="mb-3">
                <label className="form-label sky-form-label" htmlFor="confirmPassword">
                  Confirm new password
                </label>
                <input
                  className="form-control sky-form-control"
                  id="confirmPassword"
                  minLength={12}
                  onChange={(event) =>
                    setPasswordForm((current) => ({
                      ...current,
                      confirmPassword: event.target.value,
                    }))
                  }
                  required
                  type="password"
                  value={passwordForm.confirmPassword}
                />
              </div>

              <div className="form-check form-switch mb-4">
                <input
                  checked={passwordForm.revokeOtherSessions}
                  className="form-check-input"
                  id="revokeOtherSessions"
                  onChange={(event) =>
                    setPasswordForm((current) => ({
                      ...current,
                      revokeOtherSessions: event.target.checked,
                    }))
                  }
                  type="checkbox"
                />
                <label className="form-check-label sky-muted" htmlFor="revokeOtherSessions">
                  Revoke other active sessions after password change
                </label>
              </div>

              <div className="d-flex justify-content-end gap-2">
                <button
                  className="btn sky-btn-ghost"
                  disabled={passwordSaving}
                  onClick={closePasswordModal}
                  type="button"
                >
                  Cancel
                </button>
                <button className="btn sky-btn-primary" disabled={passwordSaving} type="submit">
                  {passwordSaving ? 'Changing...' : 'Change password'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}

export default Navbar;
