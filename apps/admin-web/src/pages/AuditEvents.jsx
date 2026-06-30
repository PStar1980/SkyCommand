import { useEffect, useState } from 'react';
import adminService from '../services/adminService';

function formatDate(value) {
  if (!value) {
    return '—';
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

function AuditEvents() {
  const [items, setItems] = useState([]);
  const [selectedItem, setSelectedItem] = useState(null);
  const [filters, setFilters] = useState({ success: '', limit: 25 });
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  async function loadAuditEvents(nextFilters = filters) {
    setLoading(true);
    setError('');

    try {
      const result = await adminService.listAuditEvents(nextFilters);
      setItems(result.items || []);
      setTotal(result.total || 0);
      setSelectedItem((currentSelected) => {
        if (!currentSelected) {
          return result.items?.[0] || null;
        }

        return (
          result.items?.find((item) => item.auditEventId === currentSelected.auditEventId) ||
          result.items?.[0] ||
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
    loadAuditEvents();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function updateFilter(name, value) {
    const nextFilters = {
      ...filters,
      [name]: value,
    };

    setFilters(nextFilters);
    loadAuditEvents(nextFilters);
  }

  return (
    <>
      <header className="sky-page-header">
        <div>
          <div className="sky-page-kicker">Access Control · User History</div>
          <h1 className="sky-page-title">User History</h1>
          <p className="sky-page-subtitle">
            Review login, authorization, and user-facing activity from the SkyServer audit trail.
          </p>
        </div>
        <button className="btn sky-btn-ghost" onClick={() => loadAuditEvents()} type="button">
          Refresh
        </button>
      </header>

      {error && <div className="alert alert-danger">{error}</div>}

      <section className="sky-card mb-3">
        <div className="sky-card-body">
          <div className="row g-3 align-items-end">
            <div className="col-md-4">
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

            <div className="col-md-4">
              <label className="form-label" htmlFor="limitFilter">
                Limit
              </label>
              <select
                className="form-select sky-form-control"
                id="limitFilter"
                onChange={(event) => updateFilter('limit', event.target.value)}
                value={filters.limit}
              >
                <option value="10">10</option>
                <option value="25">25</option>
                <option value="50">50</option>
              </select>
            </div>

            <div className="col-md-4 text-md-end sky-muted">
              Showing {items.length} of {total}
            </div>
          </div>
        </div>
      </section>

      <div className="row g-3">
        <div className="col-xl-7">
          <section className="sky-card sky-table-card">
            {loading ? (
              <div className="sky-empty-state">Loading user history...</div>
            ) : (
              <div className="table-responsive">
                <table className="table table-hover sky-table">
                  <thead>
                    <tr>
                      <th>Event</th>
                      <th>Action</th>
                      <th>Result</th>
                      <th>Created</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((item) => (
                      <tr
                        className={`sky-clickable-row ${
                          selectedItem?.auditEventId === item.auditEventId ? 'sky-selected-row' : ''
                        }`}
                        key={item.auditEventId}
                        onClick={() => setSelectedItem(item)}
                      >
                        <td>
                          <div className="fw-bold sky-detail-value">{item.eventType}</div>
                          <div className="small sky-muted">{item.resourceType || '—'}</div>
                        </td>
                        <td>{item.action}</td>
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
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>

        <div className="col-xl-5">
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
                    <dd className="col-sm-8 sky-detail-value">
                      {selectedItem.displayName || selectedItem.email || '—'}
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
