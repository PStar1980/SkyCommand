const fs = require('fs');
const path = require('path');

const pageSource = fs.readFileSync(path.join(__dirname, 'ScriptExecutions.jsx'), 'utf8');
const cssSource = fs.readFileSync(path.join(__dirname, '..', 'App.css'), 'utf8');
const adminReadServiceSource = fs.readFileSync(
  path.join(__dirname, '..', '..', '..', 'api', 'src', 'services', 'adminReadService.js'),
  'utf8',
);
const sortUtilitySource = fs.readFileSync(
  path.join(__dirname, '..', '..', '..', 'api', 'src', 'services', 'tableSortUtils.js'),
  'utf8',
);

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

assert(
  pageSource.includes("const TOOL_HISTORY_DEFAULT_SORTS = [{ field: 'startedAt', direction: 'desc' }]")
    && pageSource.includes('sort: serializeSorts(nextSorts)'),
  'Tool Operations must default to newest-first sorting and send the complete sort stack to the API.',
);

for (const [label, field] of [
  ['Tool', 'tool'],
  ['Category', 'category'],
  ['Status', 'status'],
  ['Started', 'startedAt'],
  ['Duration', 'durationMs'],
  ['Completed', 'finishedAt'],
]) {
  assert(
    pageSource.includes(`renderSortableHeader('${label}', '${field}')`),
    `${label} must be a sortable Tool Operations column.`,
  );
}

assert(
  pageSource.includes('Shift+click to add to multi-column sorting')
    && pageSource.includes("activeSort?.direction === 'asc' ? '↑' : '↓'")
    && pageSource.includes("{activeSort ? directionIcon : '↕'}")
    && pageSource.includes('{activeIndex + 1}'),
  'Tool Operations headers must expose direction indicators, default indicators, and numeric sort priority.',
);

assert(
  pageSource.includes('sortingCustomized && (')
    && pageSource.includes('Clear sorting')
    && pageSource.includes('setCurrentPage(1);'),
  'Custom Tool Operations sorting must expose Clear sorting and reset pagination to page one.',
);

assert(
  cssSource.includes('.sky-table-sort-button')
    && cssSource.includes('.sky-table-sort-indicator')
    && cssSource.includes('.sky-table-sort-priority'),
  'Sortable Tool Operations headers must use the dedicated Midnight Gold sort-control treatment.',
);

assert(
  adminReadServiceSource.includes('buildWhitelistedOrderBy({')
    && adminReadServiceSource.includes("sortValue: filters.sort")
    && adminReadServiceSource.includes("startedAt: 'started_at'")
    && adminReadServiceSource.includes("durationMs: 'duration_ms'")
    && adminReadServiceSource.includes("tieBreakers: ['execution_id DESC']"),
  'Tool Operations sorting must execute server-side using a whitelisted deterministic ORDER BY contract.',
);

assert(
  sortUtilitySource.includes('parseWhitelistedSortSpec')
    && sortUtilitySource.includes("expectedFormat: 'field:asc,otherField:desc'")
    && sortUtilitySource.includes('Unsupported sort field')
    && sortUtilitySource.includes('may only be specified once'),
  'The shared table-sort utility must reject arbitrary, malformed, and duplicate sort expressions.',
);

console.log('Tool Operations multi-column sorting self-test passed.');
