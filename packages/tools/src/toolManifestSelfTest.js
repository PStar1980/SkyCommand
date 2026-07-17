const assert = require('assert');
const path = require('path');

const { validateJsonSchema } = require('./jsonSchemaValidator');
const { runToolCli } = require('./toolCliAdapter');
const {
  ToolManifestContractError,
  getSkyServerRoot,
  loadToolManifest,
  normalizeManifest,
} = require('./toolManifestContract');
const { validateToolResult } = require('./toolResultContract');
const { validateToolManifests } = require('./toolManifestCli');
const { getRegisteredToolExecutionContract } = require('./toolManifestRegistry');

async function run() {
  const repositoryRoot = getSkyServerRoot();
  const reports = validateToolManifests({ repositoryRoot });

  assert.deepStrictEqual(reports.map((report) => report.toolCode).sort(), [
    'dev_commit',
    'ingestion_boc',
    'ingestion_fred',
    'ingestion_statcan',
    'repo_map_generate',
    'repo_zip_generate',
  ]);
  assert.ok(reports.every((report) => report.schemaValidated));
  assert.ok(reports.every((report) => report.sampleSuccess));

  assert.throws(
    () =>
      normalizeManifest({
        manifestVersion: '1.0',
        toolCode: 'bad_tool',
        displayName: 'Bad Tool',
        runtime: { type: 'node', entrypoint: '../outside.js' },
        parameters: [],
        resultContract: { required: true, outputType: 'bad_result.v1' },
        permissions: ['BAD_TOOL_RUN'],
        execution: {},
      }),
    (error) =>
      error instanceof ToolManifestContractError && error.code === 'TOOL_MANIFEST_PATH_TRAVERSAL',
  );

  assert.throws(
    () =>
      normalizeManifest({
        manifestVersion: '1.0',
        toolCode: 'secret_tool',
        displayName: 'Secret Tool',
        runtime: { type: 'node', entrypoint: 'packages/tools/src/toolManifestSelfTest.js' },
        parameters: [
          {
            name: 'token',
            label: 'Token',
            type: 'string',
            required: true,
            secret: true,
            binding: { mode: 'argv_flag', flag: '--token' },
          },
        ],
        resultContract: { required: true, outputType: 'secret_result.v1' },
        permissions: ['SECRET_TOOL_RUN'],
        execution: {},
      }),
    (error) =>
      error instanceof ToolManifestContractError &&
      error.code === 'TOOL_MANIFEST_SECRET_ARGV_FORBIDDEN',
  );

  const fredManifestPath = path.join(
    repositoryRoot,
    'packages',
    'ingestion',
    'manifests',
    'ingestion_fred',
    'skycommand.tool.json',
  );
  const loadedFred = loadToolManifest(fredManifestPath, { repositoryRoot });
  const acceptedSnapshot = {
    tool_manifest_snapshot_id: '00000000-0000-4000-8000-000000000010',
    manifest_snapshot_status: 'VALID',
    manifest_version: loadedFred.manifest.manifestVersion,
    manifest_path: path.relative(repositoryRoot, loadedFred.manifestPath).replace(/\\/g, '/'),
    manifest_runtime_type: loadedFred.manifest.runtime.type,
    manifest_entrypoint_path: loadedFred.manifest.runtime.entrypoint,
    manifest_output_type: loadedFred.manifest.resultContract.outputType,
    manifest_result_required: loadedFred.manifest.resultContract.required,
    manifest_hash: loadedFred.hashes.manifest,
    entrypoint_hash: loadedFred.hashes.entrypoint,
    output_schema_hash: loadedFred.hashes.outputSchema,
    contract_sample_hash: loadedFred.hashes.sample,
  };
  const executionContract = getRegisteredToolExecutionContract(
    {
      tool_code: 'ingestion_fred',
      script_path: 'packages/ingestion/src/loadFREDMacroData.js',
      runtime_code: 'node',
      permission_code: 'INGESTION_RUN_FRED',
      ...acceptedSnapshot,
    },
    { repositoryRoot, forceReload: true },
  );

  assert.strictEqual(executionContract.expectedOutputType, 'macro_ingestion_summary.v1');
  assert.strictEqual(executionContract.resultRequired, true);
  assert.ok(executionContract.outputSchema);

  assert.throws(
    () =>
      getRegisteredToolExecutionContract(
        {
          tool_code: 'ingestion_fred',
          script_path: 'packages/ingestion/src/not-the-fred-script.js',
          runtime_code: 'node',
          permission_code: 'INGESTION_RUN_FRED',
          ...acceptedSnapshot,
        },
        { repositoryRoot },
      ),
    (error) => error.code === 'TOOL_MANIFEST_REGISTRY_DRIFT',
  );

  assert.throws(
    () =>
      getRegisteredToolExecutionContract(
        {
          tool_code: 'ingestion_fred',
          script_path: 'packages/ingestion/src/loadFREDMacroData.js',
          runtime_code: 'node',
          permission_code: 'INGESTION_RUN_FRED',
        },
        { repositoryRoot },
      ),
    (error) => error.code === 'TOOL_MANIFEST_SNAPSHOT_REQUIRED',
  );

  assert.throws(
    () =>
      getRegisteredToolExecutionContract(
        {
          tool_code: 'ingestion_fred',
          script_path: 'packages/ingestion/src/loadFREDMacroData.js',
          runtime_code: 'node',
          permission_code: 'INGESTION_RUN_FRED',
          ...acceptedSnapshot,
          manifest_hash: '0'.repeat(64),
        },
        { repositoryRoot },
      ),
    (error) => error.code === 'TOOL_MANIFEST_SNAPSHOT_DRIFT',
  );

  const invalidOutput = JSON.parse(JSON.stringify(loadedFred.sampleToolResult));
  invalidOutput.output.totals.rowsInserted = -1;

  assert.throws(
    () =>
      validateToolResult(invalidOutput, {
        expectedOutputType: loadedFred.manifest.resultContract.outputType,
        outputSchema: loadedFred.outputSchema,
      }),
    (error) => error.code === 'TOOL_RESULT_OUTPUT_SCHEMA_INVALID',
  );

  const schemaReport = validateJsonSchema(
    loadedFred.sampleToolResult.output,
    loadedFred.outputSchema,
    { throwOnError: false },
  );
  assert.strictEqual(schemaReport.valid, true);

  let executeCount = 0;
  const describeLines = [];
  const describeResult = await runToolCli({
    manifestPath: fredManifestPath,
    repositoryRoot,
    args: ['--skycommand-describe'],
    execute: async () => {
      executeCount += 1;
      throw new Error('describe mode must not execute the tool');
    },
    createToolResult: () => loadedFred.sampleToolResult,
    writer: (value) => describeLines.push(value),
    logger: () => {},
    setExitCode: () => {},
  });

  assert.strictEqual(describeResult.mode, 'describe');
  assert.strictEqual(executeCount, 0);
  assert.strictEqual(describeLines.length, 1);

  const emitted = [];
  const contractLines = [];
  const contractResult = await runToolCli({
    manifestPath: fredManifestPath,
    repositoryRoot,
    args: ['--skycommand-contract-check'],
    execute: async () => {
      executeCount += 1;
      throw new Error('contract-check mode must not execute the tool');
    },
    createToolResult: () => loadedFred.sampleToolResult,
    emitResult: (toolResult, options) => {
      emitted.push({ toolResult, options });
      return { emitted: true };
    },
    writer: (value) => contractLines.push(value),
    logger: () => {},
    setExitCode: () => {},
  });

  assert.strictEqual(contractResult.mode, 'contract_check');
  assert.strictEqual(executeCount, 0);
  assert.strictEqual(emitted.length, 1);
  assert.strictEqual(emitted[0].options.expectedOutputType, 'macro_ingestion_summary.v1');
  assert.ok(emitted[0].options.outputSchema);
  assert.strictEqual(contractLines.length, 1);

  const repositoryZipManifestPath = path.join(
    repositoryRoot,
    'packages',
    'files',
    'manifests',
    'repo_zip_generate',
    'skycommand.tool.json',
  );
  const loadedRepositoryZip = loadToolManifest(repositoryZipManifestPath, { repositoryRoot });
  assert.strictEqual(
    loadedRepositoryZip.manifest.resultContract.outputType,
    'repository_package_summary.v1',
  );
  assert.strictEqual(loadedRepositoryZip.manifest.permissions[0], 'REPO_ZIP_GENERATE');
  assert.strictEqual(loadedRepositoryZip.sampleToolResult.output.filesIncluded, 412);

  const loadedRepositoryMap = loadToolManifest(
    path.join(
      repositoryRoot,
      'packages',
      'files',
      'manifests',
      'repo_map_generate',
      'skycommand.tool.json',
    ),
    { repositoryRoot },
  );
  assert.strictEqual(
    loadedRepositoryMap.manifest.resultContract.outputType,
    'repository_map_summary.v1',
  );
  assert.strictEqual(loadedRepositoryMap.sampleToolResult.output.filesDocumented, 468);

  const loadedDevCommit = loadToolManifest(
    path.join(repositoryRoot, 'packages', 'git', 'manifests', 'dev_commit', 'skycommand.tool.json'),
    { repositoryRoot },
  );
  assert.strictEqual(loadedDevCommit.manifest.resultContract.outputType, 'git_commit_summary.v1');
  assert.strictEqual(loadedDevCommit.sampleToolResult.output.outcome, 'PUSHED');

  console.log('[SkyCommand] Tool manifest and contract-check self-test passed.');
}

run().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exitCode = 1;
});
