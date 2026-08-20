const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const sourceRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(sourceRoot, '../../..');
const read = (relativePath) => fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');

const navbar = read('apps/admin-web/src/components/Navbar.jsx');
const router = read('apps/admin-web/src/main.jsx');
const overview = read('apps/admin-web/src/pages/DockerOverview.jsx');
const inventory = read('apps/admin-web/src/pages/DockerInventory.jsx');
const operations = read('apps/admin-web/src/pages/DockerOperations.jsx');
const apiRoutes = read('apps/api/src/routes/infrastructure.routes.js');
const apiServer = read('apps/api/src/server.js');
const service = read('apps/api/src/services/infrastructureService.js');
const activities = read('packages/host-agent/src/activities.js');
const migration = read('packages/db_build/src/migrations/00102__docker_infrastructure_read_foundation.sql');

assert.match(navbar, /label: 'Docker'/);
assert.match(navbar, /label: 'Docker Overview'/);
assert.match(navbar, /label: 'Compose Projects'/);
assert.match(navbar, /label: 'Containers'/);
assert.match(navbar, /label: 'Images'/);
assert.match(navbar, /label: 'Storage & Networks'/);
assert.match(navbar, /label: 'Docker Operations'/);
assert.match(navbar, /INFRASTRUCTURE_DOCKER_READ/);
assert.match(router, /path="docker\/overview"/);
assert.match(router, /path="docker\/projects"/);
assert.match(router, /path="docker\/containers"/);
assert.match(router, /path="docker\/images"/);
assert.match(router, /path="docker\/storage"/);
assert.match(router, /path="docker\/operations"/);
assert.match(overview, /SkyCommand Host Agent/);
assert.match(overview, /Compose Projects/);
assert.match(inventory, /Container Inventory/);
assert.match(operations, /Docker write actions disabled/);
assert.doesNotMatch(operations, /docker exec/i);
assert.match(apiRoutes, /providers\/docker\/overview/);
assert.match(apiRoutes, /requirePermission\('INFRASTRUCTURE_DOCKER_READ'\)/);
assert.match(apiServer, /app\.use\('\/api\/infrastructure', infrastructureRoutes\)/);
assert.match(service, /skyCommandHostAgentToolWorkflow/);
assert.match(service, /DOCKER_SNAPSHOT_TOOL_CODE/);
assert.match(activities, /executeDockerSnapshot/);
assert.match(migration, /INFRASTRUCTURE_DOCKER_READ/);
assert.match(migration, /read-only Docker inventory/i);

console.log('✅ SkyCommand Docker infrastructure UI self-test passed.');
