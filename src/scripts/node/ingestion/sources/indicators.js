const { execSync } = require('child_process');

const getIndicators = () => {
  const result = execSync(
    `psql -h ${process.env.PGHOST} -p ${process.env.PGPORT} -U ${process.env.PGUSER} -d ${process.env.PGDATABASE} -t -c "SELECT indicator_code FROM macro.indicators WHERE active = true ORDER BY indicator_code;"`,
    {
      encoding: 'utf-8',
      env: process.env, // 🔑 ensures PGPASSWORD works
    },
  );

  return result
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
};

module.exports = { getIndicators };
