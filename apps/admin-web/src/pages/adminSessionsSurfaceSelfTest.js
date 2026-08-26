const fs = require('fs');
const path = require('path');

const pagesDirectory = __dirname;
const sessionsSource = fs.readFileSync(path.join(pagesDirectory, 'AdminSessions.jsx'), 'utf8');
const cssSource = fs.readFileSync(path.join(pagesDirectory, '..', 'App.css'), 'utf8');

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

assert(
  sessionsSource.includes('sky-functional-history-browser sky-admin-sessions-browser')
    && sessionsSource.includes('Session browser')
    && sessionsSource.includes('Active session directory')
    && !sessionsSource.includes('onSubmit={applyFilters}')
    && !sessionsSource.includes('id="sessionLimit"')
    && !sessionsSource.includes('>Apply<'),
  'Sessions must use a single browser card with auto-applied filters rather than the legacy filter-only form.',
);

assert(
  sessionsSource.includes("renderSortableHeader('User', 'user')")
    && sessionsSource.includes("renderSortableHeader('Application', 'application')")
    && sessionsSource.includes("renderSortableHeader('Session', 'session')")
    && sessionsSource.includes("renderSortableHeader('Client', 'client')")
    && sessionsSource.includes("renderSortableHeader('Last seen', 'lastSeen')")
    && sessionsSource.includes("renderSortableHeader('Expires', 'expires')")
    && sessionsSource.includes('Shift+click to add to multi-column sorting')
    && sessionsSource.includes('Clear sorting'),
  'Sessions browser headers must use canonical multi-column sorting controls.',
);

assert(
  sessionsSource.includes('sky-canonical-operations-table-frame')
    && sessionsSource.includes('sky-canonical-operations-table align-middle mb-0')
    && sessionsSource.includes('sky-canonical-operations-pagination-row')
    && sessionsSource.includes('sky-canonical-rows-control')
    && sessionsSource.includes('className="btn btn-sm sky-pagination-nav-button"'),
  'Sessions browser must use the canonical table frame, centered pagination, and right-aligned Rows control.',
);

assert(
  sessionsSource.includes('const SESSION_FETCH_LIMIT = 200;')
    && sessionsSource.includes('async function fetchAllSessions')
    && sessionsSource.includes('offset += batch.length;'),
  'Sessions must fetch the complete filtered directory in API-safe 200-row batches before client sorting and pagination.',
);

assert(
  !sessionsSource.includes('<th>Actions</th>')
    && !sessionsSource.includes('>Inspect<')
    && sessionsSource.includes('Security &amp; session control')
    && sessionsSource.includes('Revoke session'),
  'Sessions must use row selection and keep revoke controls in the selected-session workspace instead of a browser Actions column.',
);

assert(
  sessionsSource.indexOf('sky-admin-sessions-browser') < sessionsSource.indexOf('sky-admin-session-detail-card')
    && !sessionsSource.includes('col-xl-8')
    && !sessionsSource.includes('col-xl-4'),
  'Session detail must be a full-width workspace below the browser rather than a right-side rail.',
);

assert(
  sessionsSource.includes('Identity &amp; session')
    && sessionsSource.includes('Client evidence')
    && sessionsSource.includes('Security &amp; session control')
    && sessionsSource.includes('sky-admin-session-overview-grid')
    && sessionsSource.includes('sky-admin-session-evidence-grid'),
  'Session detail must be reorganized into identity, evidence, and security-control sections.',
);

assert(
  cssSource.includes('.sky-admin-sessions-filter-grid')
    && cssSource.includes('.sky-admin-session-detail-stack')
    && cssSource.includes('.sky-admin-session-overview-grid')
    && cssSource.includes('.sky-admin-session-evidence-grid')
    && cssSource.includes('.sky-access-control-surface-row'),
  'Sessions layout styles must support the canonical browser, full-width detail workspace, and standard card rhythm.',
);


assert(
  sessionsSource.includes("from '../utils/tablePageSize.js'")
    && sessionsSource.includes('id="sessionsRowsSelect"')
    && sessionsSource.includes('getAvailableTablePageSizes(sortedSessions.length)')
    && sessionsSource.includes('normalizeTablePageSize(pageSize, sortedSessions.length)')
    && sessionsSource.includes('Showing {rangeStart}–{rangeEnd} of {sortedSessions.length} active session(s)'),
  'Sessions browser must use the canonical smart Rows selector and actual rendered-range math.',
);

assert(
  sessionsSource.includes(`<div className="fw-bold">\n                        {item.displayName || item.username || 'Unknown user'}`)
    && sessionsSource.includes('<div className="small sky-muted">{item.email}</div>')
    && sessionsSource.includes('<div className="sky-mono">{getShortId(item.sessionId)}</div>')
    && sessionsSource.includes("<div>{item.ipAddress || '—'}</div>"),
  'Sessions browser rows must use canonical primary, secondary, identifier, and body-cell typography.',
);

console.log('[SkyCommand] Admin Sessions surface self-test passed.');
