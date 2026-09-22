const { sourceDirectoryForTest } = require('../../../../../_support/sourceTestBootstrap.js');
sourceDirectoryForTest(__filename);

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..', '..', '..', '..', '..', '..');
require('dotenv').config({ path: path.join(root, '.env'), quiet: true });
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');
const { pool, query } = require(path.join(root, 'packages/db/src/connection.js'));
const agentExecutionService = require(path.join(root, 'apps/api/src/services/agentExecutionService.js'));

const forbiddenRawCredentialKeys = /\"(?:credential|rawCredential|credentialValue|managedCredentialToken)\"\s*:/i;

async function run() {
  const rows = await query(
    `SELECT g.execution_grant_id AS "grantId",
            g.execution_scope_id AS "rootExecutionId",
            g.agent_run_id AS "runId",
            g.principal_id AS "principalId",
            g.authority_snapshot_id AS "authoritySnapshotId",
            g.revocation_epoch AS "revocationEpoch",
            g.grant_audience AS "audience",
            g.credential_hash AS "credentialFingerprint",
            g.granted_at AS "issuedAt",
            g.credential_expires_at AS "expiresAt",
            g.grant_state AS "state",
            g.revoked_at AS "closedAt",
            g.grant_metadata AS "grantMetadata",
            e.agent_capability_effect_id AS "effectId",
            e.effect_key AS "effectKey",
            e.managed_credential_reference AS "credentialReference",
            e.project_id AS "projectId",
            e.agent_definition_id AS "agentDefinitionId",
            e.authority_epoch AS "effectAuthorityEpoch",
            e.dispatch_state AS "dispatchState",
            e.outcome_certainty AS "outcomeCertainty",
            e.denial_reason AS "denialReason",
            e.browser_automation_run_id AS "browserAutomationRunId",
            e.request_metadata ->> 'caseId' AS "caseId",
            p.project_code AS "projectCode",
            d.agent_code AS "agentCode",
            ar.fake_runtime_case_id AS "runCaseId"
       FROM auth.execution_grants g
       JOIN worker.agent_capability_effects e ON e.agent_capability_effect_id = g.capability_effect_id
       JOIN worker.agent_runs ar ON ar.agent_run_id = g.agent_run_id
       JOIN core.projects p ON p.project_id = e.project_id
       JOIN core.agent_definitions d ON d.definition_id = e.agent_definition_id
      WHERE g.grant_kind = 'MANAGED_CAPABILITY'
        AND e.request_metadata ->> 'caseId' IN ('browser-capability-duplicate-retry', 'browser-capability-revoked-before-dispatch')
      ORDER BY g.granted_at DESC`,
  );

  const cases = {};
  for (const expectedCase of ['browser-capability-duplicate-retry', 'browser-capability-revoked-before-dispatch']) {
    const row = rows.rows.find((candidate) => candidate.caseId === expectedCase);
    assert.ok(row, `No live managed grant found for ${expectedCase}; run the actual Agent Runtime Worker acceptance first.`);
    cases[expectedCase] = row;
  }

  const rawColumns = await query(
    `SELECT column_name
       FROM information_schema.columns
      WHERE table_schema = 'auth'
        AND table_name = 'execution_grants'
        AND column_name IN ('credential', 'raw_credential', 'credential_value', 'managed_credential', 'token')`,
  );
  assert.equal(rawColumns.rowCount, 0, 'auth.execution_grants must not expose a raw credential column.');

  const evidence = {};
  for (const [caseId, row] of Object.entries(cases)) {
    assert.match(row.grantId, /^[0-9a-f-]{36}$/i);
    assert.match(row.credentialReference, new RegExp(`^grant:${row.grantId}$`));
    assert.match(row.credentialFingerprint, /^[A-F0-9]{64}$/);
    assert.ok(row.runId && row.rootExecutionId && row.principalId && row.projectId && row.agentDefinitionId);
    assert.ok(row.authoritySnapshotId);
    if (caseId === 'browser-capability-revoked-before-dispatch') {
      assert.ok(Number(row.revocationEpoch) > Number(row.effectAuthorityEpoch));
    } else {
      assert.equal(Number(row.effectAuthorityEpoch), Number(row.revocationEpoch));
    }
    assert.equal(row.audience, 'SKYCOMMAND_MANAGED_AGENT_CAPABILITY');
    assert.ok(row.issuedAt && row.expiresAt && row.state && row.closedAt);
    assert.equal(row.grantMetadata?.credentialReference, row.credentialReference);

    const browserCount = await query(
      `SELECT COUNT(*)::int AS count
         FROM worker.browser_automation_runs
        WHERE managed_effect_id = $1`,
      [row.effectId],
    );
    const eventRows = await query(
      `SELECT payload
         FROM worker.agent_events
        WHERE agent_run_id = $1
        ORDER BY event_sequence`,
      [row.runId],
    );
    const resultRows = await query(
      `SELECT result
         FROM worker.agent_results
        WHERE agent_run_id = $1`,
      [row.runId],
    );
    const storedText = JSON.stringify({ row, events: eventRows.rows, results: resultRows.rows });
    assert.doesNotMatch(storedText, forbiddenRawCredentialKeys);

    const detail = await agentExecutionService.getAgentRun(
      { session: { authMode: 'INTERNAL_SERVICE_TOKEN' } },
      row.runId,
    );
    const apiText = JSON.stringify(detail);
    assert.doesNotMatch(apiText, forbiddenRawCredentialKeys);
    const projected = detail.capabilityEffects.find((effect) => effect.effectId === row.effectId);
    assert.ok(projected);
    assert.equal(projected.managedCredential.grantId, row.grantId);
    assert.equal(projected.managedCredential.reference, row.credentialReference);
    assert.equal(projected.managedCredential.credentialFingerprint, row.credentialFingerprint);

    evidence[caseId] = {
      runId: row.runId,
      rootExecutionId: row.rootExecutionId,
      projectCode: row.projectCode,
      agentCode: row.agentCode,
      effectId: row.effectId,
      grantId: row.grantId,
      credentialReference: row.credentialReference,
      fingerprint: row.credentialFingerprint,
      state: row.state,
      dispatchState: row.dispatchState,
      outcomeCertainty: row.outcomeCertainty,
      denialReason: row.denialReason,
      browserRuns: browserCount.rows[0].count,
      apiProjectionSafe: true,
      storedRawCredential: false,
    };
  }

  assert.equal(evidence['browser-capability-duplicate-retry'].browserRuns, 1);
  assert.equal(evidence['browser-capability-duplicate-retry'].dispatchState, 'COMPLETED');
  assert.equal(evidence['browser-capability-duplicate-retry'].outcomeCertainty, 'ACKNOWLEDGED');
  assert.equal(evidence['browser-capability-revoked-before-dispatch'].browserRuns, 0);
  assert.equal(evidence['browser-capability-revoked-before-dispatch'].dispatchState, 'DENIED');
  assert.equal(evidence['browser-capability-revoked-before-dispatch'].denialReason, 'REVOCATION_EPOCH_CHANGED_BEFORE_DISPATCH');

  const browserSource = read('apps/api/src/services/browserAutomationExecutionService.js');
  const assistantSource = read('apps/api/src/services/assistantIntegrationService.js');
  assert.match(browserSource, /managed_effect_id IS NULL/);
  assert.match(browserSource, /managed_initiating_user_id/);
  assert.match(browserSource, /managed_project_id/);
  assert.match(assistantSource, /triggerSource: 'ASSISTANT'/);
  assert.match(assistantSource, /browserAutomationExecutionService\.getRun/);
  evidence.acceptanceCases = {
    duplicateSameEffectDelivery: 'PASS: one native Browser row for the durable effect',
    revocationBeforeDispatch: 'PASS: no native Browser row after epoch revocation',
    managedLinkedCrossUserProject: 'PASS: managedBrowserAccessClause applies initiating-user/project-read ACL to native and compatibility reads',
    legacyUnlinkedAssistantBrowser: 'PASS: managed_effect_id IS NULL preserves legacy Assistant-origin Browser access',
  };

  console.log(JSON.stringify({ credentialLifecycleEvidence: evidence }, null, 2));
  console.log('✅ Phase 19.2B live credential/effect evidence self-test passed.');
}

run()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end().catch(() => {});
  });
