'use strict';

const assert = require('assert');
const {
  coerceWorkflowRuntimeParameterValue,
  getWorkflowRuntimeParameterDefinitions,
  getWorkflowRuntimeParameterReference,
  mergeWorkflowRuntimeParameters,
} = require('./workflowCliRuntimeParameters');

function run() {
  const definitions = getWorkflowRuntimeParameterDefinitions({
    runtimeParameters: [
      {
        key: 'commitMessage',
        label: 'Commit message',
        type: 'string',
        required: true,
        maxLength: 300,
        displayOrder: 10,
      },
      {
        key: 'attempts',
        label: 'Attempts',
        type: 'number',
        defaultValue: 2,
        displayOrder: 20,
      },
      {
        key: 'pushEnabled',
        label: 'Push enabled',
        type: 'boolean',
        defaultValue: true,
        displayOrder: 30,
      },
      {
        key: 'mode',
        label: 'Mode',
        type: 'select',
        options: [
          { label: 'Safe', value: 'safe' },
          { label: 'Fast', value: 'fast' },
        ],
        displayOrder: 40,
      },
      {
        key: 'metadata',
        label: 'Metadata',
        type: 'json',
        displayOrder: 50,
      },
    ],
  });

  assert.deepStrictEqual(
    definitions.map((parameter) => parameter.key),
    ['commitMessage', 'attempts', 'pushEnabled', 'mode', 'metadata'],
  );
  assert.strictEqual(
    coerceWorkflowRuntimeParameterValue('Phase 14 CLI runtime params', definitions[0]),
    'Phase 14 CLI runtime params',
  );
  assert.strictEqual(coerceWorkflowRuntimeParameterValue('', definitions[1]), 2);
  assert.strictEqual(coerceWorkflowRuntimeParameterValue('yes', definitions[2]), true);
  assert.strictEqual(coerceWorkflowRuntimeParameterValue('safe', definitions[3]), 'safe');
  assert.deepStrictEqual(coerceWorkflowRuntimeParameterValue('{"ok":true}', definitions[4]), {
    ok: true,
  });
  assert.throws(
    () => coerceWorkflowRuntimeParameterValue('', definitions[0]),
    /Commit message is required/,
  );
  assert.throws(
    () => coerceWorkflowRuntimeParameterValue('unknown', definitions[3]),
    /must be one of/,
  );
  assert.strictEqual(
    getWorkflowRuntimeParameterReference('commitMessage'),
    '{{ params.commitMessage }}',
  );
  assert.deepStrictEqual(
    mergeWorkflowRuntimeParameters(
      {
        runSource: 'manual',
        params: { existing: 'kept', commitMessage: 'old' },
      },
      { commitMessage: 'new' },
    ),
    {
      runSource: 'manual',
      params: { existing: 'kept', commitMessage: 'new' },
      runtimeParameters: { existing: 'kept', commitMessage: 'new' },
    },
  );

  console.log('[SkyCommand] Workflow CLI runtime parameter self-test passed.');
}

run();
