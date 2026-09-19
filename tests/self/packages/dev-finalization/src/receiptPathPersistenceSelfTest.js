const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const repositoryRoot = path.resolve(__dirname, '../../../../../');
require('dotenv').config({ path: path.join(repositoryRoot, '.env'), quiet: true });
const receipt = require(path.join(repositoryRoot, 'packages/dev-finalization/src/receipt'));
const finalization = require(path.join(repositoryRoot, 'packages/dev-finalization/src/finalization'));

const runId = '11111111-1111-4111-8111-111111111111';
const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'skycommand-r6-receipt-'));

async function run() {
  const receiptPath = path.join(temporaryRoot, 'docs', 'generated', 'receipt.json');
  const payload = {
    contract: 'dev_finalization_summary.v1',
    outcome: 'COMPLETE',
    runId,
    artifacts: {},
  };
  let queryParameters = null;
  let releaseCount = 0;

  const receiptSha256 = await receipt.persistReceipt({
    runId,
    payload,
    output: { artifacts: {} },
    paths: { receipt: receiptPath },
    queryFn: async (_sql, parameters) => {
      queryParameters = parameters;
      return { rows: [] };
    },
    releaseLockFn: async () => {
      releaseCount += 1;
    },
  });

  assert.equal(queryParameters[3], receiptPath);
  assert.equal(releaseCount, 1);
  assert.equal(fs.existsSync(receiptPath), true);
  const receiptBytes = fs.readFileSync(receiptPath);
  const fileSha256 = crypto.createHash('sha256').update(receiptBytes).digest('hex').toUpperCase();
  assert.equal(receiptSha256, fileSha256);
  assert.equal(queryParameters[4], fileSha256);
  assert.equal(JSON.parse(queryParameters[2]).receiptSha256, fileSha256);

  const before = fs.statSync(receiptPath);
  const reusable = receipt.getReusableReceipt(
    {
      status: 'COMPLETED',
      receipt_path: receiptPath,
      receipt_sha256: fileSha256,
      receipt_payload: payload,
    },
    runId,
  );
  const after = fs.statSync(receiptPath);
  assert.equal(reusable.receiptPath, receiptPath);
  assert.equal(reusable.receiptSha256, fileSha256);
  assert.equal(after.size, before.size);
  assert.equal(after.mtimeMs, before.mtimeMs);

  assert.equal(
    receipt.REQUIRED_ZIP_ENTRIES.includes(finalization.RECEIPT_RELATIVE_PATH),
    false,
  );
  const repositoryZip = path.join(repositoryRoot, 'zip', 'SkyCommand_RepoZip.zip');
  if (fs.existsSync(repositoryZip)) {
    const receiptEntry = finalization.verifyZipEntries(
      repositoryZip,
      [finalization.RECEIPT_RELATIVE_PATH],
    )[0];
    assert.equal(receiptEntry.status, 'MISSING');
  }

  console.log('[receipt-path-persistence:self-test] PASS');
}

run()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  });
