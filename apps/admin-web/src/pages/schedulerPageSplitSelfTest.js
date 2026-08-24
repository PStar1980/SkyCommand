const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '../../../..');
const schedulerPage = fs.readFileSync(
  path.join(repoRoot, 'apps/admin-web/src/pages/SchedulerControl.jsx'),
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
  [schedulerPage.includes("label: 'worker node(s)'"), 'Worker Operations pagination is required.'],
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
