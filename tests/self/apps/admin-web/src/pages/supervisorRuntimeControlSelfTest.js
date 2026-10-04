#!/usr/bin/env node

const { sourceDirectoryForTest } = require('../../../../../_support/sourceTestBootstrap.js');
const sourceDir = sourceDirectoryForTest(__filename);


const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(sourceDir, '../../../..');
const component = fs.readFileSync(
  path.join(root, 'apps/admin-web/src/components/SkyCommandRuntimeControls.jsx'),
  'utf8',
);
const supervisorService = fs.readFileSync(
  path.join(root, 'apps/admin-web/src/services/supervisorService.js'),
  'utf8',
);
const infrastructureService = fs.readFileSync(
  path.join(root, 'apps/admin-web/src/services/infrastructureService.js'),
  'utf8',
);
const runtimeControlService = fs.readFileSync(
  path.join(root, 'apps/api/src/services/runtimeControlService.js'),
  'utf8',
);
const platformAvailability = fs.readFileSync(
  path.join(root, 'apps/admin-web/src/components/PlatformAvailabilityPanel.jsx'),
  'utf8',
);
const serverStatusPanel = fs.readFileSync(
  path.join(root, 'apps/admin-web/src/components/ui/ServerStatusPanel.jsx'),
  'utf8',
);
const dockerInventory = fs.readFileSync(path.join(root, 'apps/admin-web/src/pages/DockerInventory.jsx'), 'utf8');
const assistantRoutes = fs.readFileSync(
  path.join(root, 'apps/api/src/routes/assistantIntegration.routes.js'),
  'utf8',
);
const dashboard = fs.readFileSync(path.join(root, 'apps/admin-web/src/pages/Dashboard.jsx'), 'utf8');
const projectDetails = fs.readFileSync(
  path.join(root, 'apps/admin-web/src/components/DockerProjectDetailsModal.jsx'),
  'utf8',
);
const routes = fs.readFileSync(
  path.join(root, 'apps/api/src/routes/infrastructure.routes.js'),
  'utf8',
);
const supervisorServer = fs.readFileSync(
  path.join(root, 'packages/supervisor/src/server.js'),
  'utf8',
);

assert.match(component, /Rebuild Frontend/);
assert.match(component, /Rebuild Backend/);
assert.match(component, /REBUILD_BACKEND/);
assert.match(component, /Restart Runtime/);
assert.match(component, /Stop Runtime/);
assert.match(component, /availableActions\.includes\(action\)/);
assert.match(component, /infrastructureService\.controlSkyCommandRuntime\(action, createOperationId\(\)\)/);
assert.match(component, /window\.confirm\(confirmationMessage\(action\)\)/);
assert.match(component, /api\.clearSessionToken/);
assert.match(supervisorService, /X-SkyCommand-Supervisor-Grant/);
assert.match(supervisorService, /waitForOperationCompletion/);
assert.match(infrastructureService, /skycommand-runtime\/status/);
assert.match(infrastructureService, /skycommand-runtime\/actions/);
assert.match(routes, /skycommand-runtime\/status/);
assert.match(routes, /skycommand-runtime\/actions/);
assert.match(routes, /requirePermission\('INFRASTRUCTURE_DOCKER_CONTROL'\)/);
assert.match(assistantRoutes, /get\('\/runtime-controls\/status'/);
assert.match(assistantRoutes, /post\('\/runtime-controls\/runs'/);
assert.match(runtimeControlService, /DEV_RUNTIME_LIFECYCLE/);
assert.match(runtimeControlService, /codex-local/);
assert.match(runtimeControlService, /SKYCOMMAND_RUNTIME_CONTROL_STATE_MISMATCH/);
assert.match(runtimeControlService, /HOST_SUPERVISOR_SIGNED_GRANT/);
assert.match(runtimeControlService, /dispatchSupervisorProcessLifecycle/);
assert.match(supervisorServer, /runtime\/rebuild-backend/);
assert.match(supervisorServer, /REBUILD_BACKEND/);
assert.match(dashboard, /<SkyCommandRuntimeControls/);
assert.match(dashboard, /<PlatformAvailabilityPanel/);
for (const segment of ['Frontend', 'Backend', 'Agent', 'Codex']) assert.match(platformAvailability, new RegExp(`label: '${segment}'`));
assert.match(platformAvailability, /Start Supervisor/);
assert.match(platformAvailability, /Restart Supervisor/);
assert.match(platformAvailability, /Start Host Agent/);
assert.match(platformAvailability, /Restart Host Agent/);
assert.match(platformAvailability, /codex-agent-runtime-worker/);
assert.match(platformAvailability, /temporal-volume-init/);
assert.match(platformAvailability, /codex-control-bridge/);
assert.match(platformAvailability, /codex-egress-proxy/);
assert.match(platformAvailability, /codex-mcp-gateway/);
assert.match(serverStatusPanel, /react-router-dom/);
assert.match(serverStatusPanel, /\/docker\/containers\?/);
assert.match(serverStatusPanel, /URLSearchParams/);
assert.match(dockerInventory, /searchParams\.get\('q'\)/);
assert.match(dockerInventory, /q: initialQuery/);
assert.match(projectDetails, /SELF_MANAGED_PROTECTED/);
assert.match(projectDetails, /<SkyCommandRuntimeControls canControl=\{canControl\}/);

console.log('✅ SkyCommand Supervisor runtime-control UI self-test passed.');
