import { useEffect, useMemo, useRef, useState } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import SidebarNav from './ui/SidebarNav.jsx';
import SkyCommandMark from './ui/SkyCommandMark.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import authService from '../services/authService';
import notificationService from '../services/notificationService.js';

import DismissibleAlert from './ui/DismissibleAlert.jsx';
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
  repository: '/git-repositories/manage',
  repositories: '/git-repositories/manage',
  repos: '/git-repositories/manage',
  'git repositories': '/git-repositories/manage',
  'manage repositories': '/git-repositories/manage',
  'add repository': '/git-repositories/add',
  docker: '/dashboard/docker',
  'docker overview': '/dashboard/docker',
  'docker dashboard': '/dashboard/docker',
  compose: '/docker/projects',
  projects: '/docker/projects',
  'compose projects': '/docker/projects',
  containers: '/docker/containers',
  images: '/docker/images',
  volumes: '/docker/storage',
  storage: '/docker/storage',
  networks: '/docker/networks',
  'storage and networks': '/docker/storage',
  'docker operations': '/docker/operations',
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

function formatNotificationTime(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const deltaMs = Date.now() - date.getTime();
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;

  if (deltaMs < minute) return 'Now';
  if (deltaMs < hour) return `${Math.max(1, Math.floor(deltaMs / minute))}m`;
  if (deltaMs < day) return `${Math.floor(deltaMs / hour)}h`;
  if (deltaMs < 7 * day) return `${Math.floor(deltaMs / day)}d`;

  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(date);
}

function getNotificationTypeLabel(item = {}) {
  if (item.notificationType === 'APPROVAL_REQUIRED') return 'Approval';
  if (item.notificationType === 'TOOL_RUN_FAILED') return 'Tool';
  if (item.notificationType === 'WORKFLOW_RUN_FAILED') return 'Workflow';
  return 'Notification';
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
  const canViewData = hasPermission('INGESTION_VIEW_STATUS');
  const canViewRepositories =
    hasPermission('ADMIN_REPOSITORY_READ') || hasPermission('ADMIN_REPOSITORY_WRITE');
  const canViewDocker = hasPermission('INFRASTRUCTURE_DOCKER_READ');
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
        {
          label: 'Data',
          to: '/dashboard/data-pipeline',
          icon: '⇣',
          visible: hasPermission('INGESTION_VIEW_STATUS'),
          description: 'Macro pipeline analytics',
        },
        {
          label: 'API',
          to: '/dashboard/api',
          icon: '↯',
          visible: hasPermission('API_TELEMETRY_READ'),
          description: 'Request observability',
        },
        {
          label: 'Docker',
          to: '/dashboard/docker',
          icon: '⬡',
          visible: canViewDocker,
          description: 'Infrastructure observability',
        },
      ],
    },
    {
      label: 'Tools',
      icon: '◧',
      visible: canViewTools,
      items: [
        {
          label: 'Tool Operations',
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
          label: 'Workflow Operations',
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
          label: 'Scheduler Operations',
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
          label: 'Worker Operations',
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
          label: 'Ingestion Operations',
          to: '/data/operations',
          icon: '↺',
          visible: hasPermission('INGESTION_VIEW_STATUS'),
          description: 'Runs, evidence, recovery',
        },
        {
          label: 'Indicators',
          to: '/data/intelligence',
          icon: '◫',
          visible: hasPermission('INGESTION_VIEW_STATUS'),
          description: 'Indicator freshness',
        },
      ],
    },
    {
      label: 'Git Repositories',
      icon: '▣',
      visible: canViewRepositories,
      items: [
        {
          label: 'Manage Repositories',
          to: '/git-repositories/manage',
          icon: '▧',
          visible: hasPermission('ADMIN_REPOSITORY_READ'),
          description: 'Repository catalogue',
        },
        {
          label: 'Add Repository',
          to: '/git-repositories/add',
          icon: '+',
          visible: hasPermission('ADMIN_REPOSITORY_WRITE'),
          description: 'Repository registration',
        },
      ],
    },
    {
      label: 'Docker',
      icon: '⬡',
      visible: canViewDocker,
      items: [
        {
          label: 'Docker Operations',
          to: '/docker/operations',
          icon: '↺',
          visible: canViewDocker,
          description: 'Control audit ledger',
        },
        {
          label: 'Projects',
          to: '/docker/projects',
          icon: '▦',
          visible: canViewDocker,
          description: 'Application stacks',
        },
        {
          label: 'Containers',
          to: '/docker/containers',
          icon: '▣',
          visible: canViewDocker,
          description: 'Runtime inventory',
        },
        {
          label: 'Images',
          to: '/docker/images',
          icon: '◇',
          visible: canViewDocker,
          description: 'Image inventory',
        },
        {
          label: 'Storage',
          to: '/docker/storage',
          icon: '⌘',
          visible: canViewDocker,
          description: 'Persistent volumes',
        },
        {
          label: 'Networks',
          to: '/docker/networks',
          icon: '◎',
          visible: canViewDocker,
          description: 'Network topology',
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

function getNavGroupForPath(navGroups = [], pathname = '') {
  const normalizedPath = String(pathname || '').replace(/\/+$/, '') || '/';
  const matches = navGroups.flatMap((group) =>
    group.items
      .filter((item) => item.to)
      .map((item) => ({
        group,
        path: String(item.to).split('?')[0].replace(/\/+$/, '') || '/',
      })),
  );

  const exactMatch = matches.find((match) => match.path === normalizedPath);

  if (exactMatch) {
    return exactMatch.group;
  }

  return matches
    .filter((match) => normalizedPath.startsWith(`${match.path}/`))
    .sort((left, right) => right.path.length - left.path.length)[0]?.group || null;
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
  const [expandedNavGroupLabel, setExpandedNavGroupLabel] = useState('Dashboards');
  const [commandQuery, setCommandQuery] = useState('');
  const [topbarPanel, setTopbarPanel] = useState('');
  const [activeSearchIndex, setActiveSearchIndex] = useState(0);
  const [notificationItems, setNotificationItems] = useState([]);
  const [notificationUnreadCount, setNotificationUnreadCount] = useState(0);
  const [notificationFilter, setNotificationFilter] = useState('ALL');
  const [notificationLoading, setNotificationLoading] = useState(false);
  const [notificationError, setNotificationError] = useState('');
  const topbarControlsRef = useRef(null);
  const notificationOverlayRef = useRef(null);
  const commandSearchInputRef = useRef(null);

  const navGroups = useMemo(
    () => createNavGroups(hasPermission, hasRole),
    [hasPermission, hasRole],
  );
  useEffect(() => {
    const activeGroup = getNavGroupForPath(navGroups, location.pathname);
    const fallbackGroup = navGroups.find((group) => group.label === 'Dashboards') || navGroups[0];

    setExpandedNavGroupLabel(activeGroup?.label || fallbackGroup?.label || 'Dashboards');
  }, [location.pathname, navGroups]);

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
  const commandSearchMatches = useMemo(() => {
    const normalizedQuery = commandQuery.trim().toLowerCase();

    if (!normalizedQuery) {
      return [];
    }

    return commandSearchTargets
      .filter((target) => {
        const haystack =
          `${target.group} ${target.label} ${target.description} ${target.to}`.toLowerCase();
        return haystack.includes(normalizedQuery);
      })
      .slice(0, 5);
  }, [commandQuery, commandSearchTargets]);
  async function loadNotifications(status = notificationFilter, { quiet = false } = {}) {
    if (!isAuthenticated) {
      setNotificationItems([]);
      setNotificationUnreadCount(0);
      return;
    }

    if (!quiet) {
      setNotificationLoading(true);
      setNotificationError('');
    }

    try {
      const result = await notificationService.listNotifications({ status, limit: 50 });
      setNotificationItems(result.items || []);
      setNotificationUnreadCount(Number(result.unreadCount || 0));
    } catch (error) {
      if (!quiet) {
        setNotificationError(error.message || 'Failed to load notifications.');
      }
    } finally {
      if (!quiet) setNotificationLoading(false);
    }
  }


  useEffect(() => {
    setActiveSearchIndex(0);
  }, [commandQuery, commandSearchMatches.length]);

  useEffect(() => {
    setTopbarPanel('');
  }, [location.pathname]);

  useEffect(() => {
    if (!isAuthenticated) return undefined;

    loadNotifications('ALL', { quiet: true });
    const intervalId = window.setInterval(() => {
      loadNotifications(topbarPanel === 'notifications' ? notificationFilter : 'ALL', { quiet: true });
    }, 15000);

    return () => window.clearInterval(intervalId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated, notificationFilter, topbarPanel]);

  useEffect(() => {
    if (topbarPanel !== 'notifications') return undefined;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    loadNotifications(notificationFilter);

    return () => {
      document.body.style.overflow = previousOverflow;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [topbarPanel, notificationFilter]);

  useEffect(() => {
    function handlePointerDown(event) {
      if (!topbarPanel) {
        return;
      }

      if (topbarControlsRef.current?.contains(event.target)) {
        return;
      }

      if (topbarPanel === 'notifications' && notificationOverlayRef.current?.contains(event.target)) {
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

  async function openNotification(item) {
    if (!item) return;

    try {
      if (item.status === 'UNREAD') {
        await notificationService.markRead(item.notificationId);
        setNotificationUnreadCount((current) => Math.max(0, current - 1));
        setNotificationItems((current) =>
          current.map((candidate) =>
            candidate.notificationId === item.notificationId
              ? { ...candidate, status: 'READ', readAt: new Date().toISOString() }
              : candidate,
          ),
        );
      }
    } catch (error) {
      console.warn('[SkyCommand Notifications] Failed to mark notification read:', error);
    }

    setTopbarPanel('');
    if (item.targetPath) navigate(item.targetPath);
  }

  async function markAllNotificationsRead() {
    try {
      await notificationService.markAllRead();
      await loadNotifications(notificationFilter);
    } catch (error) {
      setNotificationError(error.message || 'Failed to mark notifications read.');
    }
  }

  function changeNotificationFilter(nextFilter) {
    setNotificationFilter(nextFilter === 'UNREAD' ? 'UNREAD' : 'ALL');
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
      if (!commandQuery.trim()) {
        return;
      }

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
      if (!commandQuery.trim()) {
        return;
      }

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

  function handleSidebarGroupSelect(group) {
    if (!group?.label || group.label === expandedNavGroupLabel) {
      return;
    }

    const firstItem = group.items?.find((item) => item.to);
    setExpandedNavGroupLabel(group.label);

    if (firstItem?.to) {
      navigate(firstItem.to);
      handleSidebarNavigate();
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
      <nav className="sky-public-navbar">
        <NavLink className="sky-public-brand" to="/" aria-label="SkyCommand home">
          <SkyCommandMark variant="lockup" />
        </NavLink>
      </nav>
    );
  }

  return (
    <>
      <SidebarNav
        expandedGroupLabel={expandedNavGroupLabel}
        navGroups={navGroups}
        onClose={() => setSidebarOpen(false)}
        onGroupSelect={handleSidebarGroupSelect}
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
              aria-expanded={topbarPanel === 'search' && Boolean(commandQuery.trim())}
              aria-label="Search SkyCommand commands"
              onChange={(event) => {
                const nextQuery = event.target.value;
                setCommandQuery(nextQuery);
                setTopbarPanel(nextQuery.trim() ? 'search' : '');
              }}
              placeholder="Search tools, workflows, executions..."
              ref={commandSearchInputRef}
              role="combobox"
              type="search"
              value={commandQuery}
            />
            <span className="sky-command-search-key">/</span>
            {topbarPanel === 'search' && Boolean(commandQuery.trim()) && (
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
              title="Notifications"
              type="button"
            >
              <NavIcon name="bell" />
              {notificationUnreadCount > 0 && (
                <span className="sky-topbar-count-badge">
                  {formatTopbarCount(notificationUnreadCount)}
                </span>
              )}
            </button>
          </div>

          <div className="sky-topbar-action-wrap">
            <button
              aria-expanded={topbarPanel === 'messages'}
              aria-label="Open messages"
              className="sky-topbar-icon-button sky-topbar-icon-button-message"
              onClick={() => toggleTopbarPanel('messages')}
              title="Messages"
              type="button"
            >
              <NavIcon name="mail" />
            </button>
            {topbarPanel === 'messages' && (
              <div className="sky-topbar-popover sky-action-popover" role="dialog">
                <div className="sky-topbar-popover-header">
                  <span>Messages</span>
                  <span>Inbox</span>
                </div>
                <div className="sky-command-search-empty">No messages yet.</div>
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

      {topbarPanel === 'notifications' && (
        <div
          className="sky-notification-overlay"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setTopbarPanel('');
          }}
          role="presentation"
        >
          <section
            aria-label="Notifications"
            aria-modal="true"
            className="sky-notification-center"
            ref={notificationOverlayRef}
            role="dialog"
          >
            <div className="sky-notification-center-heading">
              <div>
                <div className="sky-page-kicker">User inbox</div>
                <h2>Notifications</h2>
              </div>
              <button
                aria-label="Close notifications"
                className="btn btn-sm sky-btn-ghost"
                onClick={() => setTopbarPanel('')}
                type="button"
              >
                Close
              </button>
            </div>

            <div className="sky-notification-toolbar">
              <div className="sky-notification-tabs" role="tablist" aria-label="Notification filters">
                <button
                  aria-selected={notificationFilter === 'ALL'}
                  className={notificationFilter === 'ALL' ? 'is-active' : ''}
                  onClick={() => changeNotificationFilter('ALL')}
                  role="tab"
                  type="button"
                >
                  All
                </button>
                <button
                  aria-selected={notificationFilter === 'UNREAD'}
                  className={notificationFilter === 'UNREAD' ? 'is-active' : ''}
                  onClick={() => changeNotificationFilter('UNREAD')}
                  role="tab"
                  type="button"
                >
                  Unread{notificationUnreadCount > 0 ? ` (${notificationUnreadCount})` : ''}
                </button>
              </div>
              {notificationUnreadCount > 0 && (
                <button className="btn btn-sm sky-btn-ghost" onClick={markAllNotificationsRead} type="button">
                  Mark all read
                </button>
              )}
            </div>

            <div className="sky-notification-list">
              {notificationError && (
                <DismissibleAlert
                  className="alert alert-danger m-3"
                  onDismiss={() => setNotificationError('')}
                >
                  {notificationError}
                </DismissibleAlert>
              )}
              {notificationLoading ? (
                <div className="sky-notification-empty">Loading notifications…</div>
              ) : notificationItems.length > 0 ? (
                notificationItems.map((item) => (
                  <button
                    className={`sky-notification-item${item.status === 'UNREAD' ? ' is-unread' : ''}`}
                    key={item.notificationId}
                    onClick={() => openNotification(item)}
                    type="button"
                  >
                    <span className={`sky-notification-kind sky-notification-kind-${String(item.severity || 'INFO').toLowerCase()}`}>
                      {item.notificationType === 'APPROVAL_REQUIRED' ? '✓' : '!'}
                    </span>
                    <span className="sky-notification-copy">
                      <span className="sky-notification-item-meta">
                        <span>{getNotificationTypeLabel(item)}</span>
                        <time dateTime={item.eventAt || undefined}>{formatNotificationTime(item.eventAt)}</time>
                      </span>
                      <strong>{item.title}</strong>
                      <small>{item.message || 'Open the related SkyCommand record for details.'}</small>
                    </span>
                    <span className="sky-notification-open">Open</span>
                  </button>
                ))
              ) : (
                <div className="sky-notification-empty">
                  {notificationFilter === 'UNREAD' ? 'No unread notifications.' : 'No notifications yet.'}
                </div>
              )}
            </div>
          </section>
        </div>
      )}

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
              {passwordError && (
                <DismissibleAlert tone="danger" onDismiss={() => setPasswordError('')}>
                  {passwordError}
                </DismissibleAlert>
              )}
              {passwordSuccess && (
                <DismissibleAlert tone="success" onDismiss={() => setPasswordSuccess('')}>
                  {passwordSuccess}
                </DismissibleAlert>
              )}

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
