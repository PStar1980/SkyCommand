const assert = require('assert');

const {
  buildRevisionAwareCopySql,
  createQualityFailure,
  parseCopyOutput,
  quoteRelationName,
} = require('../loaders/copyLoader');
const { materializeItemAttempts } = require('../core/runPipeline');
const { normalizeRunSummary } = require('../ledger/ingestionRunResult');

function encode(value) {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64');
}

function encodeWithPostgresLineWrap(value) {
  return encode(value).match(/.{1,76}/g).join('\n');
}

function main() {
  const revisions = [{
    observationKey: '2026-01-01',
    observationDate: '2026-01-01',
    oldValue: { value: 10 },
    newValue: { value: 11 },
    metadata: { loader: 'revision_aware_timeseries_v1' },
  }];
  const rejections = [{
    checkCode: 'INVALID_NUMERIC',
    severityCode: 'ERROR',
    sourceRowNumber: 3,
    observationKey: '2026-03-01',
    rawPayload: { edate: '2026-03-01', value: 'abc' },
    normalizedPayload: { edate: '2026-03-01' },
    message: 'Observation value is missing or invalid.',
    metadata: { loader: 'revision_aware_timeseries_v1' },
  }];
  const issues = [{
    checkCode: 'SOURCE_DATE_REGRESSION',
    severityCode: 'WARNING',
    blocking: false,
    message: 'The source maximum date is earlier than the existing target maximum date.',
    evidence: { sourceMaxDate: '2026-02-01', targetMaxDate: '2026-03-01' },
  }];
  const output = [
    'staging_rows=4',
    'accepted_rows=2',
    'staging_min=2026-01-01',
    'staging_max=2026-02-01',
    'previous_target_max=2026-03-01',
    'new_rows=1',
    'inserted_rows=1',
    'updated_rows=1',
    'unchanged_rows=0',
    'rejected_rows=1',
    'revisions_detected=1',
    'quality_issue_count=2',
    'quality_status=WARN',
    'target_max=2026-03-01',
    `revision_events_b64=${encodeWithPostgresLineWrap(revisions)}`,
    `rejection_events_b64=${encodeWithPostgresLineWrap(rejections)}`,
    `quality_issues_b64=${encodeWithPostgresLineWrap(issues)}`,
  ].join('\n');

  const parsed = parseCopyOutput(output);
  assert.strictEqual(parsed.rowsInserted, 1);
  assert.strictEqual(parsed.rowsUpdated, 1);
  assert.strictEqual(parsed.revisionsDetected, 1);
  assert.strictEqual(parsed.rowsRejected, 1);
  assert.strictEqual(parsed.qualityStatusCode, 'WARN');
  assert.deepStrictEqual(parsed.revisionEvents, revisions);
  assert.deepStrictEqual(parsed.rejectionEvents, rejections);
  assert.deepStrictEqual(parsed.qualityIssues, issues);

  const attempts = materializeItemAttempts([], {
    outcome: 'UPDATED',
    ...parsed,
  });
  assert.strictEqual(attempts.length, 1);
  assert.strictEqual(attempts[0].revisionsDetected, 1);
  assert.strictEqual(attempts[0].qualityIssueCount, 2);
  assert.strictEqual(attempts[0].qualityStatusCode, 'WARN');

  const summary = normalizeRunSummary({
    domainCode: 'TEST',
    sourceCode: 'TEST_SOURCE',
    items: [{
      assetCode: 'ASSET_A',
      attemptNumber: 1,
      outcome: 'UPDATED',
      ...attempts[0],
    }],
  });
  assert.strictEqual(summary.totals.revisionsDetected, 1);
  assert.strictEqual(summary.totals.qualityIssueCount, 2);
  assert.strictEqual(summary.totals.qualityStatusCode, 'WARN');

  const sql = buildRevisionAwareCopySql({
    targetTable: '"proof"."asset_a"',
    tempTable: 'stg_asset_a',
    normalizedPath: 'C:/tmp/asset_a.csv',
  });
  assert(sql.includes('IS DISTINCT FROM'));
  assert(sql.includes('INVALID_DATE'));
  assert(sql.includes('INVALID_NUMERIC'));
  assert(sql.includes('DUPLICATE_KEY'));
  assert(sql.includes('revision_events_b64'));
  assert(sql.includes("replace(replace(encode(convert_to("));
  assert(sql.includes("chr(10), ''"));
  assert.strictEqual(quoteRelationName('proof.asset_a'), '"proof"."asset_a"');

  const failure = createQualityFailure({
    qualityStatusCode: 'FAIL',
    qualityIssues: [{ blocking: true, message: 'No valid rows.' }],
  });
  assert.strictEqual(failure.code, 'INGESTION_QUALITY_FAILED');
  assert.strictEqual(failure.errorCategoryCode, 'VALIDATION');
  assert.strictEqual(failure.ingestionEvidence.qualityStatusCode, 'FAIL');

  console.log('✅ Phase 16.6 revision-aware loader and quality contract self-test passed.');
}

if (require.main === module) main();

module.exports = { main };
