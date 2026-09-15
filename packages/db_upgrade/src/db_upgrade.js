#!/usr/bin/env node

const path = require('node:path');
const dotenv = require('dotenv');
const { runToolCli } = require('../../tools/src');
const {
  DATABASE_UPGRADE_OUTPUT_TYPE,
  createDatabaseUpgradeFailureToolResult,
  createDatabaseUpgradeToolResult,
} = require('./databaseUpgradeResult');
const { executeDatabaseUpgrade } = require('./databaseUpgradeEngine');

const ENV_PATH = path.resolve(__dirname, '../../../.env');
const TOOL_CODE = 'db_upgrade';
const OUTPUT_SCHEMA = require('../../tools/contracts/database_upgrade_summary.v1.schema.json');

dotenv.config({ path: ENV_PATH });

function getArgValue(args, flag) {
  const index = args.indexOf(flag);
  if (index >= 0) return args[index + 1] || null;
  const prefix = `${flag}=`;
  const inline = args.find((arg) => arg.startsWith(prefix));
  return inline ? inline.slice(prefix.length) : null;
}

function parseCliArguments(args = []) {
  const values = Array.isArray(args) ? args.map((value) => String(value || '').trim()) : [];
  const positional = [];
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (!value) continue;
    if (value === '--expected-plan-digest') {
      index += 1;
      continue;
    }
    if (!value.startsWith('-')) positional.push(value);
  }
  const mode = positional[0] ? positional[0].toUpperCase() : 'PLAN';
  if (!['PLAN', 'APPLY'].includes(mode) || positional.length > 1) {
    const error = new Error('Use exactly one mode: plan or apply.');
    error.code = 'DATABASE_UPGRADE_MODE_INVALID';
    throw error;
  }

  values.forEach((value, index) => {
    if (!value.startsWith('-')) return;
    if (value === '--confirm') return;
    if (value === '--expected-plan-digest' || value.startsWith('--expected-plan-digest=')) {
      if (value === '--expected-plan-digest' && !values[index + 1]) {
        const error = new Error('--expected-plan-digest requires a value.');
        error.code = 'DATABASE_UPGRADE_PLAN_DIGEST_REQUIRED';
        throw error;
      }
      return;
    }
    const error = new Error(`Unsupported database upgrade argument: ${value}`);
    error.code = 'DATABASE_UPGRADE_ARGUMENT_NOT_ALLOWED';
    throw error;
  });

  const expectedPlanDigest = getArgValue(values, '--expected-plan-digest');
  if (expectedPlanDigest && !/^[A-Fa-f0-9]{64}$/.test(expectedPlanDigest)) {
    const error = new Error('--expected-plan-digest must be a SHA-256 hexadecimal digest.');
    error.code = 'DATABASE_UPGRADE_PLAN_DIGEST_INVALID';
    throw error;
  }
  return {
    mode,
    expectedPlanDigest,
    confirmed: values.includes('--confirm'),
  };
}

function printUsage() {
  console.log(`
SkyCommand Database Upgrade

Usage:
  npm run db:upgrade:plan
  npm run db:upgrade:apply -- --confirm --expected-plan-digest <sha256>

PLAN is the safe default and performs read-only inspection only. APPLY is
disabled unless SKYCOMMAND_DB_UPGRADE_ENABLED=true and the configured target
database and PostgreSQL system identifier both match the connected target.
SQL paths and SQL text are never accepted as arguments.
`);
}

async function executeCli(args) {
  return executeDatabaseUpgrade(parseCliArguments(args));
}

function renderUpgrade(result) {
  const ledgeredCount = result.ledger?.appliedCount ?? 0;
  const outcomeDetails = result.mode === 'APPLY'
    ? `${result.appliedCount} applied this run, ${ledgeredCount} ledgered`
    : `${result.pendingCount} pending, ${ledgeredCount} ledgered`;

  console.log(
    `[SkyCommand DB Upgrade] ${result.mode} ${result.outcome}: ${outcomeDetails}, plan ${result.planDigest?.digest || 'UNAVAILABLE'}`,
  );
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    printUsage();
    return { mode: 'help' };
  }
  return runToolCli({
    toolCode: TOOL_CODE,
    outputType: DATABASE_UPGRADE_OUTPUT_TYPE,
    outputSchema: OUTPUT_SCHEMA,
    args,
    execute: executeCli,
    createToolResult: createDatabaseUpgradeToolResult,
    createFailureToolResult: createDatabaseUpgradeFailureToolResult,
    renderConsole: renderUpgrade,
  });
}

if (require.main === module) main();

module.exports = {
  executeCli,
  getArgValue,
  main,
  parseCliArguments,
  printUsage,
  renderUpgrade,
};
