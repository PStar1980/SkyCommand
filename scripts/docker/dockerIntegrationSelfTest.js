#!/usr/bin/env node

const path = require('node:path');
const { spawnSync } = require('node:child_process');

const repoRoot = path.resolve(__dirname, '../..');
const proofs = [
  ['Host Agent boundary', 'packages/host-agent/src/hostAgentSelfTest.js'],
  ['Docker inventory', 'packages/host-agent/src/dockerSnapshotSelfTest.js'],
  ['Compose lifecycle control', 'packages/host-agent/src/dockerControlSelfTest.js'],
  ['Container inspection/control', 'packages/host-agent/src/dockerContainerSelfTest.js'],
  ['Image/volume/network resources', 'packages/host-agent/src/dockerResourceSelfTest.js'],
  ['Native event bridge', 'packages/host-agent/src/dockerEventBridgeSelfTest.js'],
  ['Event SSE hub', 'apps/api/src/services/dockerEventStreamServiceSelfTest.js'],
  ['Resource telemetry bridge', 'packages/host-agent/src/dockerTelemetryBridgeSelfTest.js'],
  ['Telemetry SSE hub', 'apps/api/src/services/dockerTelemetryStreamServiceSelfTest.js'],
  ['Infrastructure service + audit contracts', 'apps/api/src/services/infrastructureServiceSelfTest.js'],
  ['Admin-Web Docker surface + permissions', 'apps/admin-web/src/pages/dockerInfrastructureSurfaceSelfTest.js'],
  ['SSE telemetry exclusion policy', 'apps/api/src/services/apiTelemetryPolicySelfTest.js'],
  ['In-place ECharts live updates', 'apps/admin-web/src/components/charts/liveChartUpdateSelfTest.js'],
  ['Admin-Web Docker/NGINX deployment', 'scripts/docker/webDockerSelfTest.js'],
  ['Phase 17 closure records', 'scripts/docker/dockerIntegrationClosureSelfTest.js'],
];

function runProof(label, relativePath, index) {
  console.log(`[docker-integration] ${index + 1}/${proofs.length}: ${label}`);
  const result = spawnSync(process.execPath, [path.join(repoRoot, relativePath)], {
    cwd: repoRoot,
    env: process.env,
    stdio: 'inherit',
  });

  if (result.error) {
    throw new Error(`${label} could not start: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(`${label} failed with exit code ${result.status}.`);
  }
}

try {
  console.log(`\n[docker-integration] Consolidated Phase 17 proofs: ${proofs.length}`);
  proofs.forEach(([label, relativePath], index) => runProof(label, relativePath, index));
  console.log('\n✅ SkyCommand Docker integration self-test passed.');
} catch (error) {
  console.error(`\n❌ ${error.message}`);
  process.exitCode = 1;
}
