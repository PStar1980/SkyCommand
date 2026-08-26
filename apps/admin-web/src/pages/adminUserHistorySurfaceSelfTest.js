const fs = require('fs');
const path = require('path');

const pagesDirectory = __dirname;
const historySource = fs.readFileSync(path.join(pagesDirectory, 'AuditEvents.jsx'), 'utf8');
const cssSource = fs.readFileSync(path.join(pagesDirectory, '..', 'App.css'), 'utf8');

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

assert(
  historySource.includes('sky-functional-history-browser sky-admin-user-history-browser')
    && historySource.includes('User history browser')
    && historySource.includes('Access activity directory')
    && historySource.includes('History source')
    && historySource.includes('Audit events')
    && historySource.includes('Login attempts'),
  'User History must use one dual-source browser card for audit and login activity.',
);

assert(
  historySource.includes("renderSortableHeader('Event', 'event')")
    && historySource.includes("renderSortableHeader('Action', 'action')")
    && historySource.includes("renderSortableHeader('User', 'user')")
    && historySource.includes("renderSortableHeader('Application', 'application')")
    && historySource.includes("renderSortableHeader('Role', 'role')")
    && historySource.includes("renderSortableHeader('Reason', 'reason')")
    && historySource.includes("renderSortableHeader('Privilege', 'privilege')")
    && historySource.includes("renderSortableHeader('Result', 'result')")
    && historySource.includes("renderSortableHeader('Created', 'created')")
    && historySource.includes('Shift+click to add to multi-column sorting')
    && historySource.includes('Clear sorting'),
  'User History browser headers must use source-aware canonical multi-column sorting controls.',
);

assert(
  historySource.includes('sky-canonical-operations-table-frame')
    && historySource.includes('sky-canonical-operations-table align-middle mb-0')
    && historySource.includes('sky-canonical-operations-pagination-row')
    && historySource.includes('sky-canonical-rows-control')
    && historySource.includes('className="btn btn-sm sky-pagination-nav-button"'),
  'User History browser must use the canonical table frame, centered pagination, and right-aligned Rows control.',
);

assert(
  historySource.includes('const USER_HISTORY_FETCH_LIMIT = 200;')
    && historySource.includes('async function fetchAllHistory')
    && historySource.includes('offset += batch.length;'),
  'User History must fetch complete filtered evidence in API-safe 200-row batches before client sorting and smart client pagination.',
);

assert(
  !historySource.includes('col-xxl-9')
    && !historySource.includes('col-xxl-3')
    && historySource.indexOf('sky-admin-user-history-browser') < historySource.indexOf('sky-admin-user-history-detail-card'),
  'User History detail must be a full-width workspace below the browser instead of a right-side rail.',
);

assert(
  historySource.includes('Identity &amp; outcome')
    && historySource.includes('Client evidence')
    && historySource.includes('Authorization event')
    && historySource.includes('Authorization metadata')
    && historySource.includes('sky-admin-user-history-detail-grid')
    && historySource.includes('sky-admin-user-history-evidence-grid'),
  'User History detail must provide source-aware login/client and audit/authorization evidence sections.',
);

assert(
  cssSource.includes('.sky-admin-user-history-filter-grid')
    && cssSource.includes('.sky-admin-user-history-detail-stack')
    && cssSource.includes('.sky-admin-user-history-detail-section')
    && cssSource.includes('.sky-admin-user-history-detail-grid')
    && cssSource.includes('.sky-admin-user-history-evidence-grid'),
  'User History layout styles must support the canonical browser and full-width forensic detail workspace.',
);


assert(
  historySource.includes("from '../utils/tablePageSize.js'")
    && historySource.includes('id="userHistoryRowsSelect"')
    && historySource.includes('getAvailableTablePageSizes(sortedItems.length)')
    && historySource.includes('normalizeTablePageSize(pageSize, sortedItems.length)')
    && historySource.includes('Showing {rangeStart}–{rangeEnd} of {sortedItems.length} {sourceLabel}(s)'),
  'User History browser must use the canonical smart Rows selector and actual rendered-range math.',
);

assert(
  historySource.includes(`<div className="fw-bold">\n                        {item.success ? 'LOGIN_SUCCESS' : 'LOGIN_FAILED'}`)
    && historySource.includes('<td className="sky-mono">authenticate</td>')
    && historySource.includes('<div className="fw-bold">{getLoginUserLabel(item)}</div>')
    && historySource.includes('<div className="fw-bold">{item.eventType}</div>')
    && historySource.includes('<td className="sky-mono">{item.action}</td>')
    && historySource.includes('<div className="fw-bold">{getUserLabel(item)}</div>'),
  'User History browser rows must use the canonical primary/body typography hierarchy in both source modes.',
);

console.log('[SkyCommand] Admin User History surface self-test passed.');
