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

function statusClass(status) {
  if (status === 'SUCCESS') {
    return 'sky-pill-success';
  }

  if (status === 'FAILED') {
    return 'sky-pill-danger';
  }

  if (status === 'STARTED') {
    return 'sky-pill-warning';
  }

  return 'sky-pill-info';
}

function ScriptExecutions() {
  const [items, setItems] = useState([]);
  const [selectedItem, setSelectedItem] = useState(null);
  const [filters, setFilters] = useState({ status: '', limit: 25 });
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  async function loadExecutions(nextFilters = filters) {
    setLoading(true);
    setError('');

    try {
      const result = await adminService.listScriptExecutions(nextFilters);
      setItems(result.items || []);
      setTotal(result.total || 0);
      setSelectedItem(result.items?.[0] || null);
    } catch (loadError) {
      setError(loadError.message || 'Failed to load script executions.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadExecutions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function updateFilter(name, value) {
    const nextFilters = {
      ...filters,
      [name]: value,
    };

    setFilters(nextFilters);
    loadExecutions(nextFilters);
  }

  return (
    <>
      <header className="sky-page-header">
        <div>
          <div className="sky-page-kicker">Execution history</div>
          <h1 className="sky-page-title">Script Executions</h1>
          <p className="sky-page-subtitle">
            Read-only trace of tools launched through the API, CLI-adjacent workflows, and future
            workers.
          </p>
        </div>
        <button className="btn sky-btn-ghost" onClick={() => loadExecutions()} type="button">
          Refresh
        </button>
      </header>

      {error && <div className="alert alert-danger">{error}</div>}

      <section className="sky-card mb-3">
        <div className="sky-card-body">
          <div className="row g-3 align-items-end">
            <div className="col-md-4">
              <label className="form-label" htmlFor="statusFilter">
                Status
              </label>
              <select
                className="form-select sky-form-control"
                id="statusFilter"
                onChange={(event) => updateFilter('status', event.target.value)}
                value={filters.status}
              >
                <option value="">All</option>
                <option value="SUCCESS">SUCCESS</option>
                <option value="FAILED">FAILED</option>
                <option value="STARTED">STARTED</option>
                <option value="CANCELLED">CANCELLED</option>
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
          <section className="sky-card">
            {loading ? (
              <div className="sky-empty-state">Loading executions...</div>
            ) : (
              <div className="table-responsive">
                <table className="table sky-table">
                  <thead>
                    <tr>
                      <th>Tool</th>
                      <th>Status</th>
                      <th>Duration</th>
                      <th>Started</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((item) => (
                      <tr
                        className="sky-clickable-row"
                        key={item.executionId}
                        onClick={() => setSelectedItem(item)}
                      >
                        <td>
                          <div className="fw-bold">{item.scriptName}</div>
                          <div className="small sky-muted">{item.category}</div>
                        </td>
                        <td>
                          <span className={`sky-pill ${statusClass(item.status)}`}>
                            {item.status}
                          </span>
                        </td>
                        <td>{item.durationMs ?? '—'} ms</td>
                        <td>{formatDate(item.startedAt)}</td>
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
              <h2 className="h5 mb-0">Execution detail</h2>
            </div>
            <div className="sky-card-body">
              {selectedItem ? (
                <>
                  <dl className="row">
                    <dt className="col-sm-4 sky-muted">Execution</dt>
                    <dd className="col-sm-8 sky-mono small">{selectedItem.executionId}</dd>

                    <dt className="col-sm-4 sky-muted">User</dt>
                    <dd className="col-sm-8">
                      {selectedItem.displayName || selectedItem.email || '—'}
                    </dd>

                    <dt className="col-sm-4 sky-muted">Summary</dt>
                    <dd className="col-sm-8">{selectedItem.summary || '—'}</dd>

                    <dt className="col-sm-4 sky-muted">Logs</dt>
                    <dd className="col-sm-8">
                      <span className="sky-pill">
                        stdout: {selectedItem.hasStdoutLog ? 'yes' : 'no'}
                      </span>{' '}
                      <span className="sky-pill">
                        stderr: {selectedItem.hasStderrLog ? 'yes' : 'no'}
                      </span>
                    </dd>
                  </dl>

                  <pre className="sky-code-block">
                    {JSON.stringify(selectedItem.metadata || {}, null, 2)}
                  </pre>
                </>
              ) : (
                <div className="sky-empty-state">Select an execution to inspect.</div>
              )}
            </div>
          </section>
        </div>
      </div>
    </>
  );
}

export default ScriptExecutions;
