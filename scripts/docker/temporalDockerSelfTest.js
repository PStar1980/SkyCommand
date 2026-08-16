const fs = require('node:fs');
const path = require('node:path');

function assert(condition, message) {
  if (!condition) {
    throw new Error(`[SkyCommand Temporal Docker self-test] ${message}`);
  }
}

const repositoryRoot = path.resolve(__dirname, '..', '..');
const composeSource = fs.readFileSync(path.join(repositoryRoot, 'compose.yaml'), 'utf8');
const packageJson = JSON.parse(fs.readFileSync(path.join(repositoryRoot, 'package.json'), 'utf8'));
const envSource = fs.readFileSync(path.join(repositoryRoot, '.env.example'), 'utf8');
const temporalConfigSource = fs.readFileSync(
  path.join(repositoryRoot, 'packages', 'temporal', 'src', 'config.js'),
  'utf8',
);
const workflowHealthSource = fs.readFileSync(
  path.join(repositoryRoot, 'apps', 'api', 'src', 'services', 'workflowHealthService.js'),
  'utf8',
);

assert(
  /services:\s*[\s\S]*?temporal:\s*[\s\S]*?image: temporalio\/temporal:1\.7\.2/.test(composeSource),
  'compose.yaml must define a pinned Temporal CLI development-service image.',
);
assert(
  composeSource.includes('temporal-volume-init:') &&
    composeSource.includes('image: alpine:3.23.4') &&
    composeSource.includes('chown -R 1000:1000 /var/lib/temporal') &&
    composeSource.includes('condition: service_completed_successfully'),
  'Compose must initialize the Temporal named volume for the non-root Temporal CLI user before server startup.',
);
assert(
  composeSource.includes('127.0.0.1:7233:7233') &&
    composeSource.includes('127.0.0.1:8600:8233'),
  'Temporal gRPC must remain on host 7233 and the Web UI must publish safely on host 8600.',
);
assert(
  composeSource.includes('/var/lib/temporal/temporal.db') &&
    composeSource.includes('temporal_data:/var/lib/temporal') &&
    composeSource.includes('name: skycommand_temporal_data'),
  'Temporal development state must persist in the named Docker volume.',
);
assert(
  composeSource.includes('temporal\n        - operator\n        - cluster\n        - health') &&
    composeSource.includes('restart: unless-stopped'),
  'The Temporal container must expose a Docker health probe and restart automatically unless explicitly stopped.',
);

const scripts = packageJson.scripts || {};
assert(scripts['temporal:server:up'] === 'docker compose up -d temporal', 'Missing Temporal Docker start helper.');
assert(scripts['temporal:server:stop'] === 'docker compose stop temporal', 'Missing Temporal Docker stop helper.');
assert(scripts['temporal:server:restart'] === 'docker compose restart temporal', 'Missing Temporal Docker restart helper.');
assert(scripts['temporal:server:status'] === 'docker compose ps temporal', 'Missing Temporal Docker status helper.');
assert(scripts['temporal:server:logs'] === 'docker compose logs -f temporal', 'Missing Temporal Docker logs helper.');

assert(
  envSource.includes('TEMPORAL_ADDRESS=localhost:7233') &&
    envSource.includes('TEMPORAL_UI_BASE_URL=http://localhost:8600'),
  'The example environment must match the Docker-published Temporal addresses.',
);
assert(
  temporalConfigSource.includes("const DEFAULT_TEMPORAL_UI_BASE_URL = 'http://localhost:8600';"),
  'The Temporal UI fallback URL must match Docker host port 8600.',
);
assert(
  workflowHealthSource.includes('npm run temporal:server:up'),
  'Workflow health guidance must point operators to the Dockerized Temporal service command.',
);

console.log('[SkyCommand] Temporal Docker service self-test passed.');
