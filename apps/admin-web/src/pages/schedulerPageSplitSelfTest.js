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
  [schedulerPage.includes("title: 'Scheduler History'"), 'Scheduler History page metadata is required.'],
  [schedulerPage.includes("title: 'Manage Schedules'"), 'Manage Schedules page metadata is required.'],
  [schedulerPage.includes("title: 'Create Schedules'"), 'Create Schedules page metadata is required.'],
  [schedulerPage.includes("title: 'Worker History'"), 'Worker History page metadata is required.'],
  [schedulerPage.includes('Smart polling live'), 'History pages must expose smart polling status.'],
  [schedulerPage.includes('Search runs') && schedulerPage.includes('Search schedules'), 'Schedule history and management search controls are required.'],
  [schedulerPage.includes('Search node, host, version...'), 'Worker History search is required.'],
  [schedulerPage.includes("label: 'schedule run(s)'"), 'Scheduler History pagination is required.'],
  [schedulerPage.includes("label: 'schedule definition(s)'"), 'Manage Schedules pagination is required.'],
  [schedulerPage.includes("label: 'worker node(s)'"), 'Worker History pagination is required.'],
  [router.includes('path="automation/schedules/history"'), 'Scheduler History route is required.'],
  [router.includes('path="automation/schedules/manage"'), 'Manage Schedules route is required.'],
  [router.includes('path="automation/schedules/create"'), 'Create Schedules route is required.'],
  [router.includes('path="automation/workers/history"'), 'Worker History route is required.'],
  [navbar.includes("label: 'Scheduler History'"), 'Scheduler History navigation is required.'],
  [navbar.includes("label: 'Manage Schedules'"), 'Manage Schedules navigation is required.'],
  [navbar.includes("label: 'Create Schedules'"), 'Create Schedules navigation is required.'],
  [navbar.includes("label: 'Worker History'"), 'Worker History navigation is required.'],
  [workerService.includes("columns: ['schedule_code', 'schedule_name', 'tool_code', 'tool_label', 'node_name', 'execution_id']"), 'Schedule run API search coverage is required.'],
];

const failures = checks.filter(([passed]) => !passed).map(([, message]) => message);

if (failures.length > 0) {
  console.error('[SkyCommand] Scheduler page split self-test failed:');
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log('[SkyCommand] Scheduler page split and smart polling self-test passed.');
