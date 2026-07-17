const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  TOOL_RESULT_FILE_EXTENSION,
  TOOL_RESULT_SCHEMA_VERSION,
  ToolResultContractError,
  createLegacyToolResult,
  createToolResultTransport,
  executeToolProcess,
  runToolCli,
  validateToolResult,
  writeToolResult,
} = require('./index');

async function runSelfTest() {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'skycommand-tool-result-'));

  try {
    const validResult = validateToolResult({
      schemaVersion: TOOL_RESULT_SCHEMA_VERSION,
      success: true,
      message: 'Self-test completed.',
      outputType: 'tool_result_self_test.v1',
      output: {
        customValue: 42,
        nested: { ready: true },
      },
      warnings: [],
      error: null,
      metadata: { test: true },
    });

    const transport = createToolResultTransport({
      executionId: 'self-test-execution',
      toolCode: 'self_test_tool',
      required: true,
      rootDirectory: temporaryRoot,
    });

    assert.equal(path.extname(transport.resultPath), TOOL_RESULT_FILE_EXTENSION);

    writeToolResult(validResult, {
      resultPath: transport.resultPath,
      resultDirectory: transport.resultDirectory,
      maxBytes: transport.maxBytes,
    });

    const readResult = transport.readResult();
    assert.equal(readResult.status, 'VALID');
    assert.equal(readResult.toolResult.output.customValue, 42);
    transport.cleanup();
    assert.equal(fs.existsSync(transport.resultPath), false);

    const optionalTransport = createToolResultTransport({
      executionId: 'optional-self-test',
      toolCode: 'optional_tool',
      required: false,
      rootDirectory: temporaryRoot,
    });
    assert.equal(optionalTransport.readResult().status, 'NOT_EMITTED');
    optionalTransport.cleanup();

    const formerlyRequiredTransport = createToolResultTransport({
      executionId: 'formerly-required-self-test',
      toolCode: 'formerly_required_tool',
      required: true,
      rootDirectory: temporaryRoot,
    });
    assert.equal(formerlyRequiredTransport.readResult().status, 'NOT_EMITTED');
    assert.equal(formerlyRequiredTransport.required, false);
    formerlyRequiredTransport.cleanup();


    assert.throws(
      () => createToolResultTransport({
        executionId: 'escaped-self-test',
        toolCode: 'escaped-tool',
        rootDirectory: temporaryRoot,
        resultDirectory: path.resolve(temporaryRoot, '..', 'outside-tool-results'),
      }),
      (error) => (
        error instanceof ToolResultContractError
        && error.code === 'TOOL_RESULT_PATH_OUTSIDE_ROOT'
      ),
    );

    const legacyResult = createLegacyToolResult({
      executionId: 'legacy-execution',
      toolCode: 'legacy-tool',
      status: 'SUCCESS',
    });
    assert.equal(legacyResult.output.structuredOutputAvailable, false);

    const fixturePath = path.join(temporaryRoot, 'structured-result-fixture.js');
    const sdkPath = path.resolve(__dirname, 'index.js');
    fs.writeFileSync(
      fixturePath,
      `const { writeToolResult } = require(${JSON.stringify(sdkPath)});\n`
        + "console.log('Human-readable fixture log.');\n"
        + 'writeToolResult({'
        + "schemaVersion:'1.0',"
        + 'success:true,'
        + "message:'Fixture succeeded.',"
        + "outputType:'fixture_result.v1',"
        + 'output:{answer:42},'
        + 'warnings:[],'
        + 'error:null,'
        + 'metadata:{fixture:true}'
        + '});\n',
      'utf8',
    );

    const processResult = await executeToolProcess({
      command: process.execPath,
      commandArgs: [fixturePath],
      cwd: temporaryRoot,
      executionId: 'process-self-test',
      toolCode: 'process_fixture',
      toolResultRequired: true,
      rootDirectory: temporaryRoot,
      timeoutMs: 10000,
    });

    assert.equal(processResult.status, 'SUCCESS');
    assert.equal(processResult.processStatus, 'SUCCESS');
    assert.equal(processResult.toolResultContract.status, 'VALID');
    assert.equal(processResult.toolResult.output.answer, 42);
    assert.match(processResult.stdout, /Human-readable fixture log/);

    const noResultFixturePath = path.join(temporaryRoot, 'no-result-fixture.js');
    fs.writeFileSync(
      noResultFixturePath,
      "console.log('Business operation completed without structured output.');\n",
      'utf8',
    );
    const noResultProcess = await executeToolProcess({
      command: process.execPath,
      commandArgs: [noResultFixturePath],
      cwd: temporaryRoot,
      executionId: 'no-result-process-self-test',
      toolCode: 'no_result_fixture',
      toolResultRequired: true,
      rootDirectory: temporaryRoot,
      timeoutMs: 10000,
    });
    assert.equal(noResultProcess.status, 'SUCCESS');
    assert.equal(noResultProcess.processStatus, 'SUCCESS');
    assert.equal(noResultProcess.toolResultContract.status, 'NOT_EMITTED');
    assert.equal(noResultProcess.toolResultContract.required, false);

    const unavailableTransportRoot = path.join(temporaryRoot, 'transport-root-is-a-file');
    fs.writeFileSync(unavailableTransportRoot, 'not a directory', 'utf8');
    const unavailableTransportProcess = await executeToolProcess({
      command: process.execPath,
      commandArgs: [noResultFixturePath],
      cwd: temporaryRoot,
      executionId: 'unavailable-transport-self-test',
      toolCode: 'unavailable_transport_fixture',
      rootDirectory: unavailableTransportRoot,
      timeoutMs: 10000,
    });
    assert.equal(unavailableTransportProcess.status, 'SUCCESS');
    assert.equal(unavailableTransportProcess.processStatus, 'SUCCESS');
    assert.equal(unavailableTransportProcess.toolResultContract.status, 'INVALID');
    assert.ok(unavailableTransportProcess.toolResultContract.error);
    assert.match(unavailableTransportProcess.stdout, /Business operation completed/);

    const failOpenExitCodes = [];
    const failOpenResult = await runToolCli({
      toolCode: 'fail_open_fixture',
      outputType: 'fail_open_fixture.v1',
      args: [],
      execute: async () => ({ ok: true, artifactPath: 'fixture.txt' }),
      createToolResult: () => ({
        schemaVersion: '1.0',
        success: true,
        message: 'Artifact created.',
        outputType: 'fail_open_fixture.v1',
        output: { artifactPath: 'fixture.txt' },
        warnings: [],
        error: null,
        metadata: {},
      }),
      emitResult: () => {
        throw new Error('simulated result transport failure');
      },
      setExitCode: (code) => failOpenExitCodes.push(code),
      logger: () => {},
    });
    assert.equal(failOpenResult.result.ok, true);
    assert.equal(failOpenResult.toolResult.success, true);
    assert.match(failOpenResult.structuredResultWarning.message, /simulated result transport failure/);
    assert.deepEqual(failOpenExitCodes, []);

    console.log('[SkyCommand] ToolResult contract and process-adapter self-test passed.');
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

runSelfTest().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
