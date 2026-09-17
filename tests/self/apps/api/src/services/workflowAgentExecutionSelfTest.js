const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

process.env.PGHOST = process.env.PGHOST || '127.0.0.1';
process.env.PGUSER = process.env.PGUSER || 'self-test';
process.env.PGPASSWORD = process.env.PGPASSWORD || 'self-test';
process.env.PGDATABASE = process.env.PGDATABASE || 'self-test';

const ROOT = path.resolve(__dirname, '../../../../../..');
const service = require(path.join(ROOT, 'apps/api/src/services/workflowAgentExecutionService'));

function run() {
  const valid = service.normalizeRequest({
    workflowCode: 'repo-map-zip',
    parameters: { repoName: 'SkyCommand' },
    idempotencyKey: 'acceptance-key',
  });
  assert.equal(valid.workflowCode, 'repo-map-zip');
  assert.deepEqual(valid.parameters, { repoName: 'SkyCommand' });
  assert.equal(valid.idempotencyKey, 'acceptance-key');

  assert.throws(
    () => service.normalizeRequest({ ...valid, agentId: 'caller-controlled' }),
    (error) => error.details?.code === 'INVALID_REQUEST',
  );
  assert.throws(() => service.normalizeRequest([]), /JSON object/);
  assert.throws(() => service.normalizeRequest({ ...valid, workflowCode: '' }), /required/);
  assert.throws(() => service.normalizeRequest({ ...valid, idempotencyKey: '' }), /required/);
  assert.throws(() => service.normalizeRequest({ ...valid, parameters: [] }), /JSON object/);
  assert.throws(
    () => service.normalizeRequest({ ...valid, workflowCode: 'bad space' }),
    /unsupported characters/,
  );
  assert.throws(
    () => service.normalizeRequest({ ...valid, idempotencyKey: 'bad\u0000key' }),
    /control characters/,
  );
  assert.throws(
    () => service.normalizeRequest({ ...valid, idempotencyKey: 'x'.repeat(201) }),
    /maximum length/,
  );
  assert.throws(
    () => service.normalizeRequest({ ...valid, parameters: { value: 'x'.repeat(70000) } }),
    /request size limit/,
  );

  assert.equal(service.canonicalJson({ b: 2, a: 1 }), '{"a":1,"b":2}');
  assert.equal(
    service.canonicalJson({ outer: { z: 1, a: [{ d: 2, c: 1 }] } }),
    '{"outer":{"a":[{"c":1,"d":2}],"z":1}}',
  );
  assert.equal(service.getRiskPermission('low'), 'CORE_RUN_LOW_RISK_SCRIPT');
  assert.equal(service.getRiskPermission('medium'), 'CORE_RUN_MEDIUM_RISK_SCRIPT');
  assert.equal(service.getRiskPermission('high'), 'CORE_RUN_HIGH_RISK_SCRIPT');
  assert.equal(service.getRiskPermission('unknown'), null);
  assert.equal(service.containsSecretLikeKey({ token: 'redacted' }), true);
  assert.equal(service.containsSecretLikeKey({ nested: { password: 'redacted' } }), true);
  assert.equal(service.containsSecretLikeKey({ repoName: 'SkyCommand' }), false);
  assert.deepEqual(service.permissionRows(['WORKFLOW_RUN', 'WORKFLOW_RUN', '']), [
    { permissionCode: 'WORKFLOW_RUN', permission_code: 'WORKFLOW_RUN' },
  ]);
  assert.equal(service.getProfileCode({}), 'DEV_LOCAL');
  assert.equal(
    service.getEnvironmentCode({ SKYCOMMAND_ENVIRONMENT_CODE: 'dev_local' }),
    'DEV_LOCAL',
  );

  const contract = service.getParameterContract({
    config: {
      runtimeParameters: [
        { key: 'repoName', type: 'repo', required: true, maxLength: 80 },
        { key: 'includeTests', type: 'boolean', required: false },
      ],
    },
  });
  assert.deepEqual(contract[0], {
    key: 'repoName',
    type: 'repo',
    required: true,
    optionSourceCode: null,
    maxLength: 80,
  });
  assert.equal(contract[1].type, 'boolean');
  assert.equal(contract.length, 2);
  assert.match(service.normalizeSafeMessage('C:\\Users\\pauls\\secret.txt'), /path-redacted/);
  assert.equal(service.normalizeSafeMessage('x'.repeat(2000), 100).length, 100);

  const capability = service.getCapabilitySummary();
  assert.equal(capability.capability, 'skycommand_workflow_agent_execution');
  assert.equal(capability.contractVersion, 'skycommand_workflow_agent_execution.v1');
  assert.equal(capability.principalResolution, 'server_side_only');
  assert.equal(capability.pinnedVersionAtAdmission, true);
  assert.equal(capability.callerScopedIdempotency, true);
  assert.equal(capability.staticAuthorityClosure, true);
  assert.ok(capability.endpoints.assistantStart.includes('/api/assistant/workflow-runs'));
  assert.ok(capability.endpoints.apiRead.includes('/api/workflows/agent/workflow-runs'));

  const migration = fs.readFileSync(
    path.join(
      ROOT,
      'packages/db_build/src/migrations/00138__governed_workflow_agent_execution.sql',
    ),
    'utf8',
  );
  assert.ok(migration.includes('workflow_execution_principals'));
  assert.ok(migration.includes('workflow_execution_resource_grants'));
  assert.ok(migration.includes('workflow_execution_admissions'));
  assert.ok(migration.includes("'assistant-http'"));
  assert.ok(migration.includes("'repo-map-zip'"));
  assert.ok(migration.includes("'DEV_LOCAL'"));
  assert.ok(migration.includes('WORKFLOW_RUN'));
  assert.ok(migration.includes('pinnedVersionNumber'));
  assert.ok(!migration.includes("'*'"));

  const executor = fs.readFileSync(
    path.join(ROOT, 'apps/api/src/services/workflowExecutorService.js'),
    'utf8',
  );
  assert.ok(executor.includes('rejectUnknown = false'));
  assert.ok(executor.includes('workflowVersionId = null'));
  assert.ok(executor.includes('workflowRunRecordId = null'));
  assert.ok(executor.includes('COALESCE($1::uuid, gen_random_uuid())'));

  console.log('[workflow-agent-execution:self-test] PASS (35 assertions)');
}

run();
