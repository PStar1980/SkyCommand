#!/usr/bin/env node

const fs = require('fs');
const os = require('os');
const path = require('path');

const { validateSourceAdapter } = require('../core/sourceAdapter');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function loadClosureSource() {
  return fs.readFileSync(path.join(__dirname, 'phase16PortabilityClosure.js'), 'utf8');
}

function main() {
  const source = loadClosureSource();
  const requiredServices = [
    '../catalogue/dataCatalogueService',
    '../consumer/dataConsumerService',
    '../freshness/freshnessService',
    '../quality/qualityEvidenceService',
    '../ledger/ingestionLedgerService',
    '../recovery/ingestionRecoveryService',
    '../core/sourceAdapterRegistry',
  ];

  for (const service of requiredServices) {
    assert(source.includes(service), `Closure proof does not use ${service}.`);
  }

  assert(source.includes("category_kind_code = 'INGESTION'"),
    'Closure proof must use semantic INGESTION category discovery.');
  assert(source.includes("contractVersion === 'time_series_observations.v1'"),
    'Closure proof must verify the generic observation contract.');
  assert(source.includes("contractVersion === 'metric_observations.v1'"),
    'Closure proof must verify the generic metric contract.');
  assert(source.includes('createRecoveryRequest') && source.includes('executeRecoveryRequest'),
    'Closure proof must exercise durable failed-only recovery.');
  assert(/executeRecoveryRequest\(\{[\s\S]*recoveryRequestId:[\s\S]*adapter/.test(source),
    'Closure proof must call the recovery service through its object-shaped execution contract.');
  assert(!source.includes("sourceCode === 'FRED'") && !source.includes("sourceCode === 'BOC'"),
    'Closure proof must not branch on current production source names.');

  const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'sky-phase16-closure-selftest-'));
  try {
    const sourceAdapterPath = path.resolve(__dirname, '../core/sourceAdapter.js');
    const modulePath = path.join(tempDirectory, 'minimalClosureAdapter.js');
    fs.writeFileSync(modulePath, `
const { defineSourceAdapter } = require(${JSON.stringify(sourceAdapterPath)});
module.exports = defineSourceAdapter({
  domainCode: 'PROGRAM_EVALUATION_TEST',
  sourceCode: 'LOCAL_CASE_FILE',
  adapterCode: 'PROGRAM_EVAL_TEST',
  resultContractVersion: 'ingestion_run_summary.v1',
  name: 'Closure self-test adapter',
  getAssets: async () => ['CLIENT_INTAKE'],
  fetch: async () => '/tmp/client_intake.csv',
  load: async () => ({ stagingRows: 1, rowsInserted: 1 }),
  defaultConcurrency: 1,
  maxConcurrency: 1,
  requestPolicyRequired: false,
  capabilities: {
    incremental: true,
    selectedAssets: true,
    backfill: false,
    revisions: true,
    resume: true,
    dryRun: false,
  },
});
`, 'utf8');

    const adapter = require(modulePath);
    validateSourceAdapter(adapter);
    assert(adapter.domainCode === 'PROGRAM_EVALUATION_TEST', 'Non-macro domain was not retained.');
    assert(adapter.capabilities.resume === true, 'Closure adapter must support recovery.');
    assert(adapter.resultContractVersion === 'ingestion_run_summary.v1', 'Generic result contract mismatch.');
  } finally {
    fs.rmSync(tempDirectory, { recursive: true, force: true });
  }

  console.log('✅ Phase 16.8.3 final portability closure contract self-test passed.');
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(`❌ ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = { main };
