const fs = require('fs');
const path = require('path');

const pageSource = fs.readFileSync(path.join(__dirname, 'SkyWorkflows.jsx'), 'utf8');
const cssSource = fs.readFileSync(path.join(__dirname, '..', 'App.css'), 'utf8');
const pageSizeSource = fs.readFileSync(path.join(__dirname, '..', 'utils', 'tablePageSize.js'), 'utf8');
const workflowExecutorSource = fs.readFileSync(
  path.join(__dirname, '..', '..', '..', 'api', 'src', 'services', 'workflowExecutorService.js'),
  'utf8',
);

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

assert(
  pageSource.includes('sky-workflow-operations-table-frame')
    && pageSource.includes('sky-workflow-operations-table')
    && cssSource.includes('.sky-workflow-operations-table-frame')
    && cssSource.includes('.sky-workflow-operations-table thead th'),
  'Workflow Operations must inherit the canonical inset grid and header treatment.',
);

assert(
  cssSource.includes('.sky-workflow-operations-table tbody tr.sky-selected-row td')
    && cssSource.includes('.sky-workflow-operations-table tbody tr.sky-clickable-row:hover:not(.sky-selected-row) td')
    && cssSource.includes('box-shadow: inset 0 1px 0 var(--sky-tool-table-row-outline);'),
  'Workflow Operations must expose the complete selected and hover gold-row boxes.',
);

for (const [label, field] of [
  ['Workflow', 'workflow'],
  ['Status', 'status'],
  ['Started', 'startedAt'],
  ['Duration', 'durationMs'],
  ['Completed', 'completedAt'],
  ['Runtime', 'runtime'],
]) {
  assert(
    pageSource.includes(`renderHistorySortableHeader('${label}', '${field}')`),
    `${label} must be sortable in Workflow Operations.`,
  );
}

assert(
  pageSource.includes("const WORKFLOW_HISTORY_DEFAULT_SORTS = [{ field: 'startedAt', direction: 'desc' }]")
    && pageSource.includes('Shift+click to add to multi-column sorting')
    && pageSource.includes("activeSort?.direction === 'asc' ? '↑' : '↓'")
    && pageSource.includes("{activeSort ? directionIcon : '↕'}")
    && pageSource.includes('Clear sorting'),
  'Workflow Operations must default to newest-first and expose priority-aware multi-column sorting.',
);

assert(
  pageSource.includes('sky-workflow-operations-pagination-row')
    && pageSource.includes('id="workflowHistoryRowsSelect"')
    && pageSource.includes('historyAvailablePageSizes.map')
    && pageSource.includes('changeHistoryPageSize')
    && pageSource.includes('historyBrowserRef.current?.scrollIntoView')
    && pageSource.includes('aria-label="First page"')
    && pageSource.includes('aria-label="Previous page"')
    && pageSource.includes('aria-label="Next page"')
    && pageSource.includes('aria-label="Last page"'),
  'Workflow Operations must use the centered canonical gold paginator with smart row sizing and browser re-anchoring.',
);


assert(
  pageSizeSource.includes('export const SMART_TABLE_PAGE_SIZE_OPTIONS = [10, 25, 50]')
    && pageSizeSource.includes('if (size === 25) return recordCount >= 11;')
    && pageSizeSource.includes('if (size === 50) return recordCount >= 26;')
    && pageSizeSource.includes('normalizeTablePageSize')
    && cssSource.includes('.sky-canonical-rows-control')
    && cssSource.includes('.sky-table-browser-anchor'),
  'Workflow row sizing must share the canonical smart 10/25/50 thresholds and browser-anchor treatment.',
);

assert(
  workflowExecutorSource.includes("const { buildWhitelistedOrderBy } = require('./tableSortUtils');")
    && workflowExecutorSource.includes('sortValue: filters.sort')
    && workflowExecutorSource.includes("workflow: \"LOWER(COALESCE(NULLIF(BTRIM(workflow_display_name), ''), workflow_code))\"")
    && workflowExecutorSource.includes("startedAt: 'COALESCE(started_at, created_at)'")
    && workflowExecutorSource.includes("completedAt: 'completed_at'")
    && workflowExecutorSource.includes("runtime: \"CASE WHEN temporal_workflow_id IS NOT NULL THEN 'temporal' ELSE 'inline' END\"")
    && workflowExecutorSource.includes("tieBreakers: ['created_at DESC', 'workflow_run_record_id DESC']"),
  'Workflow Operations sorting must execute through the shared whitelisted deterministic ORDER BY contract.',
);

console.log('Workflow Operations canonical table self-test passed.');
