const fs = require('fs');
const path = require('path');

const { STATCAN_INDICATORS } = require('../config/statcanIndicators');

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

const normalizeText = (value) =>
  String(value ?? '')
    .replace(/^\uFEFF/, '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();

const getIndicatorCodeFromPath = (filePath) =>
  path.basename(filePath, path.extname(filePath)).toUpperCase();

const findColumn = (row, columns) => {
  const candidates = Array.isArray(columns) ? columns : [columns];
  const keys = Object.keys(row);

  for (const candidate of candidates) {
    const normalizedCandidate = normalizeText(candidate);
    const exactKey = keys.find((key) => normalizeText(key) === normalizedCandidate);

    if (exactKey) return exactKey;
  }

  for (const candidate of candidates) {
    const normalizedCandidate = normalizeText(candidate);
    const looseKey = keys.find((key) => normalizeText(key).includes(normalizedCandidate));

    if (looseKey) return looseKey;
  }

  return null;
};

const getColumnValue = (row, columns) => {
  const key = findColumn(row, columns);
  return key ? row[key] : undefined;
};

const valueMatchesRule = (value, rule) => {
  const normalizedValue = normalizeText(value);

  if (rule.equalsAny) {
    return rule.equalsAny.some((expected) => normalizedValue === normalizeText(expected));
  }

  if (rule.includesAny) {
    return rule.includesAny.some((expected) => normalizedValue.includes(normalizeText(expected)));
  }

  if (rule.includesAll) {
    return rule.includesAll.every((expected) => normalizedValue.includes(normalizeText(expected)));
  }

  return true;
};

const rowMatchesFilters = (row, filters = []) =>
  filters.every((filter) => {
    const value = getColumnValue(row, filter.columns);

    if (value === undefined || value === '') {
      return Boolean(filter.optional);
    }

    return valueMatchesRule(value, filter);
  });

const normalizeStatCanRefDate = (value) => {
  const ref = String(value ?? '').trim();

  if (/^\d{4}-\d{2}-\d{2}$/.test(ref)) {
    return ref;
  }

  if (/^\d{4}-\d{2}$/.test(ref)) {
    return `${ref}-01`;
  }

  if (/^\d{4}$/.test(ref)) {
    return `${ref}-01-01`;
  }

  const quarterMatch = ref.match(/^(\d{4})[\s-]?Q([1-4])$/i);

  if (quarterMatch) {
    const year = quarterMatch[1];
    const quarter = Number(quarterMatch[2]);
    const month = String((quarter - 1) * 3 + 1).padStart(2, '0');

    return `${year}-${month}-01`;
  }

  return null;
};

const normalizeNumber = (value) => {
  const cleaned = String(value ?? '')
    .trim()
    .replace(/,/g, '');

  if (!cleaned || cleaned === '.') return null;

  const numeric = Number(cleaned);

  if (!Number.isFinite(numeric)) return null;

  return String(numeric);
};

const applyTransform = (rows, transform) => {
  const sortedRows = [...rows].sort((a, b) => a.date.localeCompare(b.date));

  if (transform === 'level') {
    return sortedRows;
  }

  if (transform === 'mom_pct') {
    return sortedRows
      .map((row, index) => {
        if (index === 0) return null;

        const previous = Number(sortedRows[index - 1].value);
        const current = Number(row.value);

        if (!previous || !Number.isFinite(previous) || !Number.isFinite(current)) return null;

        return {
          date: row.date,
          value: ((current / previous - 1) * 100).toFixed(4),
        };
      })
      .filter(Boolean);
  }

  if (transform === 'yoy_pct') {
    return sortedRows
      .map((row, index) => {
        if (index < 12) return null;

        const previous = Number(sortedRows[index - 12].value);
        const current = Number(row.value);

        if (!previous || !Number.isFinite(previous) || !Number.isFinite(current)) return null;

        return {
          date: row.date,
          value: ((current / previous - 1) * 100).toFixed(4),
        };
      })
      .filter(Boolean);
  }

  throw new Error(`Unsupported StatCan transform: ${transform}`);
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

const normalizeStatCanCSV = (filePath) => {
  const indicatorCode = getIndicatorCodeFromPath(filePath);
  const config = STATCAN_INDICATORS[indicatorCode];

  if (!config) {
    throw new Error(`No StatCan normalizer config found for ${indicatorCode}`);
  }

  const raw = fs.readFileSync(filePath, 'utf-8');

  const rows = raw
    .split(/\r?\n/)
    .map((line) => parseCSVLine(line))
    .filter((cells) => cells.some((cell) => cell !== ''));

  const headerRowIndex = rows.findIndex((cells) => {
    const normalizedCells = cells.map(normalizeText);

    return normalizedCells.includes('ref_date') && normalizedCells.includes('value');
  });

  if (headerRowIndex === -1) {
    throw new Error(`StatCan CSV header not found in ${filePath}`);
  }

  const header = rows[headerRowIndex];

  const dataRows = rows.slice(headerRowIndex + 1).map((cells) => {
    const row = {};

    header.forEach((column, index) => {
      row[column] = cells[index] ?? '';
    });

    return row;
  });

  const filteredRows = dataRows.filter((row) => rowMatchesFilters(row, config.filters));

  const normalizedRows = filteredRows
    .map((row) => {
      const date = normalizeStatCanRefDate(getColumnValue(row, 'REF_DATE'));
      const value = normalizeNumber(getColumnValue(row, 'VALUE'));

      if (!date || value === null) return null;

      return { date, value };
    })
    .filter(Boolean);

  if (normalizedRows.length === 0) {
    throw new Error(`No StatCan rows matched filters for ${indicatorCode}`);
  }

  const seenDates = new Set();
  const duplicateDates = new Set();

  for (const row of normalizedRows) {
    if (seenDates.has(row.date)) {
      duplicateDates.add(row.date);
    }

    seenDates.add(row.date);
  }

  if (duplicateDates.size > 0) {
    const sample = [...duplicateDates].slice(0, 5).join(', ');

    throw new Error(
      `StatCan filters for ${indicatorCode} returned duplicate dates. Tighten filters. Sample duplicate date(s): ${sample}`,
    );
  }

  const transformedRows = applyTransform(normalizedRows, config.transform);

  const cleaned = transformedRows.map((row) => `${row.date},${row.value}`);

  if (cleaned.length === 0) {
    throw new Error(`StatCan transformed rows empty for ${indicatorCode}`);
  }

  const output = ['edate,value', ...cleaned].join('\n');

  fs.writeFileSync(filePath, output);

  return filePath;
};

module.exports = {
  normalizeFredCSV,
  normalizeBoCCSV,
  normalizeStatCanCSV,
};
