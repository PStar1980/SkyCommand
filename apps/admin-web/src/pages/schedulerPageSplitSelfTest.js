const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '../../../..');
const schedulerPage = fs.readFileSync(
  path.join(repoRoot, 'apps/admin-web/src/pages/SchedulerControl.jsx'),
  'utf8',
);
const listenersPage = fs.readFileSync(
  path.join(repoRoot, 'apps/admin-web/src/pages/AutomationListeners.jsx'),
  'utf8',
);
const appCss = fs.readFileSync(
  path.join(repoRoot, 'apps/admin-web/src/App.css'),
  'utf8',
);
const router = fs.readFileSync(
  path.join(repoRoot, 'apps/admin-web/src/main.jsx'),
  'utf8',
);
const navbar = fs.readFileSync(
  path.join(repoRoot, 'apps/admin-web/src/components/Navbar.jsx'),
  'utf8',
);
const workerService = fs.readFileSync(
  path.join(repoRoot, 'apps/api/src/services/workerService.js'),
  'utf8',
);

const checks = [
  [schedulerPage.includes("title: 'Scheduler Operations'"), 'Scheduler Operations page metadata is required.'],
  [schedulerPage.includes("title: 'Manage Schedules'"), 'Manage Schedules page metadata is required.'],
  [schedulerPage.includes("title: 'Create Schedules'"), 'Create Schedules page metadata is required.'],
  [schedulerPage.includes("title: 'Worker Operations'"), 'Worker Operations page metadata is required.'],
  [schedulerPage.includes('Smart polling live'), 'Operations pages must expose smart polling status.'],
  [schedulerPage.includes('Scheduler operations data') && schedulerPage.includes('Schedule definitions'), 'Scheduler Operations and Manage Schedules must use standardized browser titles.'],
  [schedulerPage.includes('Run browser') && schedulerPage.includes('Schedule browser'), 'Automation schedule browsers must expose Workflow Operations-style browser kickers.'],
  [schedulerPage.includes('sky-history-browser-filter-grid') && schedulerPage.includes('sky-schedule-browser-filter-grid'), 'Automation schedule browsers must use standardized labeled filter grids.'],
  [schedulerPage.includes('Schedule, code, target...') && schedulerPage.includes('Schedule, code, target, node...'), 'Schedule history and management search controls are required.'],
  [schedulerPage.includes('queueScheduleFilterLoad') && schedulerPage.includes('queueRunFilterLoad'), 'Scheduler filters must auto-apply through managed filter loading.'],
  [!schedulerPage.includes('applyScheduleFilters') && !schedulerPage.includes('applyRunFilters'), 'Scheduler Operations and Manage Schedules must not require Apply filters submissions.'],
  [schedulerPage.includes('Search node, host, version...'), 'Worker Operations search is required.'],
  [schedulerPage.includes("label: 'schedule run(s)'"), 'Scheduler Operations pagination is required.'],
  [schedulerPage.includes("label: 'schedule definition(s)'"), 'Manage Schedules pagination is required.'],
  [schedulerPage.includes("renderSortableHeader('Schedule', 'schedule', scheduleSorts, updateScheduleSorting)")
    && schedulerPage.includes("renderSortableHeader('Type', 'type', scheduleSorts, updateScheduleSorting)")
    && schedulerPage.includes("renderSortableHeader('Target', 'target', scheduleSorts, updateScheduleSorting)")
    && schedulerPage.includes("renderSortableHeader('Timing', 'timing', scheduleSorts, updateScheduleSorting)")
    && schedulerPage.includes("renderSortableHeader('Latest Run', 'latestRun', scheduleSorts, updateScheduleSorting)")
    && schedulerPage.includes("renderSortableHeader('Next Run', 'nextRun', scheduleSorts, updateScheduleSorting)")
    && schedulerPage.includes("renderSortableHeader('Status', 'status', scheduleSorts, updateScheduleSorting)")
    && schedulerPage.includes('scheduleSortingCustomized')
    && schedulerPage.includes('Clear sorting'), 'Manage Schedules must use canonical multi-column sorting controls.'],
  [schedulerPage.includes("return getScheduleTargetType(schedule);")
    && schedulerPage.includes("if (field === 'timing')")
    && schedulerPage.includes("if (field === 'latestRun')")
    && schedulerPage.includes("return schedule?.enabled ? 1 : 0;"), 'Manage Schedules sorting must keep target type, timing, latest run, and enabled status as independent columns.'],
  [schedulerPage.includes('sky-canonical-operations-table-frame')
    && schedulerPage.includes("idPrefix: 'manage-schedules'")
    && schedulerPage.includes('sky-canonical-operations-pagination-row'), 'Manage Schedules must use the canonical table frame and centered gold pagination.'],
  [schedulerPage.includes('SCHEDULE_FETCH_LIMIT = 500')
    && schedulerPage.includes('do {')
    && schedulerPage.includes('nextItems.push(...batch)'), 'Manage Schedules must fetch filtered schedules in API-safe batches for global sorting.'],
  [schedulerPage.includes("label: 'worker node(s)'"), 'Worker Operations pagination is required.'],
  [schedulerPage.includes('getAvailableTablePageSizes')
    && schedulerPage.includes('changeSchedulePageSize')
    && schedulerPage.includes('changeRunPageSize')
    && schedulerPage.includes('changeNodePageSize')
    && schedulerPage.includes('sky-canonical-rows-control')
    && schedulerPage.includes('sky-table-browser-anchor'), 'Scheduler Operations, Manage Schedules, and Worker Operations must expose the canonical smart Rows selector and browser re-anchor behavior.'],
  [schedulerPage.includes('Showing {rangeStart}–{rangeEnd} of {total} {label}')
    && schedulerPage.includes('renderedCount: visibleSchedules.length')
    && schedulerPage.includes('renderedCount: runs.length')
    && schedulerPage.includes('renderedCount: nodes.length'), 'Automation pagination summaries must describe the actual rendered range for the selected Rows size.'],
  [schedulerPage.includes('<div className="fw-bold">{schedule.scheduleName}</div>')
    && schedulerPage.includes('<div className="small sky-muted sky-mono">{schedule.scheduleCode}</div>')
    && schedulerPage.includes('<div className="fw-bold">{node.nodeName}</div>')
    && !schedulerPage.includes('fw-bold sky-detail-value">{schedule.scheduleName}')
    && !schedulerPage.includes('fw-bold sky-detail-value">{node.nodeName}'), 'Automation browser rows must use Workflow Operations typography for primary and secondary text.'],
  [listenersPage.includes('LISTENER_FETCH_LIMIT = 500')
    && listenersPage.includes("renderSortableHeader('Listener', 'listener')")
    && listenersPage.includes("renderSortableHeader('Type', 'type')")
    && listenersPage.includes("renderSortableHeader('Tool', 'tool')")
    && listenersPage.includes("renderSortableHeader('Status', 'status')")
    && listenersPage.includes('Clear sorting')
    && listenersPage.includes('sky-canonical-operations-table-frame'), 'Listeners must use the canonical sortable table browser treatment.'],
  [listenersPage.includes('getAvailableTablePageSizes')
    && listenersPage.includes('changePageSize')
    && listenersPage.includes('listenerRowsSelect')
    && listenersPage.includes('sky-canonical-rows-control')
    && listenersPage.includes('sky-table-browser-anchor'), 'Listeners must expose the canonical smart Rows selector and browser re-anchor behavior.'],
  [listenersPage.includes('<div className="fw-bold">{listener.listenerName}</div>')
    && listenersPage.includes('<div className="small sky-muted sky-mono">{listener.listenerCode}</div>')
    && !listenersPage.includes('fw-bold sky-detail-value">{listener.listenerName}'), 'Listener browser typography must match Workflow Operations primary/subtext hierarchy.'],
  [
    (schedulerPage.match(/sky-automation-surface-row/g) || []).length >= 4
      && (listenersPage.match(/sky-automation-surface-row/g) || []).length >= 2
      && appCss.includes('.sky-app-shell-authenticated .sky-main > .sky-automation-surface-row')
      && appCss.includes('margin-top: calc(-1 * var(--bs-gutter-y)) !important;'),
    'All five Automation pages must use the shared standard outer card spacing without stacked Bootstrap top margins.',
  ],
  [
    schedulerPage.includes('sky-card sky-scheduler-detail-card')
      && !schedulerPage.includes('sky-card sky-sticky-detail-card'),
    'Manage Schedules detail must remain in normal document flow so browser-to-detail spacing uses the standard surface gap.',
  ],
  [router.includes('path="automation/schedules/history"'), 'Scheduler Operations route is required.'],
  [router.includes('path="automation/schedules/manage"'), 'Manage Schedules route is required.'],
  [router.includes('path="automation/schedules/create"'), 'Create Schedules route is required.'],
  [router.includes('path="automation/workers/history"'), 'Worker Operations route is required.'],
  [navbar.includes("label: 'Scheduler Operations'"), 'Scheduler Operations navigation is required.'],
  [navbar.includes("label: 'Manage Schedules'"), 'Manage Schedules navigation is required.'],
  [navbar.includes("label: 'Create Schedules'"), 'Create Schedules navigation is required.'],
  [navbar.includes("label: 'Worker Operations'"), 'Worker Operations navigation is required.'],
  [workerService.includes("columns: ['schedule_code', 'schedule_name', 'tool_code', 'tool_label', 'node_name', 'execution_id']"), 'Schedule run API search coverage is required.'],
];

const failures = checks.filter(([passed]) => !passed).map(([, message]) => message);

if (failures.length > 0) {
  console.error('[SkyCommand] Scheduler page split self-test failed:');
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log('[SkyCommand] Scheduler page split and smart polling self-test passed.');
