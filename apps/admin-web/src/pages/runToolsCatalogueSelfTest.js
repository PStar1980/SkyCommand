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
  toolsSource.includes("renderSortableHeader('Tool', 'tool')")
    && toolsSource.includes("renderSortableHeader('Category', 'category')")
    && toolsSource.includes("renderSortableHeader('Runtime', 'runtime')")
    && toolsSource.includes("renderSortableHeader('Risk', 'risk')")
    && toolsSource.includes("renderSortableHeader('Parameters', 'parameters')")
    && toolsSource.includes("renderSortableHeader('Output contract', 'outputContract')")
    && toolsSource.includes("renderSortableHeader('Status', 'status')")
    && toolsSource.includes('Shift+click to add to multi-column sorting')
    && toolsSource.includes('Clear sorting'),
  'Run Tools catalogue headers must use canonical multi-column sorting controls.',
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
  toolsSource.includes('sky-canonical-operations-table-frame')
    && toolsSource.includes('sky-canonical-operations-table align-middle mb-0')
    && toolsSource.includes('sky-canonical-operations-pagination-row')
    && toolsSource.includes('sky-canonical-operations-pagination-balance')
    && toolsSource.includes('className="btn btn-sm sky-pagination-nav-button"'),
  'Run Tools catalogue must use the canonical table frame and centered gold pagination.',
);


assert(
  toolsSource.includes('const defaultTool = sortItemsBySorts(')
    && toolsSource.includes("setSelectedToolCode(defaultTool?.toolCode || '')")
    && toolsSource.includes('setParameterValues(defaultTool ? getInitialParameterValues(defaultTool) : {})'),
  'Run Tools must automatically select and hydrate the first tool under the default catalogue sort when no tool deep-link is requested.',
);

assert(
  !toolsSource.includes('<th className="text-end">Actions</th>')
    && toolsSource.includes("<StatusPill status={tool.enabled ? 'ACTIVE' : 'OFFLINE'}>")
    && toolsSource.includes("{tool.enabled ? 'Enabled' : 'Disabled'}"),
  'Run Tools must use row selection without a redundant Actions column and display the catalogue enabled status.',
);

assert(
  manifestSource.includes('tool.runtime_code')
    && manifestSource.includes('runtime.runtime_name')
    && manifestSource.includes('runtimeCode: row.runtime_code || null'),
  'The admin-web tool manifest must hydrate runtime metadata from core.tools and core.runtimes.',
);

console.log('Run Tools catalogue self-test passed.');
