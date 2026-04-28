const { execSync } = require('child_process');

const copyIntoTable = (table, filePath) => {
  const normalizedPath = filePath.replace(/\\/g, '/');
  const tempTable = `stg_${table}`;

  console.log(`📥 Loading into staging ${tempTable}`);

  execSync(
    `psql -h ${process.env.PGHOST} -p ${process.env.PGPORT} -U ${process.env.PGUSER} -d ${process.env.PGDATABASE} -c "
      DROP TABLE IF EXISTS ${tempTable};
      CREATE TEMP TABLE ${tempTable} (edate date, value numeric);

      \\copy ${tempTable} (edate, value)
      FROM '${normalizedPath}'
      WITH CSV HEADER;

      INSERT INTO macro.\\"${table}\\" (edate, value)
      SELECT edate, value FROM ${tempTable}
      ON CONFLICT (edate)
      DO UPDATE SET value = EXCLUDED.value;
    "`,
    {
      stdio: 'inherit',
      env: process.env,
    },
  );
};

module.exports = { copyIntoTable };
