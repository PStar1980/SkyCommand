const fs = require('node:fs');
const path = require('node:path');

function assert(condition, message) {
  if (!condition) {
    throw new Error(`[SkyCommand transient alert self-test] ${message}`);
  }
}

const uiDirectory = __dirname;
const adminWebSource = path.resolve(uiDirectory, '..', '..');
const componentSource = fs.readFileSync(path.join(uiDirectory, 'DismissibleAlert.jsx'), 'utf8');
const loginSource = fs.readFileSync(path.join(adminWebSource, 'pages', 'Login.jsx'), 'utf8');
const cssSource = fs.readFileSync(path.join(adminWebSource, 'App.css'), 'utf8');

assert(
  componentSource.includes('className="sky-alert-dismiss"') &&
    componentSource.includes("onDismiss?.();") &&
    componentSource.includes("aria-label={dismissLabel}"),
  'The shared transient alert must expose an accessible dismiss control and optional dismissal callback.',
);

assert(
  loginSource.includes('className="sky-login-alert-slot"') &&
    loginSource.includes('dismissLabel="Dismiss login error"') &&
    loginSource.includes('dismissLabel="Dismiss session message"'),
  'Login must reserve one stable alert slot and render dismissible login/session feedback inside it.',
);

assert(
  cssSource.includes('.sky-login-alert-slot {') &&
    cssSource.includes('height: 3.15rem;') &&
    cssSource.includes('.sky-login-alert-slot .sky-auth-alert {') &&
    cssSource.includes('height: 100%;'),
  'The Login alert reservation must retain a fixed height whether or not feedback is visible.',
);

assert(
  cssSource.includes('.sky-dismissible-alert {') &&
    cssSource.includes('.sky-alert-dismiss {') &&
    cssSource.includes('.sky-alert-dismiss:hover,') &&
    cssSource.includes('.sky-alert-dismiss:focus-visible'),
  'Dismissible transient messages must retain the shared close-button styling and focus treatment.',
);

const transientSurfaceFiles = [
  'components/Navbar.jsx',
  'components/DockerContainerDetailsModal.jsx',
  'components/DockerProjectDetailsModal.jsx',
  'components/DockerResourceDetailsModal.jsx',
  'components/WorkflowApprovalOverlay.jsx',
  'pages/AddRepository.jsx',
  'pages/AdminPrivileges.jsx',
  'pages/AdminRoles.jsx',
  'pages/AdminSessions.jsx',
  'pages/AdminUsers.jsx',
  'pages/AutomationListeners.jsx',
  'pages/DockerInventory.jsx',
  'pages/ManageRepositories.jsx',
  'pages/ManageTools.jsx',
  'pages/SchedulerControl.jsx',
  'pages/TemporalWorkflows.jsx',
  'pages/WorkerControl.jsx',
  'pages/WorkflowBuilder.jsx',
  'pages/WorkflowManager.jsx',
];

for (const relativePath of transientSurfaceFiles) {
  const source = fs.readFileSync(path.join(adminWebSource, relativePath), 'utf8');
  assert(
    source.includes('DismissibleAlert'),
    `${relativePath} must use the shared dismissible transient-feedback surface.`,
  );
}

const forbiddenLegacyPatterns = [
  '{error && <div className="alert alert-danger">{error}</div>}',
  '{success && <div className="alert alert-success">{success}</div>}',
  '{notice && <div className="alert alert-success">{notice}</div>}',
  '{message && <div className="alert alert-success">{message}</div>}',
];

for (const relativePath of transientSurfaceFiles) {
  const source = fs.readFileSync(path.join(adminWebSource, relativePath), 'utf8');
  for (const forbiddenPattern of forbiddenLegacyPatterns) {
    assert(
      !source.includes(forbiddenPattern),
      `${relativePath} must not retain legacy non-dismissible transient alert markup.`,
    );
  }
}

console.log('✅ SkyCommand transient alert self-test passed.');
