const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const assertSafeIdentifier = (value) => {
  if (!/^[A-Za-z0-9_]+$/.test(value)) {
    throw new Error(`Unsafe table/indicator name: ${value}`);
  }
};

const quoteIdentifier = (value) => `"${value.replace(/"/g, '""')}"`;

const sqlLiteral = (value) => `'${value.replace(/'/g, "''")}'`;

const getPsqlArgs = (sqlFile) => {
  if (!process.env.PGDATABASE) {
    throw new Error('PGDATABASE is not defined');
  }

  return [
    '-q',
    '-X',
    '-v',
    'ON_ERROR_STOP=1',
    '-h',
    process.env.PGHOST || 'localhost',
    '-p',
    process.env.PGPORT || '5432',
    '-U',
    process.env.PGUSER || 'postgres',
    '-d',
    process.env.PGDATABASE,
    '-t',
    '-A',
    '-f',
    sqlFile,
  ];
};

const getCleanOutputLines = (output) => String(output || '')
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter(Boolean);

const printCleanOutput = (output) => {
  getCleanOutputLines(output).forEach((line) => console.log(line));
};

function parseMetricInteger(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseMetricDate(value) {
  const text = String(value || '').trim();
  return text || null;
}

function parseCopyOutput(output) {
  const metrics = new Map();

  getCleanOutputLines(output).forEach((line) => {
    const match = line.match(/^([a-z_]+)=(.*)$/i);

    if (match) {
      metrics.set(match[1].toLowerCase(), match[2].trim());
    }
  });

  return {
    stagingRows: parseMetricInteger(metrics.get('staging_rows')),
    stagingMinDate: parseMetricDate(metrics.get('staging_min')),
    stagingMaxDate: parseMetricDate(metrics.get('staging_max')),
    previousTargetMaxDate: parseMetricDate(metrics.get('previous_target_max')),
    newRowsDetected: parseMetricInteger(metrics.get('new_rows')),
    rowsInserted: parseMetricInteger(metrics.get('inserted_rows')),
    currentTargetMaxDate: parseMetricDate(metrics.get('target_max')),
  };
}

const copyIntoTable = (table, filePath) => {
  assertSafeIdentifier(table);

  const normalizedPath = filePath.replace(/\\/g, '/');
  const tempTable = `stg_${table.toLowerCase()}`;
  const targetTable = `macro.${quoteIdentifier(table)}`;
  const sqlFile = path.join(
    os.tmpdir(),
    `skyserver_copy_${table.toLowerCase()}_${process.pid}.sql`,
  );

  console.log(`🔥 [COPY] ${table}`);

  const sql = [
    'SET client_min_messages TO WARNING;',
    `DROP TABLE IF EXISTS ${tempTable};`,
    `CREATE TEMP TABLE ${tempTable} (edate DATE, value NUMERIC);`,
    `\\copy ${tempTable} (edate, value) FROM ${sqlLiteral(normalizedPath)} WITH CSV HEADER`,
    `SELECT 'staging_rows=' || COUNT(*) FROM ${tempTable};`,
    `SELECT 'staging_min=' || COALESCE(MIN(edate)::text, '') FROM ${tempTable};`,
    `SELECT 'staging_max=' || COALESCE(MAX(edate)::text, '') FROM ${tempTable};`,
    `SELECT 'previous_target_max=' || COALESCE(MAX(edate)::text, '') FROM ${targetTable};`,
    `SELECT 'new_rows=' || COUNT(*) FROM ${tempTable} s WHERE NOT EXISTS (SELECT 1 FROM ${targetTable} t WHERE t.edate = s.edate);`,
    `WITH inserted AS (INSERT INTO ${targetTable} (edate, value) SELECT DISTINCT ON (s.edate) s.edate, s.value FROM ${tempTable} s WHERE NOT EXISTS (SELECT 1 FROM ${targetTable} t WHERE t.edate = s.edate) ORDER BY s.edate RETURNING 1) SELECT 'inserted_rows=' || COUNT(*) FROM inserted;`,
    `SELECT 'target_max=' || COALESCE(MAX(edate)::text, '') FROM ${targetTable};`,
  ].join('\n');

  fs.writeFileSync(sqlFile, sql, 'utf-8');

  try {
    const output = execFileSync('psql', getPsqlArgs(sqlFile), {
      encoding: 'utf-8',
      env: process.env,
    });

    printCleanOutput(output);
    return parseCopyOutput(output);
  } finally {
    try {
      fs.unlinkSync(sqlFile);
    } catch {
      // Ignore cleanup failure.
    }
  }
};

module.exports = {
  copyIntoTable,
  parseCopyOutput,
};
