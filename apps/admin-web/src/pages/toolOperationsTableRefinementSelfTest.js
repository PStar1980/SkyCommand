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
    && cssSource.includes('font-size: 1.08rem;'),
  'Tool Operations must expose the enlarged canonical prototype header row.',
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
