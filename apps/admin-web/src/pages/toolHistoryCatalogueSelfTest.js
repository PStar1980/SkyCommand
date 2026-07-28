const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(path.join(__dirname, 'ScriptExecutions.jsx'), 'utf8');

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

assert(
  source.includes('<th>Tool</th>')
    && source.includes('<th>Category</th>')
    && source.indexOf('<th>Category</th>') > source.indexOf('<th>Tool</th>'),
  'Tool History must expose Category immediately after Tool.',
);

assert(
  source.includes('{getToolLabel(item)}')
    && source.includes('{getToolCode(item)}')
    && source.includes('sky-muted sky-mono'),
  'Tool History must display the tool label with its code beneath it.',
);

assert(
  source.includes('<td>{getCategoryLabel(item)}</td>')
    && source.includes("item?.metadata?.categoryLabel || item?.category"),
  'Tool History must render a user-friendly category in its own column.',
);

assert(
  source.includes('colSpan="7"'),
  'Tool History loading and empty states must span the seven-column table.',
);

console.log('Tool History catalogue self-test passed.');
