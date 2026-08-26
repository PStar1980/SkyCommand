const fs = require('fs');
const path = require('path');

const pagesDirectory = __dirname;
const privilegesSource = fs.readFileSync(path.join(pagesDirectory, 'AdminPrivileges.jsx'), 'utf8');
const cssSource = fs.readFileSync(path.join(pagesDirectory, '..', 'App.css'), 'utf8');

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

assert(
  privilegesSource.includes('sky-functional-history-browser sky-admin-privileges-browser')
    && privilegesSource.includes('Privilege browser')
    && privilegesSource.includes('Privilege directory')
    && !privilegesSource.includes('onSubmit={handleApplyFilters}')
    && !privilegesSource.includes('id="permissionLimit"')
    && !privilegesSource.includes('>Go<'),
  'Privileges must use a single browser card with auto-applied filters instead of the legacy filter-only form.',
);

assert(
  privilegesSource.includes("renderSortableHeader('Privilege', 'privilege')")
    && privilegesSource.includes("renderSortableHeader('Application', 'application')")
    && privilegesSource.includes("renderSortableHeader('Resource', 'resource')")
    && privilegesSource.includes("renderSortableHeader('Action', 'action')")
    && privilegesSource.includes("renderSortableHeader('Status', 'status')")
    && privilegesSource.includes('Shift+click to add to multi-column sorting')
    && privilegesSource.includes('Clear sorting'),
  'Privileges browser headers must use canonical multi-column sorting controls.',
);

assert(
  privilegesSource.includes('sky-canonical-operations-table-frame')
    && privilegesSource.includes('sky-canonical-operations-table align-middle mb-0')
    && privilegesSource.includes('sky-canonical-operations-pagination-row')
    && privilegesSource.includes('sky-canonical-rows-control')
    && privilegesSource.includes('className="btn btn-sm sky-pagination-nav-button"'),
  'Privileges browser must use the canonical table frame, centered pagination, and right-aligned Rows control.',
);

assert(
  privilegesSource.includes('const PRIVILEGE_FETCH_LIMIT = 200;')
    && privilegesSource.includes('async function fetchAllPermissions')
    && privilegesSource.includes('offset += batch.length;'),
  'Privileges must fetch the complete filtered directory in API-safe 200-row batches before client sorting and pagination.',
);

assert(
  privilegesSource.indexOf('sky-admin-privileges-browser') < privilegesSource.indexOf('sky-admin-privilege-detail-card')
    && !privilegesSource.includes('col-xl-7')
    && !privilegesSource.includes('col-xl-5'),
  'Privilege detail must be a full-width workspace below the browser rather than a right-side rail.',
);

assert(
  privilegesSource.includes('Privilege identity &amp; lifecycle')
    && privilegesSource.includes('Role grants &amp; usage')
    && privilegesSource.includes('sky-admin-privilege-identity-grid')
    && privilegesSource.includes('sky-admin-privilege-status-row')
    && privilegesSource.includes('sky-admin-privilege-grants-panel'),
  'Privilege detail must be reorganized into identity/lifecycle and role-grant workspace sections.',
);

assert(
  cssSource.includes('.sky-admin-privileges-filter-grid')
    && cssSource.includes('.sky-admin-privilege-detail-stack')
    && cssSource.includes('.sky-admin-privilege-identity-grid')
    && cssSource.includes('.sky-admin-privilege-status-row')
    && cssSource.includes('.sky-admin-privilege-grants-panel'),
  'Admin Privileges layout styles must support the canonical browser and full-width privilege workspace.',
);


assert(
  privilegesSource.includes("from '../utils/tablePageSize.js'")
    && privilegesSource.includes('id="privilegesRowsSelect"')
    && privilegesSource.includes('getAvailableTablePageSizes(sortedPermissions.length)')
    && privilegesSource.includes('normalizeTablePageSize(pageSize, sortedPermissions.length)')
    && privilegesSource.includes('Showing {rangeStart}–{rangeEnd} of {sortedPermissions.length} privilege(s)'),
  'Privileges browser must use the canonical smart Rows selector and actual rendered-range math.',
);

assert(
  privilegesSource.includes('<div className="fw-bold sky-mono">{permission.permissionCode}</div>')
    && privilegesSource.includes(`<div className="small sky-muted sky-truncate">{permission.description || '—'}</div>`)
    && privilegesSource.includes('<td className="sky-mono">{permission.resource}</td>')
    && privilegesSource.includes('<td className="sky-mono">{permission.action}</td>'),
  'Privileges browser rows must use canonical primary/secondary typography while retaining semantic monospace code cells.',
);

console.log('[SkyCommand] Admin Privileges surface self-test passed.');
