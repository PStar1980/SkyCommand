#!/usr/bin/env node

const path = require('node:path');
const dotenv = require('dotenv');
const { runToolCli } = require('../../tools/src');
const {
  DATABASE_UPGRADE_OUTPUT_TYPE,
  createDatabaseUpgradeFailureToolResult,
  createDatabaseUpgradeToolResult,
} = require('./databaseUpgradeResult');
const { executeRegisteredDevDatabaseUpgrade, TOOL_CODE } = require('./databaseUpgradeApplyTool');

const ENV_PATH = path.resolve(__dirname, '../../../.env');
const OUTPUT_SCHEMA = require('../../tools/contracts/database_upgrade_summary.v1.schema.json');

dotenv.config({ path: ENV_PATH });

function parseCliArguments(args = []) {
  const values = Array.isArray(args) ? args.map((value) => String(value || '').trim()) : [];
  if (values.some(Boolean)) {
    const error = new Error('The registered DEV database-upgrade Tool accepts no arguments.');
    error.code = 'DATABASE_UPGRADE_ARGUMENT_NOT_ALLOWED';
    throw error;
  }
  return {};
}

async function executeCli(args) {
  parseCliArguments(args);
  return executeRegisteredDevDatabaseUpgrade();
}

function renderUpgrade(result) {
  const ledgeredCount = result.ledger?.appliedCount ?? 0;
  console.log(
    `[SkyCommand DB Upgrade] APPLY ${result.outcome}: ${result.appliedCount} applied this run, ${ledgeredCount} ledgered, plan ${result.planDigest?.digest || 'UNAVAILABLE'}`,
  );
}

async function main() {
  return runToolCli({
    toolCode: TOOL_CODE,
    outputType: DATABASE_UPGRADE_OUTPUT_TYPE,
    outputSchema: OUTPUT_SCHEMA,
    args: process.argv.slice(2),
    execute: executeCli,
    createToolResult: createDatabaseUpgradeToolResult,
    createFailureToolResult: createDatabaseUpgradeFailureToolResult,
    renderConsole: renderUpgrade,
  });
}

if (require.main === module) main();

module.exports = {
  executeCli,
  main,
  parseCliArguments,
  renderUpgrade,
};
