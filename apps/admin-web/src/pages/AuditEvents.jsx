import { useEffect, useState } from 'react';
import adminService from '../services/adminService';

const USER_HISTORY_PAGE_SIZE = 20;

function formatDate(value) {
  if (!value) {
    return '—';
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

function getUserLabel(item = {}) {
  return item.userLabel || item.displayName || item.username || item.email || 'System';
}

function formatCodes(values = [], maxItems = null) {
  if (!Array.isArray(values) || values.length === 0) {
    return '—';
  }

  if (!maxItems || values.length <= maxItems) {
    return values.join(', ');
  }

  return `${values.slice(0, maxItems).join(', ')} +${values.length - maxItems}`;
}

function AuditEvents() {
  const [items, setItems] = useState([]);
  const [selectedItem, setSelectedItem] = useState(null);
  const [filters, setFilters] = useState({
    success: '',
    user: '',
    role: '',
    privilege: '',
  });
  const [currentPage, setCurrentPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const pageCount = Math.max(1, Math.ceil(total / USER_HISTORY_PAGE_SIZE));
  const safeCurrentPage = Math.min(currentPage, pageCount);
  const rangeStart = total === 0 ? 0 : (safeCurrentPage - 1) * USER_HISTORY_PAGE_SIZE + 1;
  const rangeEnd = Math.min(safeCurrentPage * USER_HISTORY_PAGE_SIZE, total);

  async function loadAuditEvents(
    nextFilters = filters,
    nextPage = currentPage,
    { keepSelection = true } = {},
  ) {
    setLoading(true);
    setError('');

    const safePage = Math.max(1, Number(nextPage) || 1);

    try {
      const result = await adminService.listAuditEvents({
        ...nextFilters,
        limit: USER_HISTORY_PAGE_SIZE,
        offset: (safePage - 1) * USER_HISTORY_PAGE_SIZE,
      });
      const resultItems = result.items || [];
      const resultTotal = result.total || 0;
      const resultPageCount = Math.max(1, Math.ceil(resultTotal / USER_HISTORY_PAGE_SIZE));

      if (resultTotal > 0 && safePage > resultPageCount) {
        setCurrentPage(resultPageCount);
        await loadAuditEvents(nextFilters, resultPageCount, { keepSelection: false });
        return;
      }

      setItems(resultItems);
      setTotal(resultTotal);
      setCurrentPage(safePage);
      setSelectedItem((currentSelected) => {
        if (!keepSelection || !currentSelected) {
          return resultItems[0] || null;
        }

        return (
          resultItems.find((item) => item.auditEventId === currentSelected.auditEventId) ||
          resultItems[0] ||
          null
        );
      });
    } catch (loadError) {
      setError(loadError.message || 'Failed to load audit events.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadAuditEvents(filters, 1, { keepSelection: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function updateFilter(name, value) {
    const nextFilters = {
      ...filters,
      [name]: value,
    };

    setFilters(nextFilters);
    loadAuditEvents(nextFilters, 1, { keepSelection: false });
  }

  function goToPage(page) {
    const nextPage = Math.min(Math.max(1, Number(page) || 1), pageCount);
    loadAuditEvents(filters, nextPage, { keepSelection: false });
  }

  function renderPagination() {
    return (
      <div className="sky-pagination-row">
        <div className="small sky-muted">
          Showing {rangeStart}-{rangeEnd} of {total} user history event(s)
        </div>
        <div className="sky-pagination-controls" aria-label="User history pagination">
          <button
            className="btn btn-sm sky-btn-ghost"
            disabled={safeCurrentPage <= 1 || loading}
            onClick={() => goToPage(1)}
            type="button"
          >
            First
          </button>
          <button
            className="btn btn-sm sky-btn-ghost"
            disabled={safeCurrentPage <= 1 || loading}
            onClick={() => goToPage(safeCurrentPage - 1)}
            type="button"
          >
            Back
          </button>
          <label className="sky-pagination-select-label" htmlFor="userHistoryPageSelect">
            Page
          </label>
          <select
            className="form-select form-select-sm sky-form-control sky-pagination-select"
            disabled={loading}
            id="userHistoryPageSelect"
            onChange={(event) => goToPage(event.target.value)}
            value={safeCurrentPage}
          >
            {Array.from({ length: pageCount }, (_, index) => index + 1).map((page) => (
              <option key={page} value={page}>
                {page}
              </option>
            ))}
          </select>
          <span className="small sky-muted">of {pageCount}</span>
          <button
            className="btn btn-sm sky-btn-ghost"
            disabled={safeCurrentPage >= pageCount || loading}
            onClick={() => goToPage(safeCurrentPage + 1)}
            type="button"
          >
            Next
          </button>
          <button
            className="btn btn-sm sky-btn-ghost"
            disabled={safeCurrentPage >= pageCount || loading}
            onClick={() => goToPage(pageCount)}
            type="button"
          >
            Last
          </button>
        </div>
      </div>
    );
  }

  return (
    <>
      <header className="sky-page-header">
        <div>
          <div className="sky-page-kicker">Access Control · User History</div>
          <h1 className="sky-page-title">User History</h1>
          <p className="sky-page-subtitle">
            Review login, authorization, and user-facing activity from the SkyCommand audit trail.
          </p>
        </div>
        <button
          className="btn sky-btn-ghost"
          disabled={loading}
          onClick={() => loadAuditEvents(filters, safeCurrentPage)}
          type="button"
        >
          {loading ? 'Refreshing...' : 'Refresh'}
        </button>
      </header>

      {error && <div className="alert alert-danger">{error}</div>}

      <section className="sky-card mb-3">
        <div className="sky-card-body">
          <div className="row g-3 align-items-end">
            <div className="col-xl-3 col-md-6">
              <label className="form-label" htmlFor="successFilter">
                Result
              </label>
              <select
                className="form-select sky-form-control"
                id="successFilter"
                onChange={(event) => updateFilter('success', event.target.value)}
                value={filters.success}
              >
                <option value="">All</option>
                <option value="true">Success</option>
                <option value="false">Failed</option>
              </select>
            </div>

            <div className="col-xl-3 col-md-6">
              <label className="form-label" htmlFor="userFilter">
                User
              </label>
              <input
                className="form-control sky-form-control"
                id="userFilter"
                onChange={(event) => updateFilter('user', event.target.value)}
                placeholder="Name, username, or email"
                type="search"
                value={filters.user}
              />
            </div>

            <div className="col-xl-3 col-md-6">
              <label className="form-label" htmlFor="roleFilter">
                Role
              </label>
              <input
                className="form-control sky-form-control sky-mono"
                id="roleFilter"
                onChange={(event) => updateFilter('role', event.target.value)}
                placeholder="ADMIN"
                type="search"
                value={filters.role}
              />
            </div>

            <div className="col-xl-3 col-md-6">
              <label className="form-label" htmlFor="privilegeFilter">
                Privilege
              </label>
              <input
                className="form-control sky-form-control sky-mono"
                id="privilegeFilter"
                onChange={(event) => updateFilter('privilege', event.target.value)}
                placeholder="WORKFLOW_RUN"
                type="search"
                value={filters.privilege}
              />
            </div>
          </div>
        </div>
      </section>

      <div className="row g-3">
        <div className="col-xxl-9">
          <section className="sky-card sky-table-card">
            {loading ? (
              <div className="sky-empty-state">Loading user history...</div>
            ) : (
              <>
                <div className="table-responsive">
                  <table className="table table-hover sky-table">
                    <thead>
                      <tr>
                        <th>Event</th>
                        <th>Action</th>
                        <th>User</th>
                        <th>Role</th>
                        <th>Privilege</th>
                        <th>Result</th>
                        <th>Created</th>
                      </tr>
                    </thead>
                    <tbody>
                      {items.length > 0 ? (
                        items.map((item) => (
                          <tr
                            className={`sky-clickable-row ${
                              selectedItem?.auditEventId === item.auditEventId
                                ? 'sky-selected-row'
                                : ''
                            }`}
                            key={item.auditEventId}
                            onClick={() => setSelectedItem(item)}
                          >
                            <td>
                              <div className="fw-bold sky-detail-value">{item.eventType}</div>
                              <div className="small sky-muted">{item.resourceType || '—'}</div>
                            </td>
                            <td className="sky-mono small">{item.action}</td>
                            <td>
                              <div className="fw-semibold sky-detail-value">
                                {getUserLabel(item)}
                              </div>
                              {item.email && item.email !== getUserLabel(item) ? (
                                <div className="small sky-muted">{item.email}</div>
                              ) : null}
                            </td>
                            <td className="sky-mono small">{formatCodes(item.roleCodes)}</td>
                            <td className="sky-mono small">{formatCodes(item.privilegeCodes)}</td>
                            <td>
                              <span
                                className={`sky-pill ${
                                  item.success ? 'sky-pill-success' : 'sky-pill-danger'
                                }`}
                              >
                                {item.success ? 'SUCCESS' : 'FAILED'}
                              </span>
                            </td>
                            <td>{formatDate(item.createdAt)}</td>
                          </tr>
                        ))
                      ) : (
                        <tr>
                          <td className="sky-empty-state" colSpan={7}>
                            No user history events match the selected filters.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
                {renderPagination()}
              </>
            )}
          </section>
        </div>

        <div className="col-xxl-3">
          <section className="sky-card">
            <div className="sky-card-header">
              <h2 className="h5 mb-0">User history detail</h2>
            </div>
            <div className="sky-card-body">
              {selectedItem ? (
                <>
                  <dl className="row g-2">
                    <dt className="col-sm-4 sky-detail-label">Audit ID</dt>
                    <dd className="col-sm-8 sky-mono small sky-detail-value">
                      {selectedItem.auditEventId}
                    </dd>

                    <dt className="col-sm-4 sky-detail-label">User</dt>
                    <dd className="col-sm-8 sky-detail-value">{getUserLabel(selectedItem)}</dd>

                    <dt className="col-sm-4 sky-detail-label">Role</dt>
                    <dd className="col-sm-8 sky-mono small sky-detail-value">
                      {formatCodes(selectedItem.roleCodes)}
                    </dd>

                    <dt className="col-sm-4 sky-detail-label">Privilege</dt>
                    <dd className="col-sm-8 sky-mono small sky-detail-value">
                      {formatCodes(selectedItem.privilegeCodes)}
                    </dd>

                    <dt className="col-sm-4 sky-detail-label">Message</dt>
                    <dd className="col-sm-8 sky-detail-value">{selectedItem.message || '—'}</dd>

                    <dt className="col-sm-4 sky-detail-label">IP</dt>
                    <dd className="col-sm-8 sky-detail-value">{selectedItem.ipAddress || '—'}</dd>
                  </dl>

                  <pre className="sky-code-block">
                    {JSON.stringify(selectedItem.metadata || {}, null, 2)}
                  </pre>
                </>
              ) : (
                <div className="sky-empty-state">Select an audit event to inspect.</div>
              )}
            </div>
          </section>
        </div>
      </div>
    </>
  );
}

export default AuditEvents;
