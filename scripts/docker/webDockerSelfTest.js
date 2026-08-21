const fs = require('node:fs');
const path = require('node:path');

function assert(condition, message) {
  if (!condition) {
    throw new Error(`[SkyCommand Web Docker self-test] ${message}`);
  }
}

const root = path.resolve(__dirname, '..', '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');
const compose = read('compose.yaml');
const dockerfile = read('docker/web.Dockerfile');
const nginx = read('docker/web.nginx.conf');
const viteConfig = read('apps/admin-web/vite.config.js');
const webPackage = JSON.parse(read('docker/web.package.json'));
const helper = read('scripts/docker/webDocker.js');
const packageJson = JSON.parse(read('package.json'));
const validate = read('scripts/validate.js');
const dockerIntegration = read('scripts/docker/dockerIntegrationSelfTest.js');

assert(
  compose.includes('web:') &&
    compose.includes('dockerfile: docker/web.Dockerfile') &&
    compose.includes('127.0.0.1:${SKYCOMMAND_WEB_PORT:-15171}:8080') &&
    compose.includes('condition: service_healthy') &&
    compose.includes("wget -q -O /dev/null http://127.0.0.1:8080/healthz") &&
    compose.includes('read_only: true') &&
    compose.includes('no-new-privileges:true') &&
    compose.includes('cap_drop:'),
  'Compose must publish Web locally, wait for the API health contract, health-check NGINX, and apply the read-only/non-root hardening boundary.',
);
assert(
  dockerfile.includes('FROM node:20-bookworm-slim AS web-dependencies') &&
    dockerfile.includes('COPY docker/web.package.json ./package.json') &&
    dockerfile.includes('VITE_API_BASE_URL=""') &&
    dockerfile.includes('./node_modules/.bin/vite build --config apps/admin-web/vite.config.js') &&
    dockerfile.includes('FROM nginxinc/nginx-unprivileged:1.31.3-alpine3.24 AS web-runtime') &&
    dockerfile.includes('/usr/share/nginx/html') &&
    dockerfile.includes('EXPOSE 8080'),
  'The Web image must use an isolated Vite build, same-origin API configuration, and a pinned unprivileged NGINX runtime.',
);
for (const dependency of [
  'bootstrap',
  'd3-array',
  'd3-time',
  'd3-time-format',
  'echarts',
  'react',
  'react-dom',
  'react-router-dom',
]) {
  assert(webPackage.dependencies?.[dependency], `Web build dependency is missing: ${dependency}`);
}
for (const dependency of ['@vitejs/plugin-react', 'vite']) {
  assert(webPackage.devDependencies?.[dependency], `Web build development dependency is missing: ${dependency}`);
}
assert(
  nginx.includes('resolver 127.0.0.11 valid=10s ipv6=off;') &&
    nginx.includes('set $skycommand_api api:7171;') &&
    nginx.includes('location ^~ /api/') &&
    nginx.includes('location = /api/infrastructure/providers/docker/events/stream') &&
    nginx.includes('location = /api/infrastructure/providers/docker/telemetry/stream') &&
    nginx.match(/proxy_buffering off;/g)?.length >= 2 &&
    nginx.includes('location = /_health') &&
    nginx.includes('location ^~ /_db/') &&
    nginx.includes('proxy_pass http://$skycommand_api;') &&
    nginx.includes('try_files $uri $uri/ /index.html;') &&
    nginx.includes('Cache-Control "public, max-age=31536000, immutable"') &&
    nginx.includes('Cache-Control "no-store"'),
  'NGINX must use Docker DNS for API proxying, preserve the same-origin API routes, support SPA routing, and separate immutable asset caching from the HTML shell.',
);
assert(
  viteConfig.includes("process.env.SKYCOMMAND_WEB_PORT || env.SKYCOMMAND_WEB_PORT || '15171'") &&
    viteConfig.includes('port: resolveWebPort(mode)') &&
    viteConfig.includes('strictPort: true'),
  'Host Vite must use the same configurable canonical Admin-Web port as Docker.',
);
assert(
  helper.includes("process.env.SKYCOMMAND_WEB_PORT || '15171'") &&
    helper.includes("'netsh'") &&
    helper.includes("'excludedportrange'") &&
    helper.includes('assertWebPortIsBindable(port)') &&
    helper.includes("'postgres'") &&
    helper.includes("'temporal-worker'") &&
    helper.includes("'node-worker'") &&
    helper.includes("'api'") &&
    helper.includes("'web'") &&
    helper.includes("case 'stack-restart':") &&
    helper.includes("'--force-recreate'"),
  'The Web Docker helper must validate the host Web port and support full six-service stack startup plus rebuild/recreate restart including PostgreSQL.',
);

const scripts = packageJson.scripts || {};
for (const scriptName of [
  'web:docker:up',
  'web:docker:stop',
  'web:docker:restart',
  'web:docker:status',
  'web:docker:logs',
  'skycommand:docker:up',
  'skycommand:docker:restart',
  'skycommand:docker:stop',
  'skycommand:docker:status',
  'skycommand:docker:logs',
  'web-docker:self-test',
]) {
  assert(scripts[scriptName], `Missing npm script: ${scriptName}`);
}
assert(
  validate.includes("'docker-integration:self-test'") &&
    dockerIntegration.includes('scripts/docker/webDockerSelfTest.js'),
  'Routine validation must include the Web Docker proof through the consolidated Docker integration suite.',
);

console.log('[SkyCommand] Web Docker foundation self-test passed.');
