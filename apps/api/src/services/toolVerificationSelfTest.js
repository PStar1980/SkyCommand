process.env.PGHOST = process.env.PGHOST || '127.0.0.1';
process.env.PGPORT = process.env.PGPORT || '5432';
process.env.PGDATABASE = process.env.PGDATABASE || 'skycommand_self_test';
process.env.PGUSER = process.env.PGUSER || 'skycommand_self_test';
process.env.PGPASSWORD = process.env.PGPASSWORD || 'skycommand_self_test';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { validateToolResult } = require('../../../../packages/tools/src/toolResultContract');
const { createRepresentativeOutputFromSchema } = require('./toolVerificationService');

function readJson(filename) {
  return JSON.parse(fs.readFileSync(path.resolve(process.cwd(), filename), 'utf8'));
}

function run() {
  const schema = readJson(
    'packages/tools/custom/_template/example_greeting_summary.v1.schema.json',
  );
  const sample = createRepresentativeOutputFromSchema(schema);

  assert.strictEqual(typeof sample, 'object');
  assert.ok(sample.name);
  assert.ok(sample.greeting);
  assert.ok(sample.generatedAt);

  const validated = validateToolResult(
    {
      schemaVersion: '1.0',
      success: true,
      message: 'Representative managed-tool contract check.',
      outputType: 'example_greeting_summary.v1',
      output: sample,
      warnings: [],
      error: null,
      metadata: { contractCheck: true },
    },
    {
      expectedOutputType: 'example_greeting_summary.v1',
      outputSchema: schema,
    },
  );

  assert.strictEqual(validated.success, true);
  assert.strictEqual(validated.outputType, 'example_greeting_summary.v1');

  const localReferenceSchema = {
    type: 'object',
    required: ['status'],
    properties: {
      status: { $ref: '#/$defs/status' },
    },
    $defs: {
      status: { type: 'string', enum: ['READY', 'BLOCKED'] },
    },
    additionalProperties: false,
  };
  assert.deepStrictEqual(createRepresentativeOutputFromSchema(localReferenceSchema), {
    status: 'READY',
  });

  const executionSource = fs.readFileSync(
    path.resolve(process.cwd(), 'apps/api/src/services/scriptExecutionService.js'),
    'utf8',
  );
  assert.ok(executionSource.includes('runManagedToolTest'));
  assert.ok(!/previewFingerprint|file_hash|fileHash|sha256/i.test(executionSource));

  console.log('Managed tool verification and contract-sample self-test passed.');
}

run();
