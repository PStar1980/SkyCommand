#!/usr/bin/env node

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const {
  TOOL_EXECUTION_FAILED_STATUS_CODE,
  buildToolExecutionHttpResponse,
  getToolExecutionFailureMessage,
} = require('./toolExecutionHttpResponse');

function run() {
  const successfulExecution = {
    executionId: 'success-execution',
    toolCode: 'repo_map_generate',
    label: 'Generate Repository Map',
    status: 'SUCCESS',
    summary: 'Repository map was created successfully.',
  };
  const successfulResponse = buildToolExecutionHttpResponse(successfulExecution);

  assert.strictEqual(successfulResponse.statusCode, 200);
  assert.deepStrictEqual(successfulResponse.body, {
    ok: true,
    execution: successfulExecution,
  });

  const failedExecution = {
    executionId: 'failed-execution',
    toolCode: 'main_merge',
    label: 'Main Merge',
    status: 'FAILED',
    summary:
      'Main Merge requires a clean working tree. Complete or stash local changes before branch synchronization.',
    stderr: 'Detailed stack trace retained in Tool History.',
  };
  const failedResponse = buildToolExecutionHttpResponse(failedExecution);

  assert.strictEqual(failedResponse.statusCode, TOOL_EXECUTION_FAILED_STATUS_CODE);
  assert.strictEqual(failedResponse.body.ok, false);
  assert.strictEqual(failedResponse.body.error, failedExecution.summary);
  assert.strictEqual(failedResponse.body.execution, failedExecution);
  assert.strictEqual(
    getToolExecutionFailureMessage({ label: 'Example Tool', status: 'FAILED' }),
    'Example Tool execution failed.',
  );

  const controllerPath = path.resolve(__dirname, '../controllers/toolsController.js');
  const controllerSource = fs.readFileSync(controllerPath, 'utf8');

  assert.match(
    controllerSource,
    /buildToolExecutionHttpResponse\(result\)/,
    'The tools controller must build the explicit success/failure response contract.',
  );
  assert.match(
    controllerSource,
    /res\.status\(response\.statusCode\)\.json\(response\.body\)/,
    'The tools controller must return the response contract status code and body.',
  );

  const toolsPagePath = path.resolve(__dirname, '../../../admin-web/src/pages/Tools.jsx');
  const toolsPageSource = fs.readFileSync(toolsPagePath, 'utf8');

  assert.match(
    toolsPageSource,
    /runError\?\.payload\?\.execution/,
    'Run Tools must recover the failed execution from the API error payload.',
  );
  assert.match(
    toolsPageSource,
    /setRunResult\(failedExecution\)/,
    'Run Tools must still display the persisted failed execution details.',
  );

  console.log('[SkyCommand] Graceful failed-tool HTTP response self-test passed.');
}

run();
