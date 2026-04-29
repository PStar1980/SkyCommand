const fs = require('fs');

const parseCSVLine = (line) => {
  const cells = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    const nextChar = line[i + 1];

    if (char === '"' && inQuotes && nextChar === '"') {
      current += '"';
      i += 1;
    } else if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      cells.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }

  cells.push(current.trim());

  return cells.map((cell) => cell.replace(/^\uFEFF/, '').trim());
};

const normalizeFredCSV = (filePath) => {
  const raw = fs.readFileSync(filePath, 'utf-8');

  const lines = raw.split(/\r?\n/);

  const cleaned = lines
    .slice(1)
    .map((line) => line.trim())
    .filter((line) => line !== '')
    .map((line) => {
      const [dateRaw, valueRaw] = parseCSVLine(line);

      const date = dateRaw?.trim();
      const value = valueRaw?.trim();

      if (!date || !value || value === '.') return null;

      return `${date},${value}`;
    })
    .filter(Boolean);

  const output = ['edate,value', ...cleaned].join('\n');

  fs.writeFileSync(filePath, output);

  return filePath;
};

const normalizeBoCCSV = (filePath) => {
  const raw = fs.readFileSync(filePath, 'utf-8');

  const rows = raw
    .split(/\r?\n/)
    .map((line) => parseCSVLine(line))
    .filter((cells) => cells.some((cell) => cell !== ''));

  const headerRowIndex = rows.findIndex((cells) =>
    cells.some((cell) => cell.toLowerCase() === 'date'),
  );

  if (headerRowIndex === -1) {
    throw new Error(`BoC CSV date header not found in ${filePath}`);
  }

  const headerRow = rows[headerRowIndex];

  const dateColIndex = headerRow.findIndex((cell) => cell.toLowerCase() === 'date');

  const valueColIndex = headerRow.findIndex((cell, index) => index > dateColIndex && cell !== '');

  if (dateColIndex === -1 || valueColIndex === -1) {
    throw new Error(`BoC CSV value header not found in ${filePath}`);
  }

  const cleaned = rows
    .slice(headerRowIndex + 1)
    .map((cells) => {
      const date = cells[dateColIndex]?.trim();
      const value = cells[valueColIndex]?.trim();

      if (!date || !value || value === '.') return null;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;

      return `${date},${value}`;
    })
    .filter(Boolean);

  if (cleaned.length === 0) {
    throw new Error(`BoC CSV observations not found in ${filePath}`);
  }

  const output = ['edate,value', ...cleaned].join('\n');

  fs.writeFileSync(filePath, output);

  return filePath;
};

module.exports = { normalizeFredCSV, normalizeBoCCSV };
