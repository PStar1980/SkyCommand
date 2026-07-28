const fs = require('fs');
const path = require('path');

const pagesDirectory = __dirname;
const toolsSource = fs.readFileSync(path.join(pagesDirectory, 'Tools.jsx'), 'utf8');
const manifestSource = fs.readFileSync(
  path.join(pagesDirectory, '../../../api/src/services/toolManifestService.js'),
  'utf8',
);

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

assert(
  toolsSource.includes('<th>Tool</th>')
    && toolsSource.includes('<th>Category</th>')
    && !toolsSource.includes('<th>Code</th>'),
  'Run Tools must combine the tool label and code while exposing Category as the second column.',
);

assert(
  toolsSource.includes('<div className="small sky-mono">{tool.toolCode}</div>')
    && toolsSource.includes('<td>{getCategoryLabel(tool)}</td>'),
  'Run Tools rows must display the tool code beneath the name and category in its own column.',
);

assert(
  toolsSource.includes("tool.runtimeCode || tool.runtimeName || '—'"),
  'Run Tools must render runtime metadata returned by the permission-filtered manifest.',
);

assert(
  manifestSource.includes('tool.runtime_code')
    && manifestSource.includes('runtime.runtime_name')
    && manifestSource.includes('runtimeCode: row.runtime_code || null'),
  'The admin-web tool manifest must hydrate runtime metadata from core.tools and core.runtimes.',
);

console.log('Run Tools catalogue self-test passed.');
