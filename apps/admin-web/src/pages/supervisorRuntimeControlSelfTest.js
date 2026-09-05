#!/usr/bin/env node

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../../../..');
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
const dashboard = fs.readFileSync(path.join(root, 'apps/admin-web/src/pages/Dashboard.jsx'), 'utf8');
const projectDetails = fs.readFileSync(
  path.join(root, 'apps/admin-web/src/components/DockerProjectDetailsModal.jsx'),
  'utf8',
);
const routes = fs.readFileSync(
  path.join(root, 'apps/api/src/routes/infrastructure.routes.js'),
  'utf8',
);

assert.match(component, /Rebuild Frontend/);
assert.match(component, /REBUILD_WEB/);
assert.match(component, /Restart Runtime/);
assert.match(component, /Stop Runtime/);
assert.match(component, /authorizeSkyCommandRuntimeControl/);
assert.match(component, /supervisorService\.controlRuntime/);
assert.match(component, /api\.clearSessionToken/);
assert.match(supervisorService, /X-SkyCommand-Supervisor-Grant/);
assert.match(supervisorService, /rebuild-web/);
assert.match(supervisorService, /waitForOperationCompletion/);
assert.match(infrastructureService, /skycommand-runtime\/authorizations/);
assert.match(routes, /INFRASTRUCTURE_DOCKER_CONTROL/);
assert.match(routes, /authorizeSkyCommandRuntimeControl/);
assert.match(dashboard, /<SkyCommandRuntimeControls/);
assert.match(projectDetails, /SELF_MANAGED_PROTECTED/);
assert.match(projectDetails, /<SkyCommandRuntimeControls canControl=\{canControl\}/);

console.log('✅ SkyCommand Supervisor runtime-control UI self-test passed.');
