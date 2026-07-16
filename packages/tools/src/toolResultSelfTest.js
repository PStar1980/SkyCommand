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

    const requiredTransport = createToolResultTransport({
      executionId: 'required-self-test',
      toolCode: 'required_tool',
      required: true,
      rootDirectory: temporaryRoot,
    });
    assert.throws(
      () => requiredTransport.readResult(),
      (error) => error instanceof ToolResultContractError && error.code === 'TOOL_RESULT_MISSING',
    );
    requiredTransport.cleanup();


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

    console.log('[SkyCommand] ToolResult contract and process-adapter self-test passed.');
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

runSelfTest().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
