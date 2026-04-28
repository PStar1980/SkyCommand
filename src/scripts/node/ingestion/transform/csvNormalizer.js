const fs = require('fs');

const normalizeFredCSV = (filePath) => {
  const raw = fs.readFileSync(filePath, 'utf-8');

  const lines = raw.split('\n');

  const cleaned = lines
    .slice(1) // remove header
    .map((line) => line.trim())
    .filter((line) => line !== '')
    .map((line) => {
      const [date, value] = line.split(',');

      if (!value || value === '.' || value === '') return null;

      return `${date},${value}`;
    })
    .filter(Boolean);

  const output = ['edate,value', ...cleaned].join('\n');

  fs.writeFileSync(filePath, output);

  return filePath;
};

module.exports = { normalizeFredCSV };
