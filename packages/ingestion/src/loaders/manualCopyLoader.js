const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const assertSafeIdentifier = (value) => {
  if (!/^[A-Za-z0-9_]+$/.test(value)) {
    throw new Error(`Unsafe identifier: ${value}`);
  }
};

const quoteIdentifier = (value) => `"${String(value).replace(/"/g, '""')}"`;

const sqlLiteral = (value) => `'${String(value).replace(/'/g, "''")}'`;

const normalizePath = (value) => String(value).replace(/\\/g, '/');

const safeName = (value) =>
  String(value || 'manual')
    .replace(/[^A-Za-z0-9_]/g, '_')
    .toLowerCase();

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

const runSql = (sql, filePrefix = 'skyserver_manual_query') => {
  const sqlFile = path.join(os.tmpdir(), `${filePrefix}_${process.pid}.sql`);

  fs.writeFileSync(sqlFile, sql, 'utf-8');

  try {
    return execFileSync('psql', getPsqlArgs(sqlFile), {
      encoding: 'utf-8',
      env: process.env,
    });
  } finally {
    try {
      fs.unlinkSync(sqlFile);
    } catch {
      // Ignore cleanup failure.
    }
  }
};

const getPrimaryKeyColumns = (schema, table) => {
  const sql = `
    SELECT a.attname
    FROM pg_index i
    JOIN pg_class c
      ON c.oid = i.indrelid
    JOIN pg_namespace n
      ON n.oid = c.relnamespace
    JOIN pg_attribute a
      ON a.attrelid = i.indrelid
     AND a.attnum = ANY(i.indkey)
    WHERE i.indisprimary = true
      AND n.nspname = ${sqlLiteral(schema)}
      AND c.relname = ${sqlLiteral(table)}
    ORDER BY array_position(i.indkey, a.attnum);
  `;

  return runSql(sql, 'skyserver_manual_pk')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
};

const assertColumnsExist = (schema, table, columns) => {
  const sql = `
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = ${sqlLiteral(schema)}
      AND table_name = ${sqlLiteral(table)};
  `;

  const existingColumns = new Set(
    runSql(sql, 'skyserver_manual_columns')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean),
  );

  const missingColumns = columns.filter((column) => !existingColumns.has(column));

  if (missingColumns.length > 0) {
    throw new Error(`Target table missing column(s): ${missingColumns.join(', ')}`);
  }
};

const buildConflictClause = ({ databaseColumns, primaryKeyColumns, updateOnConflict }) => {
  const quotedPrimaryKeyColumns = primaryKeyColumns.map(quoteIdentifier).join(', ');

  if (updateOnConflict === false) {
    return `ON CONFLICT (${quotedPrimaryKeyColumns}) DO NOTHING`;
  }

  const updateColumns = databaseColumns.filter((column) => !primaryKeyColumns.includes(column));

  if (updateColumns.length === 0) {
    return `ON CONFLICT (${quotedPrimaryKeyColumns}) DO NOTHING`;
  }

  const setClause = updateColumns
    .map((column) => `${quoteIdentifier(column)} = EXCLUDED.${quoteIdentifier(column)}`)
    .join(', ');

  return `ON CONFLICT (${quotedPrimaryKeyColumns}) DO UPDATE SET ${setClause}`;
};

const copyManualIntoTable = (code, filePath, job) => {
  const schema = job.schema || 'public';
  const table = job.table;
  const databaseColumns =
    job.__manual?.mappedColumns || job.columns.map((column) => column.databaseColumn);

  assertSafeIdentifier(schema);
  assertSafeIdentifier(table);

  for (const column of databaseColumns) {
    assertSafeIdentifier(column);
  }

  const primaryKeyColumns = getPrimaryKeyColumns(schema, table);

  if (primaryKeyColumns.length === 0) {
    throw new Error(
      `No primary key found for ${schema}.${table}. Manual ingestion requires a primary key for safe upsert behavior.`,
    );
  }

  const missingPrimaryKeyColumns = primaryKeyColumns.filter(
    (column) => !databaseColumns.includes(column),
  );

  if (missingPrimaryKeyColumns.length > 0) {
    throw new Error(
      `Mapped columns must include primary key column(s): ${missingPrimaryKeyColumns.join(', ')}`,
    );
  }

  assertColumnsExist(schema, table, databaseColumns);

  const targetTable = `${quoteIdentifier(schema)}.${quoteIdentifier(table)}`;
  const quotedColumns = databaseColumns.map(quoteIdentifier).join(', ');
  const stageTable = `stg_manual_${safeName(code)}_${process.pid}`;
  const normalizedPath = normalizePath(filePath);

  const conflictClause = buildConflictClause({
    databaseColumns,
    primaryKeyColumns,
    updateOnConflict: job.updateOnConflict,
  });

  const sql = [
    `SET client_min_messages TO WARNING;`,
    `DROP TABLE IF EXISTS ${stageTable};`,
    `CREATE TEMP TABLE ${stageTable} AS SELECT ${quotedColumns} FROM ${targetTable} WHERE false;`,
    `\\copy ${stageTable} (${quotedColumns}) FROM ${sqlLiteral(normalizedPath)} WITH CSV HEADER`,
    `SELECT 'pk_columns=${primaryKeyColumns.join(',')}' AS result;`,
    `SELECT 'staging_rows=' || COUNT(*) FROM ${stageTable};`,
    `SELECT 'target_rows_before=' || COUNT(*) FROM ${targetTable};`,
    `WITH affected AS (`,
    `  INSERT INTO ${targetTable} (${quotedColumns})`,
    `  SELECT ${quotedColumns} FROM ${stageTable}`,
    `  ${conflictClause}`,
    `  RETURNING 1`,
    `)`,
    `SELECT 'affected_rows=' || COUNT(*) FROM affected;`,
    `SELECT 'target_rows_after=' || COUNT(*) FROM ${targetTable};`,
  ].join('\n');

  console.log(`🔥 [COPY] ${code}`);

  const output = runSql(sql, `skyserver_manual_copy_${safeName(code)}`);

  printCleanOutput(output);
};

module.exports = { copyManualIntoTable };
