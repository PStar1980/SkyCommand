#!/usr/bin/env node

const { sourceDirectoryForTest } = require('../../../_support/sourceTestBootstrap.js');
const sourceDir = sourceDirectoryForTest(__filename);


const path = require('node:path');
const { spawnSync } = require('node:child_process');

const repoRoot = path.resolve(sourceDir, '../..');
const proofs = [
  ['Host Agent boundary', 'tests/self/packages/host-agent/src/hostAgentSelfTest.js'],
  ['Docker inventory', 'tests/self/packages/host-agent/src/dockerSnapshotSelfTest.js'],
  ['Compose lifecycle control', 'tests/self/packages/host-agent/src/dockerControlSelfTest.js'],
  ['Container inspection/control', 'tests/self/packages/host-agent/src/dockerContainerSelfTest.js'],
  ['Image/volume/network resources', 'tests/self/packages/host-agent/src/dockerResourceSelfTest.js'],
  ['Native event bridge', 'tests/self/packages/host-agent/src/dockerEventBridgeSelfTest.js'],
  ['Event SSE hub', 'tests/self/apps/api/src/services/dockerEventStreamServiceSelfTest.js'],
  ['Resource telemetry bridge', 'tests/self/packages/host-agent/src/dockerTelemetryBridgeSelfTest.js'],
  ['Telemetry SSE hub', 'tests/self/apps/api/src/services/dockerTelemetryStreamServiceSelfTest.js'],
  ['Infrastructure service + audit contracts', 'tests/self/apps/api/src/services/infrastructureServiceSelfTest.js'],
  ['Admin-Web Docker surface + permissions', 'tests/self/apps/admin-web/src/pages/dockerInfrastructureSurfaceSelfTest.js'],
  ['SSE telemetry exclusion policy', 'tests/self/apps/api/src/services/apiTelemetryPolicySelfTest.js'],
  ['In-place ECharts live updates', 'tests/self/apps/admin-web/src/components/charts/liveChartUpdateSelfTest.js'],
  ['Admin-Web Docker/NGINX deployment', 'tests/self/scripts/docker/webDockerSelfTest.js'],
  ['Phase 17 closure records', 'tests/self/scripts/docker/dockerIntegrationClosureSelfTest.js'],
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
