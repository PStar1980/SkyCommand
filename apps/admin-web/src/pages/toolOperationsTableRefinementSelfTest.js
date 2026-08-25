const fs = require('fs');
const path = require('path');

const pageSource = fs.readFileSync(path.join(__dirname, 'ScriptExecutions.jsx'), 'utf8');
const cssSource = fs.readFileSync(path.join(__dirname, '..', 'App.css'), 'utf8');

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

assert(
  pageSource.includes('sky-tool-operations-table-frame')
    && cssSource.includes('.sky-tool-operations-table-frame')
    && cssSource.includes('padding-inline: 1rem;'),
  'Tool Operations table must use an inset frame so the table aligns with browser content.',
);

assert(
  pageSource.includes('sky-tool-operations-table')
    && cssSource.includes('.sky-tool-operations-table thead th')
    && cssSource.includes('padding-top: 0.78rem;')
    && cssSource.includes('font-size: 0.82rem;'),
  'Tool Operations must keep the taller prototype header row while sizing labels below the browser kicker hierarchy.',
);

assert(
  cssSource.includes('--sky-tool-table-grid: rgba(220, 177, 63, 0.27);')
    && cssSource.includes('border: 1px solid var(--sky-tool-table-grid);')
    && cssSource.includes('.sky-tool-operations-table tbody td'),
  'Tool Operations must expose a crisp table perimeter plus row and column grid lines using the card-outline gold.',
);

assert(
  cssSource.includes('tr.sky-clickable-row:hover:not(.sky-selected-row) td')
    && cssSource.includes('background: transparent;')
    && cssSource.includes('tr.sky-selected-row td,')
    && cssSource.includes('background: rgba(220, 177, 63, 0.105);')
    && cssSource.includes('--sky-tool-table-row-outline: rgba(255, 217, 120, 0.88);')
    && cssSource.includes('box-shadow: inset 0 1px 0 var(--sky-tool-table-row-outline);')
    && cssSource.includes('tr.sky-selected-row td:first-child,')
    && cssSource.includes('tr.sky-clickable-row:hover:not(.sky-selected-row) td:first-child {\n  border-left-color: var(--sky-tool-table-row-outline);\n  box-shadow: inset 0 1px 0 var(--sky-tool-table-row-outline);'),
  'Tool Operations must distinguish transparent outlined hover rows from solid-gold selected rows with a complete gold perimeter, including the first-cell top edge.',
);

assert(
  pageSource.includes('sky-tool-operations-pagination-row')
    && cssSource.includes('grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);')
    && pageSource.includes('sky-tool-operations-pagination-balance'),
  'Tool Operations pagination controls must be centered independently of the range summary.',
);

for (const [label, symbol] of [
  ['First page', '«'],
  ['Previous page', '‹'],
  ['Next page', '›'],
  ['Last page', '»'],
]) {
  assert(
    pageSource.includes(`aria-label="${label}"`) && pageSource.includes(symbol),
    `Tool Operations pagination must include the ${label} gold icon control.`,
  );
}

assert(
  cssSource.includes('.sky-pagination-nav-button')
    && cssSource.includes('background: linear-gradient(180deg, #f1c957, #c99422);'),
  'Tool Operations pagination navigation must use the custom gold control treatment.',
);

console.log('Tool Operations table refinement self-test passed.');
