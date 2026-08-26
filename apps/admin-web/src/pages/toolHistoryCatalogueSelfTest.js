const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(path.join(__dirname, 'ScriptExecutions.jsx'), 'utf8');

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

assert(
  source.includes("renderSortableHeader('Tool', 'tool')")
    && source.includes("renderSortableHeader('Category', 'category')")
    && source.indexOf("renderSortableHeader('Category', 'category')")
      > source.indexOf("renderSortableHeader('Tool', 'tool')"),
  'Tool Operations must expose Category immediately after Tool.',
);

assert(
  source.includes('{getToolLabel(item)}')
    && source.includes('{getToolCode(item)}')
    && source.includes('sky-muted sky-mono'),
  'Tool Operations must display the tool label with its code beneath it.',
);

assert(
  source.includes('<td>{getCategoryLabel(item)}</td>')
    && source.includes("item?.metadata?.categoryLabel || item?.category"),
  'Tool Operations must render a user-friendly category in its own column.',
);

assert(
  source.includes('colSpan="7"'),
  'Tool Operations loading and empty states must span the seven-column table.',
);

console.log('Tool Operations catalogue self-test passed.');
