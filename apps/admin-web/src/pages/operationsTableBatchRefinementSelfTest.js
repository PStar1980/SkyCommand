const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '../../../..');
const read = (relativePath) => fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');

const scheduler = read('apps/admin-web/src/pages/SchedulerControl.jsx');
const docker = read('apps/admin-web/src/pages/DockerOperations.jsx');
const approvals = read('apps/admin-web/src/pages/WorkflowApprovals.jsx');
const workerService = read('apps/api/src/services/workerService.js');
const infrastructureService = read('apps/api/src/services/infrastructureService.js');
const workflowExecutor = read('apps/api/src/services/workflowExecutorService.js');
const css = read('apps/admin-web/src/App.css');
const sortingUtility = read('apps/admin-web/src/utils/tableSorting.js');

assert.match(scheduler, /SCHEDULER_RUN_DEFAULT_SORTS/);
assert.match(scheduler, /WORKER_NODE_DEFAULT_SORTS/);
assert.match(scheduler, /renderSortableHeader\('Schedule', 'schedule', runSorts, updateRunSorting\)/);
assert.match(scheduler, /renderSortableHeader\('Heartbeat', 'lastHeartbeatAt', nodeSorts, updateNodeSorting\)/);
assert.match(scheduler, /sky-canonical-operations-table-frame/);
assert.match(scheduler, /sky-pagination-nav-button/);
assert.match(scheduler, /queueNodeFilterLoad/);
assert.doesNotMatch(scheduler, /applyNodeFilters/);

assert.match(docker, /DOCKER_OPERATIONS_DEFAULT_SORTS/);
assert.match(docker, /renderSortableHeader\('Requested', 'requestedAt'\)/);
assert.match(docker, /renderSortableHeader\('Duration', 'durationMs'\)/);
assert.match(docker, /sky-canonical-hover-row/);
assert.match(docker, /Clear sorting/);

assert.match(approvals, /APPROVAL_HISTORY_DEFAULT_SORTS/);
assert.match(approvals, /renderSortableHeader\('Workflow', 'workflow'\)/);
assert.match(approvals, /renderSortableHeader\('Requested', 'requestedAt'\)/);
assert.match(approvals, /sky-canonical-operations-table/);
assert.match(approvals, /sky-pagination-nav-button/);

assert.match(workerService, /sortValue: filters\.sort/);
assert.match(workerService, /schedule: .*schedule_name/);
assert.match(workerService, /lastHeartbeatAt: 'last_heartbeat_at'/);
assert.match(infrastructureService, /sortValue: filters\.sort/);
assert.match(infrastructureService, /requestedAt: 'created_at'/);
assert.match(infrastructureService, /durationMs: .*durationMs/);
assert.match(workflowExecutor, /requiredRole: .*required_role_code/);
assert.match(workflowExecutor, /requestedAt: 'COALESCE\(requested_at, created_at\)'/);

assert.match(css, /\.sky-canonical-operations-table-frame/);
assert.match(css, /\.sky-canonical-operations-table tbody tr\.sky-selected-row/);
assert.match(css, /\.sky-canonical-operations-pagination-controls/);
assert.match(sortingUtility, /getNextSortState/);
assert.match(sortingUtility, /shiftKey/);

console.log('[SkyCommand] Operations table batch canonical rollout self-test passed.');
