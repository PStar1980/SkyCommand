const { execSync } = require('child_process');

const getIndicators = (source) => {
  const upperSource = source.toUpperCase();

  // Single-line SQL (CRITICAL for Windows shell)
  const sql = `SELECT indicator_code FROM macro.indicators WHERE active = true AND UPPER(source) = '${upperSource}' ORDER BY indicator_code;`;

  // Escape double quotes for shell safety
  const safeSql = sql.replace(/"/g, '\\"');

  const command = `psql -h ${process.env.PGHOST} -p ${process.env.PGPORT} -U ${process.env.PGUSER} -d ${process.env.PGDATABASE} -t -A -c "${safeSql}"`;

  //console.log('[DEBUG SQL]', sql);
  //console.log('[DEBUG CMD]', command);

  let result;

  try {
    result = execSync(command, {
      encoding: 'utf-8',
      env: process.env,
    });
  } catch (err) {
    console.error('[ERROR] Failed to fetch indicators');
    console.error(err.stdout?.toString());
    console.error(err.stderr?.toString());
    throw err;
  }

  //console.log('[DEBUG RAW RESULT]', result);

  return result
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
};

module.exports = { getIndicators };
