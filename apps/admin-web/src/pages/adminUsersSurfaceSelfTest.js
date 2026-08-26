const fs = require('fs');
const path = require('path');

const pagesDirectory = __dirname;
const usersSource = fs.readFileSync(path.join(pagesDirectory, 'AdminUsers.jsx'), 'utf8');
const cssSource = fs.readFileSync(path.join(pagesDirectory, '..', 'App.css'), 'utf8');

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

assert(
  usersSource.includes('sky-functional-history-browser sky-admin-users-browser')
    && usersSource.includes('User browser')
    && usersSource.includes('User directory')
    && !usersSource.includes('onSubmit={handleApplyFilters}')
    && !usersSource.includes('id="userLimit"'),
  'Users must use a single browser card containing auto-applied filters rather than the legacy filter-only card.',
);

assert(
  usersSource.includes("renderSortableHeader('User', 'user')")
    && usersSource.includes("renderSortableHeader('Status', 'status')")
    && usersSource.includes("renderSortableHeader('System', 'system')")
    && usersSource.includes("renderSortableHeader('Last login', 'lastLogin')")
    && usersSource.includes('Shift+click to add to multi-column sorting')
    && usersSource.includes('Clear sorting'),
  'Users browser headers must use canonical multi-column sorting controls.',
);

assert(
  usersSource.includes('sky-canonical-operations-table-frame')
    && usersSource.includes('sky-canonical-operations-table align-middle mb-0')
    && usersSource.includes('sky-canonical-operations-pagination-row')
    && usersSource.includes('sky-canonical-operations-pagination-balance')
    && usersSource.includes('className="btn btn-sm sky-pagination-nav-button"'),
  'Users browser must use the canonical table frame and centered pagination.',
);

assert(
  usersSource.includes('const USER_FETCH_LIMIT = 200;')
    && usersSource.includes('async function fetchAllUsers')
    && usersSource.includes('offset += batch.length;'),
  'Users must fetch the filtered catalogue in API-safe 200-row batches before client sorting and pagination.',
);

assert(
  usersSource.indexOf('sky-admin-users-browser') < usersSource.indexOf('sky-admin-user-detail-card')
    && !usersSource.includes('col-xl-7')
    && !usersSource.includes('col-xl-5'),
  'User detail must be a full-width workspace below the browser rather than a right-side rail.',
);

assert(
  usersSource.includes('Identity &amp; account')
    && usersSource.includes('Access &amp; roles')
    && usersSource.includes('Security &amp; sessions')
    && usersSource.includes('sky-admin-user-identity-grid')
    && usersSource.includes('sky-admin-user-access-grid')
    && usersSource.includes('sky-admin-user-security-grid'),
  'User detail must be reorganized into identity, access, and security workspace sections.',
);

assert(
  cssSource.includes('.sky-admin-user-detail-stack')
    && cssSource.includes('.sky-admin-user-identity-grid')
    && cssSource.includes('.sky-admin-user-access-grid')
    && cssSource.includes('.sky-admin-user-security-grid')
    && cssSource.includes('.sky-admin-user-detail-card .sky-app-access-list'),
  'Admin Users layout styles must support the new full-width detail workspace.',
);

console.log('[SkyCommand] Admin Users surface self-test passed.');
