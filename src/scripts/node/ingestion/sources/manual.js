const fs = require('fs');
const path = require('path');

const configPath = path.join(__dirname, '..', 'config', 'manualIngestion.json');

const cleanHeader = (value) =>
  String(value ?? '')
    .replace(/^\uFEFF/, '')
    .trim();

const normalizePath = (value) => String(value).replace(/\\/g, '/');

const safeName = (value) =>
  String(value || 'manual')
    .replace(/[^A-Za-z0-9_]/g, '_')
    .toLowerCase();

const csvEscape = (value) => {
  const text = String(value ?? '').trim();

  if (/[",\r\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }

  return text;
};

const parseDelimitedLine = (line, delimiter = ',') => {
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
    } else if (char === delimiter && !inQuotes) {
      cells.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }

  cells.push(current.trim());

  return cells.map(cleanHeader);
};

const formatSpreadsheetValue = (value) => {
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }

  return String(value ?? '').trim();
};

const assertSafeIdentifier = (value) => {
  if (!/^[A-Za-z0-9_]+$/.test(value)) {
    throw new Error(`Unsafe identifier: ${value}`);
  }
};

const validateJob = (job) => {
  if (!job.table) {
    throw new Error('Manual ingestion job requires table');
  }

  if (!job.spreadsheet?.fileName) {
    throw new Error('Manual ingestion job requires spreadsheet.fileName');
  }

  if (!Array.isArray(job.columns) || job.columns.length === 0) {
    throw new Error('Manual ingestion job requires at least one column mapping');
  }

  assertSafeIdentifier(job.schema || 'public');
  assertSafeIdentifier(job.table);

  for (const column of job.columns) {
    if (!column.spreadsheetColumn || !column.databaseColumn) {
      throw new Error('Each column mapping requires spreadsheetColumn and databaseColumn');
    }

    assertSafeIdentifier(column.databaseColumn);
  }
};

const readDelimitedFile = (filePath, headerRow, delimiter) => {
  const raw = fs.readFileSync(filePath, 'utf-8');
  const lines = raw.split(/\r?\n/).filter((line) => line.trim() !== '');

  const headerIndex = headerRow - 1;

  if (headerIndex < 0 || headerIndex >= lines.length) {
    throw new Error(`Header row ${headerRow} is outside the source file range`);
  }

  const headers = parseDelimitedLine(lines[headerIndex], delimiter);

  const rows = lines
    .slice(headerIndex + 1)
    .map((line) => {
      const cells = parseDelimitedLine(line, delimiter);
      const row = {};

      headers.forEach((header, index) => {
        row[header] = cells[index] ?? '';
      });

      return row;
    })
    .filter((row) => Object.values(row).some((value) => String(value).trim() !== ''));

  return { headers, rows };
};

const readExcelFile = (filePath, sheetName, headerRow) => {
  let XLSX;

  try {
    XLSX = require('xlsx');
  } catch {
    throw new Error('Excel manual ingestion requires xlsx. Run: npm install xlsx');
  }

  const workbook = XLSX.readFile(filePath, {
    cellDates: true,
  });

  const selectedSheetName = sheetName || workbook.SheetNames[0];

  if (!selectedSheetName || !workbook.Sheets[selectedSheetName]) {
    throw new Error(`Worksheet not found: ${selectedSheetName}`);
  }

  const worksheet = workbook.Sheets[selectedSheetName];

  const sheetRows = XLSX.utils.sheet_to_json(worksheet, {
    header: 1,
    defval: '',
    raw: false,
  });

  const headerIndex = headerRow - 1;

  if (headerIndex < 0 || headerIndex >= sheetRows.length) {
    throw new Error(`Header row ${headerRow} is outside the worksheet range`);
  }

  const headers = sheetRows[headerIndex].map(cleanHeader);

  const rows = sheetRows
    .slice(headerIndex + 1)
    .map((cells) => {
      const row = {};

      headers.forEach((header, index) => {
        row[header] = formatSpreadsheetValue(cells[index]);
      });

      return row;
    })
    .filter((row) => Object.values(row).some((value) => String(value).trim() !== ''));

  return { headers, rows };
};

const readSpreadsheet = (spreadsheet) => {
  const folder = spreadsheet.folder || '';
  const fileName = spreadsheet.fileName;
  const filePath = path.resolve(folder, fileName);
  const extension = path.extname(filePath).toLowerCase();
  const headerRow = Number(spreadsheet.headerRow || 1);

  if (!fs.existsSync(filePath)) {
    throw new Error(`Source spreadsheet not found: ${filePath}`);
  }

  if (extension === '.csv') {
    return {
      filePath,
      ...readDelimitedFile(filePath, headerRow, ','),
    };
  }

  if (extension === '.tsv' || extension === '.txt') {
    return {
      filePath,
      ...readDelimitedFile(filePath, headerRow, '\t'),
    };
  }

  if (extension === '.xlsx' || extension === '.xls') {
    return {
      filePath,
      ...readExcelFile(filePath, spreadsheet.sheetName, headerRow),
    };
  }

  throw new Error(`Unsupported spreadsheet type: ${extension}`);
};

const getManualJobs = () => {
  if (!fs.existsSync(configPath)) {
    throw new Error(`Manual ingestion config not found: ${configPath}`);
  }

  const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  const jobs = Array.isArray(config.jobs) ? config.jobs : [config];

  return jobs.map((job) => ({
    schema: 'public',
    updateOnConflict: true,
    ...job,
  }));
};

const buildManualCSV = async (code, outputDir, job) => {
  validateJob(job);

  const { filePath, headers, rows } = readSpreadsheet(job.spreadsheet);

  const mappings = job.columns.map((column) => ({
    spreadsheetColumn: cleanHeader(column.spreadsheetColumn),
    databaseColumn: cleanHeader(column.databaseColumn),
  }));

  const missingColumns = mappings
    .filter((mapping) => !headers.includes(mapping.spreadsheetColumn))
    .map((mapping) => mapping.spreadsheetColumn);

  if (missingColumns.length > 0) {
    throw new Error(`Missing source column(s): ${missingColumns.join(', ')}`);
  }

  const databaseColumns = mappings.map((mapping) => mapping.databaseColumn);
  const outputFile = path.join(outputDir, `manual_${safeName(code)}_${process.pid}.csv`);

  const outputLines = [databaseColumns.map(csvEscape).join(',')];

  for (const row of rows) {
    const values = mappings.map((mapping) => csvEscape(row[mapping.spreadsheetColumn]));
    outputLines.push(values.join(','));
  }

  fs.writeFileSync(outputFile, outputLines.join('\n'), 'utf-8');

  job.__manual = {
    sourceFile: filePath,
    mappedColumns: databaseColumns,
    sourceRows: rows.length,
  };

  console.log(`📄 source_file=${normalizePath(filePath)}`);
  console.log(`🎯 target_table=${job.schema}.${job.table}`);
  console.log(`🧩 mapped_columns=${databaseColumns.length}`);
  console.log(`📊 source_rows=${rows.length}`);

  return outputFile;
};

module.exports = {
  getManualJobs,
  buildManualCSV,
};
