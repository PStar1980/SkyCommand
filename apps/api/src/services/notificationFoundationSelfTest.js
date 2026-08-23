const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '../../../..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

const migration = read('packages/db_build/src/migrations/00106__user_notification_foundation.sql');
const routes = read('apps/api/src/routes/auth.routes.js');
const service = read('apps/api/src/services/notificationService.js');
const navbar = read('apps/admin-web/src/components/Navbar.jsx');
const styles = read('apps/admin-web/src/App.css');
const approvals = read('apps/admin-web/src/pages/WorkflowApprovals.jsx');
const tools = read('apps/admin-web/src/pages/ScriptExecutions.jsx');
const workflows = read('apps/admin-web/src/pages/SkyWorkflows.jsx');
const adminRead = read('apps/api/src/services/adminReadService.js');
const workflowExecutor = read('apps/api/src/services/workflowExecutorService.js');
const telemetryPolicy = read('apps/api/src/services/apiTelemetryPolicy.js');

assert.match(migration, /CREATE TABLE IF NOT EXISTS auth\.user_notifications/);
assert.match(migration, /APPROVAL_REQUIRED/);
assert.match(migration, /TOOL_RUN_FAILED/);
assert.match(migration, /WORKFLOW_RUN_FAILED/);
assert.match(migration, /required_role_code/);
assert.match(migration, /role\.role_code IN \(UPPER\(btrim\(NEW\.required_role_code\)\), 'SUPER_ADMIN'\)/);
assert.match(migration, /NEW\.user_id/);
assert.match(migration, /NEW\.started_by_user_id/);
assert.match(migration, /launchChannel', 'INTERACTIVE'\) = 'WORKFLOW'/);
assert.match(migration, /status IN \('UNREAD', 'READ', 'DISMISSED', 'RESOLVED'\)/);
assert.match(migration, /UNIQUE \(user_id, source_type, source_id\)/);

assert.match(routes, /router\.get\('\/notifications'/);
assert.match(routes, /router\.patch\('\/notifications\/:notificationId\/read'/);
assert.match(routes, /router\.post\('\/notifications\/read-all'/);
assert.match(service, /reconcilePendingApprovalNotifications/);
assert.match(service, /status = 'UNREAD'/);
assert.match(service, /markAllNotificationsRead/);

assert.doesNotMatch(navbar, /const notificationItems = \[/);
assert.doesNotMatch(navbar, /const messageItems = \[/);
assert.match(navbar, /notificationUnreadCount > 0/);
assert.match(navbar, /className="sky-notification-overlay"/);
assert.match(navbar, /className="sky-notification-center"/);
assert.match(navbar, /notificationFilter === 'UNREAD'/);
assert.match(navbar, /Mark all read/);
assert.match(navbar, /No messages yet\./);
assert.doesNotMatch(navbar, /sky-topbar-count-badge-muted/);

assert.match(styles, /\.sky-notification-overlay\s*\{/);
assert.match(styles, /position:\s*fixed/);
assert.match(styles, /backdrop-filter:\s*blur/);
assert.match(styles, /\.sky-notification-center\s*\{/);

assert.match(approvals, /searchParams\.get\('approvalRequestId'\)/);
assert.match(tools, /searchParams\.get\('executionId'\)/);
assert.match(workflows, /searchParams\.get\('runId'\)/);
assert.match(adminRead, /execution_id::text/);
assert.match(workflowExecutor, /approval_request_id::text ILIKE/);
assert.match(telemetryPolicy, /normalizedPath === '\/api\/auth\/notifications'/);

console.log('✅ SkyCommand notification foundation self-test passed.');
