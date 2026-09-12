const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../../../../../..');

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

function includesAll(text, fragments, label) {
  for (const fragment of fragments) {
    assert.ok(text.includes(fragment), `${label} is missing: ${fragment}`);
  }
}

function run() {
  const seed = read('packages/db_build/src/seeds/00124__playwright_scheduler_bridges_seed.sql');
  includesAll(seed, [
    'browser_test_schedule_start',
    'browser_test_suite_schedule_start',
    'browser_automation_schedule_start',
    "'BROWSER_TEST_RUN'",
    "'BROWSER_TEST_SUITE_RUN'",
    "'BROWSER_AUTOMATION_RUN'",
    "SELECT target_tools.tool_id, 'worker'",
  ], 'Playwright scheduler bridge seed');

  const runner = read('apps/worker/src/jobs/scheduledPlaywrightRunner.js');
  includesAll(runner, [
    "targetType: 'BROWSER_TEST'",
    "targetType: 'BROWSER_TEST_SUITE'",
    "targetType: 'BROWSER_AUTOMATION'",
    "triggerSource: 'SCHEDULER'",
    "executionMode: 'HEADLESS'",
    'runScheduledPlaywright',
    'browserTarget:',
  ], 'Scheduled Playwright runner');

  const scheduledToolRunner = read('apps/worker/src/jobs/scheduledToolRunner.js');
  includesAll(scheduledToolRunner, [
    'BROWSER_TEST_SCHEDULE_TOOL_CODE',
    'BROWSER_TEST_SUITE_SCHEDULE_TOOL_CODE',
    'BROWSER_AUTOMATION_SCHEDULE_TOOL_CODE',
    'runScheduledPlaywright',
    'browserTarget: result.browserTarget || null',
  ], 'Scheduled tool router');

  const workerService = read('apps/api/src/services/workerService.js');
  includesAll(workerService, [
    'BROWSER_TEST_SCHEDULE_CONFIRMATION_REQUIRED',
    'BROWSER_TEST_SUITE_SCHEDULE_CONFIRMATION_REQUIRED',
    'BROWSER_AUTOMATION_SCHEDULE_CONFIRMATION_REQUIRED',
    'resolveBrowserTestParameters',
    'resolveEnvironment(target, environmentCode)',
    'resolveParameters(',
  ], 'Scheduler validation');

  const admin = read('apps/admin-web/src/pages/SchedulerControl.jsx');
  includesAll(admin, [
    "value: 'BROWSER_TEST'",
    "value: 'BROWSER_TEST_SUITE'",
    "value: 'BROWSER_AUTOMATION'",
    'Playwright target parameters',
    'ScheduledBrowserTargetEvidence',
    'Open Playwright result',
    'confirmation-required targets are excluded',
  ], 'Scheduler UI');

  const notificationMigration = read('packages/db_build/src/migrations/00125__scheduler_failure_notifications.sql');
  includesAll(notificationMigration, [
    "'SCHEDULE_RUN_FAILED'",
    "'SCHEDULE_RUN'",
    'auth.notify_failed_schedule_run()',
    "'/automation/schedules/history'",
  ], 'Scheduler failure notifications');

  const navbar = read('apps/admin-web/src/components/Navbar.jsx');
  assert.ok(navbar.includes("item.notificationType === 'SCHEDULE_RUN_FAILED'"));

  const developmentPromotionSeeds = fs.readdirSync(path.join(ROOT, 'packages/db_build/src/migrations'))
    .filter((fileName) => fileName.toLowerCase().includes('development_promotion'))
    .map((fileName) => read(`packages/db_build/src/migrations/${fileName}`))
    .join('\n');
  assert.ok(!developmentPromotionSeeds.includes('BROWSER_TEST_SUITE'), 'Phase 10 must not add Playwright to Development Promotion.');

  console.log('[playwright-scheduler:self-test] PASS');
}

run();
