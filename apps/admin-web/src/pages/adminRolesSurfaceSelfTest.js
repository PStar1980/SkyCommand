const fs = require('fs');
const path = require('path');

const pagesDirectory = __dirname;
const rolesSource = fs.readFileSync(path.join(pagesDirectory, 'AdminRoles.jsx'), 'utf8');
const cssSource = fs.readFileSync(path.join(pagesDirectory, '..', 'App.css'), 'utf8');

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

assert(
  rolesSource.includes('sky-functional-history-browser sky-admin-roles-browser')
    && rolesSource.includes('Role browser')
    && rolesSource.includes('Role directory')
    && !rolesSource.includes('onSubmit={handleApplyFilters}')
    && !rolesSource.includes('id="roleLimit"')
    && !rolesSource.includes('>Apply<'),
  'Roles must use a single browser card with auto-applied filters rather than the legacy filter-only form.',
);

assert(
  rolesSource.includes("renderSortableHeader('Role', 'role')")
    && rolesSource.includes("renderSortableHeader('Application', 'application')")
    && rolesSource.includes("renderSortableHeader('Status', 'status')")
    && rolesSource.includes("renderSortableHeader('System', 'system')")
    && rolesSource.includes("renderSortableHeader('Updated', 'updated')")
    && rolesSource.includes('Shift+click to add to multi-column sorting')
    && rolesSource.includes('Clear sorting'),
  'Roles browser headers must use canonical multi-column sorting controls.',
);

assert(
  rolesSource.includes('sky-canonical-operations-table-frame')
    && rolesSource.includes('sky-canonical-operations-table align-middle mb-0')
    && rolesSource.includes('sky-canonical-operations-pagination-row')
    && rolesSource.includes('sky-canonical-rows-control')
    && rolesSource.includes('className="btn btn-sm sky-pagination-nav-button"'),
  'Roles browser must use the canonical table frame, centered pagination, and right-aligned Rows control.',
);

assert(
  rolesSource.includes('const ROLE_FETCH_LIMIT = 200;')
    && rolesSource.includes('async function fetchAllRoles')
    && rolesSource.includes('offset += batch.length;'),
  'Roles must fetch the complete filtered directory in API-safe 200-row batches before client sorting and pagination.',
);

assert(
  rolesSource.indexOf('sky-admin-roles-browser') < rolesSource.indexOf('sky-admin-role-detail-card')
    && !rolesSource.includes('col-xl-7')
    && !rolesSource.includes('col-xl-5'),
  'Role detail must be a full-width workspace below the browser rather than a right-side rail.',
);

assert(
  rolesSource.includes('Role identity &amp; lifecycle')
    && rolesSource.includes('Permissions &amp; membership')
    && rolesSource.includes('sky-admin-role-identity-grid')
    && rolesSource.includes('sky-admin-role-access-grid')
    && rolesSource.includes('sky-admin-role-permissions-panel')
    && rolesSource.includes('sky-admin-role-users-panel'),
  'Role detail must be reorganized into identity/lifecycle and permissions/membership workspace sections.',
);

assert(
  cssSource.includes('.sky-admin-roles-filter-grid')
    && cssSource.includes('.sky-admin-role-detail-stack')
    && cssSource.includes('.sky-admin-role-identity-grid')
    && cssSource.includes('.sky-admin-role-access-grid')
    && cssSource.includes('.sky-admin-role-permission-select'),
  'Admin Roles layout styles must support the canonical browser and full-width role workspace.',
);


assert(
  rolesSource.includes("from '../utils/tablePageSize.js'")
    && rolesSource.includes('id="rolesRowsSelect"')
    && rolesSource.includes('getAvailableTablePageSizes(sortedRoles.length)')
    && rolesSource.includes('normalizeTablePageSize(pageSize, sortedRoles.length)')
    && rolesSource.includes('Showing {rangeStart}–{rangeEnd} of {sortedRoles.length} role(s)'),
  'Roles browser must use the canonical smart Rows selector and actual rendered-range math.',
);

assert(
  rolesSource.includes('<div className="fw-bold sky-mono">{role.roleCode}</div>')
    && rolesSource.includes('<div className="small sky-muted">{role.roleName}</div>'),
  'Roles browser rows must use canonical bold primary and muted secondary typography.',
);

console.log('[SkyCommand] Admin Roles surface self-test passed.');
