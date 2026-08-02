#!/usr/bin/env node

const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { getRun } = require('../ledger/ingestionLedgerService');

const REPOSITORY_ROOT = path.resolve(__dirname, '../../../..');

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function proveSingleClientLedgerReads() {
  let activeQueries = 0;
  let maximumActiveQueries = 0;
  const calls = [];

  const query = async (sql) => {
    activeQueries += 1;
    maximumActiveQueries = Math.max(maximumActiveQueries, activeQueries);
    calls.push(String(sql));

    try {
      if (activeQueries > 1) {
        throw new Error('Overlapping queries were issued on one simulated pg Client.');
      }
      await delay(2);

      if (/FROM data\.vw_ingestion_runs\s+WHERE ingestion_run_id/i.test(sql)) {
        return {
          rows: [{
            ingestion_run_id: '11111111-1111-4111-8111-111111111111',
            domain_code: 'TEST',
            domain_name: 'Closure Test',
            source_code: 'LOCAL',
            source_name: 'Local fixture',
            mode_code: 'INCREMENTAL',
            trigger_code: 'PROOF',
            status_code: 'SUCCESS',
            status_name: 'Success',
            terminal: true,
            success_like: true,
            contract_version: 'ingestion_run_summary.v1',
            selected_assets: [],
            capabilities_snapshot: {},
            request_context: {},
            quality_status_code: 'PASS',
            started_at: '2026-08-01T00:00:00.000Z',
            completed_at: '2026-08-01T00:00:01.000Z',
            created_at: '2026-08-01T00:00:01.000Z',
            updated_at: '2026-08-01T00:00:01.000Z',
          }],
        };
      }

      return { rows: [] };
    } finally {
      activeQueries -= 1;
    }
  };

  const detail = await getRun('11111111-1111-4111-8111-111111111111', { query });
  assert.equal(detail.contractVersion, 'ingestion_run_summary.v1');
  assert.equal(maximumActiveQueries, 1, 'Ledger detail reads must be sequential on one pg Client.');
  assert.equal(calls.length, 5, 'Expected run, item, revision, quality, and rejection reads.');
}

function proveFreshnessSingleClientDiscipline() {
  const sourcePath = path.join(
    REPOSITORY_ROOT,
    'packages/ingestion/src/freshness/freshnessService.js',
  );
  const source = fs.readFileSync(sourcePath, 'utf8');
  const loadPoliciesBody = source.match(/async function loadPolicies\(query\) \{([\s\S]*?)\n\}/)?.[1] || '';
  const refreshBody = source.match(/async function refreshFreshnessSnapshots\(options = \{\}\) \{([\s\S]*?)\n\}/)?.[1] || '';

  assert.ok(loadPoliciesBody.includes('const frequencyResult = await query'));
  assert.ok(loadPoliciesBody.includes('const sourceResult = await query'));
  assert.ok(!loadPoliciesBody.includes('Promise.all'));
  assert.ok(refreshBody.includes('const assets = await loadAssets'));
  assert.ok(refreshBody.includes('const policies = await loadPolicies'));
  assert.ok(refreshBody.includes('const executionEvidence = await loadExecutionEvidence'));
  assert.ok(!refreshBody.includes('Promise.all'));
}

function proveClosureDocumentation() {
  const roadmap = fs.readFileSync(
    path.join(REPOSITORY_ROOT, 'docs/SkyCommand_Phase_16_Portable_Ingestion_and_Data_Contract_Foundation.md'),
    'utf8',
  );
  const closureReport = fs.readFileSync(
    path.join(REPOSITORY_ROOT, 'docs/SkyCommand_Phase_16_Closure_Report.md'),
    'utf8',
  );

  assert.ok(roadmap.includes('**Revision:** 22'));
  assert.ok(roadmap.includes('Phase 16.9'));
  assert.ok(roadmap.includes('Phase 16.8.3 is accepted as complete'));
  assert.ok(closureReport.includes('time_series_observations.v1'));
  assert.ok(closureReport.includes('metric_observations.v1'));
  assert.ok(closureReport.includes('PROGRAM_EVALUATION'));
  assert.ok(closureReport.includes('USSLIND'));
}

async function main() {
  await proveSingleClientLedgerReads();
  proveFreshnessSingleClientDiscipline();
  proveClosureDocumentation();
  console.log('✅ Phase 16.9 closure stabilization contract self-test passed.');
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`❌ ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = { main };
