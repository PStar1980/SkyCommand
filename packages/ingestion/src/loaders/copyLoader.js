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

const printCleanOutput = (output) => {
  output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .forEach((line) => console.log(line));
};

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
    `SET client_min_messages TO WARNING;`,
    `DROP TABLE IF EXISTS ${tempTable};`,
    `CREATE TEMP TABLE ${tempTable} (edate DATE, value NUMERIC);`,
    `\\copy ${tempTable} (edate, value) FROM ${sqlLiteral(normalizedPath)} WITH CSV HEADER`,
    `SELECT 'staging_rows=' || COUNT(*) FROM ${tempTable};`,
    `SELECT 'staging_max=' || COALESCE(MAX(edate)::text, '') FROM ${tempTable};`,
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
  } finally {
    try {
      fs.unlinkSync(sqlFile);
    } catch {
      // Ignore cleanup failure.
    }
  }
};

module.exports = { copyIntoTable };
