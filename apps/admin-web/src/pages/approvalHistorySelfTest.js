const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '../../../..');
const approvalPage = fs.readFileSync(
  path.join(repoRoot, 'apps/admin-web/src/pages/WorkflowApprovals.jsx'),
  'utf8',
);
const navbar = fs.readFileSync(
  path.join(repoRoot, 'apps/admin-web/src/components/Navbar.jsx'),
  'utf8',
);
const workflowService = fs.readFileSync(
  path.join(repoRoot, 'apps/api/src/services/workflowExecutorService.js'),
  'utf8',
);

const checks = [
  [approvalPage.includes('<h1 className="sky-page-title">Approval History</h1>'), 'Approval History title is required.'],
  [approvalPage.includes('aria-label="Approval history pagination"'), 'Approval History pagination controls are required.'],
  [approvalPage.includes('All roles') && approvalPage.includes('All users'), 'Role and user filters are required.'],
  [approvalPage.includes('Selected approval record'), 'Selected approval result workspace is required.'],
  [approvalPage.includes('Approval request') && approvalPage.includes('Recorded result'), 'Approval request and result sections are required.'],
  [(approvalPage.match(/table table-sm sky-table align-middle mb-0/g) || []).length >= 2, 'Approval request and result data must render as output tables.'],
  [approvalPage.includes('Linked to workflow execution') && approvalPage.includes('Any authorized approver'), 'Approval tables must use user-friendly labels.'],
  [!approvalPage.includes('decideApproval') && !approvalPage.includes('Approve and continue') && !approvalPage.includes('onClick={() => decide'), 'Approval History must remain read-only.'],
  [navbar.includes("label: 'Approval History'"), 'Workflow navigation must use Approval History.'],
  [workflowService.includes('COUNT(*)::integer AS total') && workflowService.includes('OFFSET $${offsetParameter}'), 'Approval API must support complete server-side pagination.'],
  [workflowService.includes('requested_by_display_name') && workflowService.includes('decided_by_display_name'), 'Approval search must include requester and decision-maker identity.'],
  [workflowService.includes('facets: {') && workflowService.includes('roles:') && workflowService.includes('users:'), 'Approval API facets are required.'],
];

const failures = checks.filter(([passed]) => !passed).map(([, message]) => message);

if (failures.length > 0) {
  console.error('[SkyCommand] Approval History self-test failed:');
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log('[SkyCommand] Approval History read-only browser self-test passed.');
