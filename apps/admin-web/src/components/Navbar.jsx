import { useEffect, useMemo, useRef, useState } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import SidebarNav from './ui/SidebarNav.jsx';
import SkyCommandMark from './ui/SkyCommandMark.jsx';
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
  overview: '/dashboard',
  api: '/dashboard/api',
  'api dashboard': '/dashboard/api',
  'api observability': '/dashboard/api',
  'api telemetry': '/dashboard/api',
  'data pipeline': '/dashboard/data-pipeline',
  'data intelligence': '/data/intelligence',
  'data status': '/data/intelligence',
  freshness: '/data/intelligence',
  indicators: '/data/intelligence',
  pipeline: '/dashboard/data-pipeline',
  'tools dashboard': '/dashboard/tools',
  'workflows dashboard': '/dashboard/workflows',
  'automation dashboard': '/dashboard/automation',
  'production readiness': '/configuration/production-readiness',
  home: '/dashboard',
  pulse: '/dashboard',
  tools: '/tools/run',
  run: '/tools/run',
  executions: '/tools/executions',
  history: '/tools/executions',
  'manage tools': '/tools/manage',
  'add tool': '/tools/add',
  onboarding: '/tools/add',
  catalogue: '/tools/manage',
  workflows: '/workflows/start',
  workflow: '/workflows/start',
  worker: '/dashboard/automation',
  health: '/dashboard/automation',
  approvals: '/workflows/approvals',
  temporal: '/workflows/history?runtime=temporal',
  scheduler: '/automation/schedules/history',
  'scheduler history': '/automation/schedules/history',
  'manage schedules': '/automation/schedules/manage',
  'create schedule': '/automation/schedules/create',
  'worker history': '/automation/workers/history',
  listeners: '/automation/listeners',
  ingestion: '/dashboard/data-pipeline',
  data: '/dashboard/data-pipeline',
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

function formatTopbarCount(count) {
  if (count > 99) {
    return '99+';
  }

  if (count > 9) {
    return '9+';
  }

  return String(count);
}

function isEditableElement(element) {
  if (!element) {
    return false;
  }

  const tagName = element.tagName?.toLowerCase();
  return (
    tagName === 'input' ||
    tagName === 'textarea' ||
    tagName === 'select' ||
    element.isContentEditable
  );
}

function createNavGroups(hasPermission, hasRole) {
  const canViewTools =
    hasPermission('CORE_VIEW_TOOLS') ||
    hasPermission('SCRIPT_EXECUTION_READ') ||
    hasPermission('ADMIN_TOOL_READ') ||
    hasPermission('ADMIN_TOOL_WRITE');
  const canViewWorkflows =
    hasPermission('WORKFLOW_READ') ||
    hasPermission('TEMPORAL_WORKFLOW_READ') ||
    hasPermission('WORKFLOW_APPROVAL_READ');
  const canViewAutomation =
    hasPermission('WORKER_SCHEDULE_READ') ||
    hasPermission('WORKER_SCHEDULE_CREATE') ||
    hasPermission('WORKER_SCHEDULE_CHANGE') ||
    hasPermission('WORKER_ADMIN') ||
    hasPermission('WORKER_LISTENER_READ');
  const canViewData =
    hasPermission('INGESTION_VIEW_STATUS') || hasPermission('ADMIN_REPOSITORY_READ');
  const canViewReadiness = hasRole('SUPER_ADMIN');
  const canViewAccessControl =
    hasPermission('ADMIN_USER_READ') ||
    hasPermission('ADMIN_ROLE_READ') ||
    hasPermission('ADMIN_PERMISSION_READ') ||
    hasPermission('AUDIT_READ');

  return [
    {
      label: 'Dashboards',
      icon: '⌘',
      visible: true,
      items: [
        {
          label: 'Command Center',
          to: '/dashboard',
          icon: '◈',
          visible: true,
          description: 'Operational command surface',
        },
        {
          label: 'API',
          to: '/dashboard/api',
          icon: '↯',
          visible: hasPermission('API_TELEMETRY_READ'),
          description: 'Request observability',
        },
        {
          label: 'Data',
          to: '/dashboard/data-pipeline',
          icon: '⇣',
          visible: hasPermission('INGESTION_VIEW_STATUS'),
          description: 'Macro pipeline analytics',
        },
        {
          label: 'Tools',
          to: '/dashboard/tools',
          icon: '▣',
          visible: hasPermission('SCRIPT_EXECUTION_READ'),
          description: 'Execution analytics',
        },
        {
          label: 'Workflows',
          to: '/dashboard/workflows',
          icon: '◷',
          visible: hasPermission('WORKFLOW_READ'),
          description: 'Run analytics',
        },
        {
          label: 'Automation',
          to: '/dashboard/automation',
          icon: '◎',
          visible: hasPermission('WORKFLOW_READ'),
          description: 'Worker pulse',
        },
      ],
    },
    {
      label: 'Tools',
      icon: '◧',
      visible: canViewTools,
      items: [
        {
          label: 'Tool History',
          to: '/tools/executions',
          icon: '↺',
          visible: hasPermission('SCRIPT_EXECUTION_READ'),
          description: 'Tool run ledger',
        },
        {
          label: 'Run Tools',
          to: '/tools/run',
          icon: '▶',
          visible: hasPermission('CORE_VIEW_TOOLS'),
          description: 'Reusable primitives',
        },
        {
          label: 'Manage Tools',
          to: '/tools/manage',
          icon: '▧',
          visible: hasPermission('ADMIN_TOOL_READ'),
          description: 'Catalogue configuration',
        },
        {
          label: 'Add Tool',
          to: '/tools/add',
          icon: '+',
          visible: hasPermission('ADMIN_TOOL_WRITE'),
          description: 'Trusted onboarding',
        },
      ],
    },
    {
      label: 'Workflows',
      icon: '⟠',
      visible: canViewWorkflows,
      items: [
        {
          label: 'Workflow History',
          to: '/workflows/history',
          icon: '◷',
          visible: hasPermission('WORKFLOW_READ'),
          description: 'Runs and diagnostics',
        },
        {
          label: 'Start Workflow',
          to: '/workflows/start',
          icon: '▶',
          visible: hasPermission('WORKFLOW_READ'),
          description: 'Launch published flows',
        },
        {
          label: 'Manage Workflows',
          to: '/workflows/manage',
          icon: '▧',
          visible: hasPermission('WORKFLOW_CHANGE'),
          description: 'Drafts and versions',
        },
        {
          label: 'Create Workflow',
          to: '/workflows/create',
          icon: '+',
          visible: hasPermission('WORKFLOW_CREATE'),
          description: 'New process graph',
        },
        {
          label: 'Approval History',
          to: '/workflows/approvals',
          icon: '☑',
          visible: hasPermission('WORKFLOW_APPROVAL_READ'),
          description: 'Decision ledger',
        },
      ],
    },
    {
      label: 'Automation',
      icon: '◌',
      visible: canViewAutomation,
      items: [
        {
          label: 'Scheduler History',
          to: '/automation/schedules/history',
          icon: '↺',
          visible: hasPermission('WORKER_SCHEDULE_READ'),
          description: 'Execution ledger',
        },
        {
          label: 'Manage Schedules',
          to: '/automation/schedules/manage',
          icon: '▧',
          visible: hasPermission('WORKER_SCHEDULE_READ'),
          description: 'Timed configuration',
        },
        {
          label: 'Create Schedules',
          to: '/automation/schedules/create',
          icon: '+',
          visible: hasPermission('WORKER_SCHEDULE_CREATE'),
          description: 'New timed start',
        },
        {
          label: 'Worker History',
          to: '/automation/workers/history',
          icon: '◷',
          visible: hasPermission('WORKER_ADMIN'),
          description: 'Heartbeat ledger',
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
      icon: '◫',
      visible: canViewData,
      items: [
        {
          label: 'Data Intelligence',
          to: '/data/intelligence',
          icon: '◫',
          visible: hasPermission('INGESTION_VIEW_STATUS'),
          description: 'Indicator freshness',
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
    {
      label: 'Readiness',
      icon: '✓',
      visible: canViewReadiness,
      items: [
        {
          label: 'Production Readiness',
          to: '/configuration/production-readiness',
          icon: '✓',
          visible: hasRole('SUPER_ADMIN'),
          description: 'Pre-flight audit',
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
  const { hasPermission, hasRole, isAuthenticated, logout, refreshSession, user } = useAuth();
  const [passwordModalOpen, setPasswordModalOpen] = useState(false);
  const [passwordForm, setPasswordForm] = useState(DEFAULT_PASSWORD_FORM);
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [passwordError, setPasswordError] = useState('');
  const [passwordSuccess, setPasswordSuccess] = useState('');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [commandQuery, setCommandQuery] = useState('');
  const [topbarPanel, setTopbarPanel] = useState('');
  const [activeSearchIndex, setActiveSearchIndex] = useState(0);
  const topbarControlsRef = useRef(null);
  const commandSearchInputRef = useRef(null);

  const navGroups = useMemo(
    () => createNavGroups(hasPermission, hasRole),
    [hasPermission, hasRole],
  );
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
  const permittedRoutes = useMemo(
    () => new Set(commandSearchTargets.map((target) => target.to)),
    [commandSearchTargets],
  );
  const commandSearchMatches = useMemo(() => {
    const normalizedQuery = commandQuery.trim().toLowerCase();

    if (!normalizedQuery) {
      return commandSearchTargets.slice(0, 4);
    }

    return commandSearchTargets
      .filter((target) => {
        const haystack =
          `${target.group} ${target.label} ${target.description} ${target.to}`.toLowerCase();
        return haystack.includes(normalizedQuery);
      })
      .slice(0, 5);
  }, [commandQuery, commandSearchTargets]);

  const notificationItems = [
    permittedRoutes.has('/dashboard/automation') && {
      label: 'Worker health pulse',
      meta: 'Temporal pollers, worker heartbeat, and task queue status.',
      status: 'Live',
      to: '/dashboard/automation',
    },
    permittedRoutes.has('/workflows/approvals') && {
      label: 'Approval history',
      meta: 'Review recorded human approval checkpoints and decisions.',
      status: 'Ready',
      to: '/workflows/approvals',
    },
    permittedRoutes.has('/dashboard/data-pipeline') && {
      label: 'Pipeline freshness',
      meta: 'Inspect stale indicators and macro ingestion health.',
      status: 'Watch',
      to: '/dashboard/data-pipeline',
    },
  ].filter(Boolean);

  const messageItems = [
    permittedRoutes.has('/workflows/approvals') && {
      label: 'Approval records',
      meta: 'Inspect approval requests, decision makers, roles, and outcomes.',
      status: 'Open',
      to: '/workflows/approvals',
    },
    permittedRoutes.has('/workflows/history') && {
      label: 'Workflow run notes',
      meta: 'Inspect completed, failed, and terminated workflow runs.',
      status: 'Runs',
      to: '/workflows/history',
    },
    permittedRoutes.has('/access-control/user-history') && {
      label: 'Review user activity',
      meta: 'Open the audit trail while the message center is being wired in.',
      status: 'Audit',
      to: '/access-control/user-history',
    },
  ].filter(Boolean);

  useEffect(() => {
    setActiveSearchIndex(0);
  }, [commandQuery, commandSearchMatches.length]);

  useEffect(() => {
    setTopbarPanel('');
  }, [location.pathname]);

  useEffect(() => {
    function handlePointerDown(event) {
      if (!topbarPanel) {
        return;
      }

      if (topbarControlsRef.current?.contains(event.target)) {
        return;
      }

      setTopbarPanel('');
    }

    function handleGlobalKeyDown(event) {
      if (event.key === 'Escape') {
        setTopbarPanel('');
        commandSearchInputRef.current?.blur();
        return;
      }

      if (
        event.key === '/' &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.altKey &&
        !isEditableElement(document.activeElement)
      ) {
        event.preventDefault();
        commandSearchInputRef.current?.focus();
        setTopbarPanel('search');
      }
    }

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('touchstart', handlePointerDown);
    document.addEventListener('keydown', handleGlobalKeyDown);

    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('touchstart', handlePointerDown);
      document.removeEventListener('keydown', handleGlobalKeyDown);
    };
  }, [topbarPanel]);

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

  function navigateToCommandTarget(to) {
    if (!to) {
      return;
    }

    navigate(to);
    setCommandQuery('');
    setTopbarPanel('');
  }

  function toggleTopbarPanel(panel) {
    setTopbarPanel((current) => (current === panel ? '' : panel));
  }

  function handleCommandSearch(event) {
    event.preventDefault();

    const normalizedQuery = commandQuery.trim().toLowerCase();
    const selectedMatch = commandSearchMatches[activeSearchIndex];

    if (selectedMatch) {
      navigateToCommandTarget(selectedMatch.to);
      return;
    }

    if (!normalizedQuery) {
      navigateToCommandTarget('/dashboard');
      return;
    }

    const aliasRoute = COMMAND_SEARCH_ALIASES[normalizedQuery];
    if (aliasRoute) {
      navigateToCommandTarget(aliasRoute);
    }
  }

  function handleCommandSearchKeyDown(event) {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setTopbarPanel('search');
      setActiveSearchIndex((current) =>
        commandSearchMatches.length === 0
          ? 0
          : Math.min(current + 1, commandSearchMatches.length - 1),
      );
      return;
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setTopbarPanel('search');
      setActiveSearchIndex((current) => Math.max(current - 1, 0));
    }
  }

  function handleSidebarNavigate() {
    setSidebarOpen(false);
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;
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
      <nav className="sky-public-navbar">
        <NavLink className="sky-public-brand" to="/" aria-label="SkyCommand home">
          <SkyCommandMark />
          <span className="sky-public-brand-copy">
            <span className="sky-public-brand-title">SkyCommand</span>
            <span className="sky-public-brand-subtitle">Workflow Automation</span>
          </span>
        </NavLink>
      </nav>
    );
  }

  return (
    <>
      <SidebarNav
        navGroups={navGroups}
        onClose={() => setSidebarOpen(false)}
        onNavigate={handleSidebarNavigate}
        open={sidebarOpen}
      />

      {sidebarOpen && (
        <button
          aria-label="Close navigation overlay"
          className="sky-sidebar-scrim"
          onClick={() => setSidebarOpen(false)}
          type="button"
        />
      )}

      <header className="sky-topbar" ref={topbarControlsRef}>
        <div className="sky-topbar-left">
          <button
            aria-label="Open navigation"
            className="btn btn-sm sky-topbar-menu-button"
            onClick={() => setSidebarOpen(true)}
            type="button"
          >
            ☰
          </button>
        </div>

        <div className="sky-topbar-center">
          <form
            className="sky-topbar-command-search"
            onKeyDown={handleCommandSearchKeyDown}
            onSubmit={handleCommandSearch}
            role="search"
          >
            <NavIcon name="search" />
            <input
              aria-activedescendant={
                topbarPanel === 'search' && commandSearchMatches[activeSearchIndex]
                  ? `sky-command-search-result-${activeSearchIndex}`
                  : undefined
              }
              aria-autocomplete="list"
              aria-controls="sky-command-search-results"
              aria-expanded={topbarPanel === 'search'}
              aria-label="Search SkyCommand commands"
              onChange={(event) => {
                setCommandQuery(event.target.value);
                setTopbarPanel('search');
              }}
              onFocus={() => setTopbarPanel('search')}
              placeholder="Search tools, workflows, executions..."
              ref={commandSearchInputRef}
              role="combobox"
              type="search"
              value={commandQuery}
            />
            <span className="sky-command-search-key">/</span>
            {topbarPanel === 'search' && (
              <div className="sky-topbar-popover sky-command-search-popover">
                <div className="sky-topbar-popover-header">
                  <span>Command search</span>
                  <span>{commandSearchMatches.length} match(es)</span>
                </div>
                <div
                  className="sky-command-search-results"
                  id="sky-command-search-results"
                  role="listbox"
                >
                  {commandSearchMatches.length > 0 ? (
                    commandSearchMatches.map((target, index) => (
                      <button
                        aria-selected={activeSearchIndex === index}
                        className={`sky-command-search-result${activeSearchIndex === index ? ' is-active' : ''}`}
                        id={`sky-command-search-result-${index}`}
                        key={target.to}
                        onMouseDown={(event) => event.preventDefault()}
                        onMouseEnter={() => setActiveSearchIndex(index)}
                        onClick={() => navigateToCommandTarget(target.to)}
                        role="option"
                        type="button"
                      >
                        <span>
                          <strong>{target.label}</strong>
                          <small>
                            {target.group} · {target.description}
                          </small>
                        </span>
                        <span>Open</span>
                      </button>
                    ))
                  ) : (
                    <div className="sky-command-search-empty">No matching command found yet.</div>
                  )}
                </div>
              </div>
            )}
          </form>
        </div>

        <div className="sky-topbar-right">
          <div className="sky-topbar-action-wrap">
            <button
              aria-expanded={topbarPanel === 'notifications'}
              aria-label="Open notifications"
              className="sky-topbar-icon-button sky-topbar-icon-button-alert"
              onClick={() => toggleTopbarPanel('notifications')}
              title="Workflow and worker notifications"
              type="button"
            >
              <NavIcon name="bell" />
              {notificationItems.length > 0 && (
                <span className="sky-topbar-count-badge">
                  {formatTopbarCount(notificationItems.length)}
                </span>
              )}
            </button>
            {topbarPanel === 'notifications' && (
              <div className="sky-topbar-popover sky-action-popover" role="dialog">
                <div className="sky-topbar-popover-header">
                  <span>Notifications</span>
                  <span>{notificationItems.length} watch items</span>
                </div>
                <div className="sky-topbar-popover-list">
                  {notificationItems.map((item) => (
                    <button
                      className="sky-topbar-popover-item"
                      key={item.label}
                      onClick={() => navigateToCommandTarget(item.to)}
                      type="button"
                    >
                      <span>
                        <strong>{item.label}</strong>
                        <small>{item.meta}</small>
                      </span>
                      <span className="sky-topbar-popover-badge">{item.status}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="sky-topbar-action-wrap">
            <button
              aria-expanded={topbarPanel === 'messages'}
              aria-label="Open messages"
              className="sky-topbar-icon-button"
              onClick={() => toggleTopbarPanel('messages')}
              title="Messages and activity inbox"
              type="button"
            >
              <NavIcon name="mail" />
              {messageItems.length > 0 && (
                <span className="sky-topbar-count-badge sky-topbar-count-badge-muted">
                  {formatTopbarCount(messageItems.length)}
                </span>
              )}
            </button>
            {topbarPanel === 'messages' && (
              <div className="sky-topbar-popover sky-action-popover" role="dialog">
                <div className="sky-topbar-popover-header">
                  <span>Messages</span>
                  <span>Preview</span>
                </div>
                <div className="sky-topbar-popover-list">
                  {messageItems.map((item) => (
                    <button
                      className="sky-topbar-popover-item"
                      key={item.label}
                      onClick={() => navigateToCommandTarget(item.to)}
                      type="button"
                    >
                      <span>
                        <strong>{item.label}</strong>
                        <small>{item.meta}</small>
                      </span>
                      <span className="sky-topbar-popover-badge">{item.status}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="dropdown text-end">
            <button
              aria-expanded="false"
              aria-label="Open account menu"
              className="btn btn-sm sky-account-menu-button dropdown-toggle"
              data-bs-toggle="dropdown"
              onClick={() => setTopbarPanel('')}
              title={user?.displayName || user?.username || 'Account'}
              type="button"
            >
              <NavIcon name="user" />
            </button>
            <ul className="dropdown-menu dropdown-menu-dark dropdown-menu-end sky-navbar-dropdown">
              <li className="sky-navbar-user-summary">
                <strong>{user?.displayName || user?.username || 'SkyCommand user'}</strong>
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
