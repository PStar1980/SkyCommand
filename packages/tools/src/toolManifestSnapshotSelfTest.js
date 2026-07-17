const assert = require('assert');
const path = require('path');

const { loadToolManifest } = require('./toolManifestContract');
const {
  SNAPSHOT_STATUS,
  TOOL_MANIFEST_VALIDATOR_VERSION,
  buildManifestSnapshotCandidate,
  buildSnapshotReportRow,
  getSnapshotDrift,
} = require('./toolManifestSnapshotService');

const repositoryRoot = path.resolve(__dirname, '../../..');
const manifestPath = path.join(
  repositoryRoot,
  'packages',
  'ingestion',
  'manifests',
  'ingestion_fred',
  'skycommand.tool.json',
);
const loadedManifest = loadToolManifest(manifestPath, { repositoryRoot });
const registeredTool = {
  tool_id: '00000000-0000-4000-8000-000000000001',
  script_repo_id: '00000000-0000-4000-8000-000000000002',
  tool_code: 'ingestion_fred',
  script_path: 'packages/ingestion/src/loadFREDMacroData.js',
  runtime_code: 'node',
  permission_code: 'INGESTION_RUN_FRED',
};

const candidate = buildManifestSnapshotCandidate({ loadedManifest, registeredTool });

assert.strictEqual(candidate.toolCode, 'ingestion_fred');
assert.strictEqual(candidate.manifestVersion, '1.0');
assert.strictEqual(candidate.outputType, 'macro_ingestion_summary.v1');
assert.strictEqual(candidate.resultRequired, true);
assert.strictEqual(candidate.validatorVersion, TOOL_MANIFEST_VALIDATOR_VERSION);
assert.match(candidate.manifestHash, /^[a-f0-9]{64}$/);
assert.match(candidate.entrypointHash, /^[a-f0-9]{64}$/);
assert.strictEqual(
  candidate.manifestPath,
  'packages/ingestion/manifests/ingestion_fred/skycommand.tool.json',
);

const matchingSnapshot = {
  tool_manifest_snapshot_id: '00000000-0000-4000-8000-000000000003',
  manifest_version: candidate.manifestVersion,
  manifest_path: candidate.manifestPath,
  runtime_type: candidate.runtimeType,
  entrypoint_path: candidate.entrypointPath,
  output_type: candidate.outputType,
  result_required: candidate.resultRequired,
  manifest_hash: candidate.manifestHash,
  entrypoint_hash: candidate.entrypointHash,
  output_schema_hash: candidate.outputSchemaHash,
  contract_sample_hash: candidate.contractSampleHash,
};

const matchingDrift = getSnapshotDrift(matchingSnapshot, candidate);
assert.strictEqual(matchingDrift.status, SNAPSHOT_STATUS.VALID);
assert.strictEqual(matchingDrift.drifted, false);
assert.deepStrictEqual(matchingDrift.mismatches, []);

const changedSnapshot = {
  ...matchingSnapshot,
  manifest_hash: '0'.repeat(64),
};
const changedDrift = getSnapshotDrift(changedSnapshot, candidate);
assert.strictEqual(changedDrift.status, SNAPSHOT_STATUS.DRIFTED);
assert.strictEqual(changedDrift.drifted, true);
assert.strictEqual(changedDrift.mismatches[0].field, 'manifest_hash');

const missingDrift = getSnapshotDrift(null, candidate);
assert.strictEqual(missingDrift.status, SNAPSHOT_STATUS.UNSNAPSHOTTED);

const report = buildSnapshotReportRow({
  loadedManifest,
  registeredTool,
  snapshot: matchingSnapshot,
});
assert.strictEqual(report.status, SNAPSHOT_STATUS.VALID);
assert.strictEqual(report.snapshotId, matchingSnapshot.tool_manifest_snapshot_id);

const registryDriftReport = buildSnapshotReportRow({
  loadedManifest,
  registeredTool: {
    ...registeredTool,
    script_path: 'packages/ingestion/src/notFred.js',
  },
  snapshot: matchingSnapshot,
});
assert.strictEqual(registryDriftReport.status, SNAPSHOT_STATUS.DRIFTED);
assert.strictEqual(registryDriftReport.drifted, true);

const unregisteredReport = buildSnapshotReportRow({ loadedManifest, registeredTool: null });
assert.strictEqual(unregisteredReport.status, SNAPSHOT_STATUS.UNREGISTERED);

console.log('[SkyCommand] Tool manifest snapshot self-test passed.');
