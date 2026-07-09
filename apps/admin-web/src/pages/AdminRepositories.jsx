import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../context/AuthContext.jsx';
import adminService from '../services/adminService';

const DEFAULT_FILTERS = {
  q: '',
  active: '',
  limit: 50,
};

const DEFAULT_REPOSITORY_FORM = {
  repoCode: '',
  repoName: '',
  description: '',
  remoteUrl: '',
  mainBranch: 'main',
  devBranch: 'dev',
  displayOrder: 999,
  active: true,
  paths: [],
};

function formatDate(value) {
  if (!value) {
    return '—';
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

function statusClass(active) {
  return active ? 'sky-pill-success' : 'sky-pill-danger';
}

function statusLabel(active) {
  return active ? 'ACTIVE' : 'DISABLED';
}

function normalizeNumberInput(value, fallback = 999) {
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? fallback : parsed;
}

function buildPathForm(profiles = [], paths = []) {
  const pathsByProfileId = new Map(paths.map((path) => [path.profileId, path]));

  return profiles.map((profile) => {
    const existingPath = pathsByProfileId.get(profile.profileId);

    return {
      profileId: profile.profileId,
      profileCode: profile.profileCode,
      profileName: profile.profileName,
      rootPath: existingPath?.rootPath || '',
      active: existingPath?.active ?? true,
    };
  });
}

function sanitizeRepositoryPayload(form) {
  return {
    repoCode: form.repoCode.trim(),
    repoName: form.repoName.trim(),
    description: form.description.trim() || null,
    remoteUrl: form.remoteUrl.trim() || null,
    mainBranch: form.mainBranch.trim() || 'main',
    devBranch: form.devBranch.trim() || 'dev',
    displayOrder: normalizeNumberInput(form.displayOrder),
    active: Boolean(form.active),
    paths: form.paths
      .filter((path) => path.rootPath.trim() || path.active === false)
      .map((path) => ({
        profileId: path.profileId,
        rootPath: path.rootPath.trim(),
        active: Boolean(path.active),
      })),
  };
}

function AdminRepositories() {
  const { hasPermission } = useAuth();
  const canWrite = hasPermission('ADMIN_REPOSITORY_WRITE');

  const [repositories, setRepositories] = useState([]);
  const [profiles, setProfiles] = useState([]);
  const [selectedRepoId, setSelectedRepoId] = useState('');
  const [selectedRepository, setSelectedRepository] = useState(null);
  const [selectedPaths, setSelectedPaths] = useState([]);
  const [filters, setFilters] = useState(DEFAULT_FILTERS);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState(DEFAULT_REPOSITORY_FORM);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const selectedPathCount = useMemo(
    () => selectedPaths.filter((path) => path.rootPath && path.active !== false).length,
    [selectedPaths],
  );

  function resetForm(nextProfiles = profiles) {
    setForm({
      ...DEFAULT_REPOSITORY_FORM,
      paths: buildPathForm(nextProfiles, []),
    });
  }

  function populateForm(repository, paths, nextProfiles = profiles) {
    setForm({
      repoCode: repository?.repoCode || '',
      repoName: repository?.repoName || '',
      description: repository?.description || '',
      remoteUrl: repository?.remoteUrl || '',
      mainBranch: repository?.mainBranch || 'main',
      devBranch: repository?.devBranch || 'dev',
      displayOrder: repository?.displayOrder ?? 999,
      active: repository?.active ?? true,
      paths: buildPathForm(nextProfiles, paths || []),
    });
  }

  async function loadRepositories(nextFilters = filters, preferredRepoId = selectedRepoId) {
    setLoading(true);
    setError('');

    try {
      const result = await adminService.listRepositories(nextFilters);
      const nextRepositories = result.items || [];

      setRepositories(nextRepositories);
      setTotal(result.total || 0);

      if (nextRepositories.length === 0) {
        setSelectedRepoId('');
        setSelectedRepository(null);
        setSelectedPaths([]);
        resetForm();
        return;
      }

      const stillVisible = nextRepositories.some((repo) => repo.repoId === preferredRepoId);
      setSelectedRepoId(stillVisible ? preferredRepoId : nextRepositories[0].repoId);
    } catch (loadError) {
      setError(loadError.message || 'Failed to load repositories.');
    } finally {
      setLoading(false);
    }
  }

  async function loadSelectedRepository(repoId) {
    if (!repoId) {
      setSelectedRepository(null);
      setSelectedPaths([]);
      return;
    }

    setDetailLoading(true);
    setError('');

    try {
      const result = await adminService.getRepository(repoId);
      const repository = result.repository || null;
      const paths = result.paths || [];

      setSelectedRepository(repository);
      setSelectedPaths(paths);

      if (!createOpen) {
        populateForm(repository, paths);
      }
    } catch (loadError) {
      setError(loadError.message || 'Failed to load repository detail.');
    } finally {
      setDetailLoading(false);
    }
  }

  useEffect(() => {
    let active = true;

    async function loadInitialData() {
      setLoading(true);
      setError('');

      try {
        const [profilesResult, repositoriesResult] = await Promise.all([
          adminService.listConfigProfiles(),
          adminService.listRepositories(filters),
        ]);

        if (!active) {
          return;
        }

        const nextProfiles = profilesResult.items || [];
        const nextRepositories = repositoriesResult.items || [];

        setProfiles(nextProfiles);
        setRepositories(nextRepositories);
        setTotal(repositoriesResult.total || 0);
        setSelectedRepoId(nextRepositories[0]?.repoId || '');
        setForm({
          ...DEFAULT_REPOSITORY_FORM,
          paths: buildPathForm(nextProfiles, []),
        });
      } catch (loadError) {
        if (active) {
          setError(loadError.message || 'Failed to load repository configuration.');
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    loadInitialData();

    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    loadSelectedRepository(selectedRepoId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedRepoId]);

  function updatePathForm(profileId, updates) {
    setForm((current) => ({
      ...current,
      paths: current.paths.map((path) =>
        path.profileId === profileId
          ? {
              ...path,
              ...updates,
            }
          : path,
      ),
    }));
  }

  function startCreate() {
    setCreateOpen(true);
    setSelectedRepoId('');
    setSelectedRepository(null);
    setSelectedPaths([]);
    resetForm();
    setError('');
    setSuccess('');
  }

  function startEdit(repository = selectedRepository, paths = selectedPaths) {
    setCreateOpen(false);
    populateForm(repository, paths);
    setError('');
    setSuccess('');
  }

  async function handleSubmit(event) {
    event.preventDefault();

    if (!canWrite) {
      return;
    }

    setSaving(true);
    setError('');
    setSuccess('');

    try {
      const payload = sanitizeRepositoryPayload(form);
      let result;

      if (createOpen || !selectedRepository?.repoId) {
        result = await adminService.createRepository(payload);
        setSuccess(`Created repository ${result.repository?.repoCode || payload.repoCode}.`);
      } else {
        result = await adminService.updateRepository(selectedRepository.repoId, payload);
        setSuccess(`Updated repository ${result.repository?.repoCode || payload.repoCode}.`);
      }

      setCreateOpen(false);
      await loadRepositories(filters, result.repository?.repoId);
      setSelectedRepoId(result.repository?.repoId || '');
    } catch (saveError) {
      setError(saveError.message || 'Failed to save repository.');
    } finally {
      setSaving(false);
    }
  }

  async function handleToggleStatus(repository) {
    if (!repository || !canWrite) {
      return;
    }

    setSaving(true);
    setError('');
    setSuccess('');

    try {
      const result = await adminService.updateRepositoryStatus(repository.repoId, {
        active: !repository.active,
      });

      setSuccess(
        `${result.repository?.repoCode || repository.repoCode} ${result.repository?.active ? 'enabled' : 'disabled'}.`,
      );
      await loadRepositories(filters, repository.repoId);
    } catch (saveError) {
      setError(saveError.message || 'Failed to update repository status.');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(repository) {
    if (!repository || !canWrite) {
      return;
    }

    const confirmed = window.confirm(
      `Disable repository ${repository.repoCode}? This preserves configuration history but removes it from active option lists.`,
    );

    if (!confirmed) {
      return;
    }

    setSaving(true);
    setError('');
    setSuccess('');

    try {
      await adminService.deleteRepository(repository.repoId, {
        reason: 'Deleted from SkyCommand Admin repository configuration page.',
      });
      setSuccess(`Disabled repository ${repository.repoCode}.`);
      await loadRepositories(filters, '');
    } catch (saveError) {
      setError(saveError.message || 'Failed to delete repository.');
    } finally {
      setSaving(false);
    }
  }

  function applyFilters(event) {
    event.preventDefault();
    loadRepositories(filters, selectedRepoId);
  }

  function clearFilters() {
    const nextFilters = DEFAULT_FILTERS;
    setFilters(nextFilters);
    loadRepositories(nextFilters, selectedRepoId);
  }

  return (
    <>
      <header className="sky-page-header">
        <div>
          <div className="sky-page-kicker">Configuration</div>
          <h1 className="sky-page-title">Repositories</h1>
          <p className="sky-page-subtitle">
            Manage repository identity, branch conventions, and profile-specific local paths used by
            Git tools, repo maps, repo zips, and future configuration surfaces.
          </p>
        </div>

        <button
          className="btn sky-btn-ghost"
          disabled={loading}
          onClick={() => loadRepositories()}
          type="button"
        >
          {loading ? 'Refreshing...' : 'Refresh repositories'}
        </button>
      </header>

      {error && <div className="alert alert-danger">{error}</div>}
      {success && <div className="alert alert-success">{success}</div>}

      <div className="row g-3">
        <div className="col-xl-4">
          <section className="sky-card sky-sticky-detail-card">
            <div className="sky-card-header d-flex align-items-center justify-content-between gap-2">
              <div>
                <h2 className="h5 mb-0">{createOpen ? 'Create repository' : 'Repository form'}</h2>
                <div className="small sky-muted">Metadata and profile path configuration.</div>
              </div>
              {canWrite && (
                <button className="btn btn-sm sky-btn-ghost" onClick={startCreate} type="button">
                  New
                </button>
              )}
            </div>

            <form className="sky-card-body" onSubmit={handleSubmit}>
              <div className="row g-3">
                <div className="col-md-6">
                  <label className="form-label sky-form-label" htmlFor="repoCode">
                    Repository Code <span className="text-danger">*</span>
                  </label>
                  <input
                    className="form-control sky-form-control"
                    disabled={!canWrite || saving}
                    id="repoCode"
                    onChange={(event) =>
                      setForm((current) => ({ ...current, repoCode: event.target.value }))
                    }
                    required
                    value={form.repoCode}
                  />
                </div>
                <div className="col-md-6">
                  <label className="form-label sky-form-label" htmlFor="repoName">
                    Repository Name <span className="text-danger">*</span>
                  </label>
                  <input
                    className="form-control sky-form-control"
                    disabled={!canWrite || saving}
                    id="repoName"
                    onChange={(event) =>
                      setForm((current) => ({ ...current, repoName: event.target.value }))
                    }
                    required
                    value={form.repoName}
                  />
                </div>
              </div>

              <div className="mt-3">
                <label className="form-label sky-form-label" htmlFor="repoDescription">
                  Description
                </label>
                <textarea
                  className="form-control sky-form-control"
                  disabled={!canWrite || saving}
                  id="repoDescription"
                  onChange={(event) =>
                    setForm((current) => ({ ...current, description: event.target.value }))
                  }
                  rows="3"
                  value={form.description}
                />
              </div>

              <div className="mt-3">
                <label className="form-label sky-form-label" htmlFor="remoteUrl">
                  Remote URL
                </label>
                <input
                  className="form-control sky-form-control"
                  disabled={!canWrite || saving}
                  id="remoteUrl"
                  onChange={(event) =>
                    setForm((current) => ({ ...current, remoteUrl: event.target.value }))
                  }
                  value={form.remoteUrl}
                />
              </div>

              <div className="row g-3 mt-0">
                <div className="col-md-4">
                  <label className="form-label sky-form-label" htmlFor="mainBranch">
                    Main Branch
                  </label>
                  <input
                    className="form-control sky-form-control"
                    disabled={!canWrite || saving}
                    id="mainBranch"
                    onChange={(event) =>
                      setForm((current) => ({ ...current, mainBranch: event.target.value }))
                    }
                    value={form.mainBranch}
                  />
                </div>
                <div className="col-md-4">
                  <label className="form-label sky-form-label" htmlFor="devBranch">
                    Dev Branch
                  </label>
                  <input
                    className="form-control sky-form-control"
                    disabled={!canWrite || saving}
                    id="devBranch"
                    onChange={(event) =>
                      setForm((current) => ({ ...current, devBranch: event.target.value }))
                    }
                    value={form.devBranch}
                  />
                </div>
                <div className="col-md-4">
                  <label className="form-label sky-form-label" htmlFor="displayOrder">
                    Display Order
                  </label>
                  <input
                    className="form-control sky-form-control"
                    disabled={!canWrite || saving}
                    id="displayOrder"
                    onChange={(event) =>
                      setForm((current) => ({ ...current, displayOrder: event.target.value }))
                    }
                    type="number"
                    value={form.displayOrder}
                  />
                </div>
              </div>

              <div className="form-check form-switch mt-3">
                <input
                  checked={form.active}
                  className="form-check-input"
                  disabled={!canWrite || saving}
                  id="repoActive"
                  onChange={(event) =>
                    setForm((current) => ({ ...current, active: event.target.checked }))
                  }
                  type="checkbox"
                />
                <label className="form-check-label sky-muted" htmlFor="repoActive">
                  Active repository
                </label>
              </div>

              <hr />

              <div className="sky-page-kicker mb-2">Profile Paths</div>
              <div className="sky-repository-path-list">
                {form.paths.map((path) => (
                  <div className="sky-repository-path-row" key={path.profileId}>
                    <div className="d-flex align-items-center justify-content-between gap-2 mb-2">
                      <div>
                        <div className="fw-bold sky-detail-value">{path.profileCode}</div>
                        <div className="small sky-muted">{path.profileName}</div>
                      </div>
                      <div className="form-check form-switch m-0">
                        <input
                          checked={path.active}
                          className="form-check-input"
                          disabled={!canWrite || saving}
                          onChange={(event) =>
                            updatePathForm(path.profileId, { active: event.target.checked })
                          }
                          type="checkbox"
                        />
                      </div>
                    </div>
                    <input
                      className="form-control sky-form-control sky-mono"
                      disabled={!canWrite || saving || !path.active}
                      onChange={(event) =>
                        updatePathForm(path.profileId, { rootPath: event.target.value })
                      }
                      placeholder="C:\\Path\\To\\Repository"
                      value={path.rootPath}
                    />
                  </div>
                ))}
              </div>

              {canWrite && (
                <div className="d-flex gap-2 mt-4">
                  <button className="btn sky-btn-primary" disabled={saving} type="submit">
                    {saving ? 'Saving...' : createOpen ? 'Create repository' : 'Save repository'}
                  </button>
                  <button
                    className="btn sky-btn-ghost"
                    disabled={saving}
                    onClick={() => (createOpen ? resetForm() : startEdit())}
                    type="button"
                  >
                    Reset
                  </button>
                </div>
              )}
            </form>
          </section>
        </div>

        <div className="col-xl-8">
          <section className="sky-card sky-table-card mb-3">
            <div className="sky-card-header d-flex flex-wrap align-items-center justify-content-between gap-2">
              <div>
                <h2 className="h5 mb-0">Repositories</h2>
                <div className="small sky-muted">
                  Showing {repositories.length} of {total} repository configuration record(s).
                </div>
              </div>

              <form className="sky-inline-filter-form" onSubmit={applyFilters}>
                <select
                  className="form-select sky-form-control"
                  onChange={(event) =>
                    setFilters((current) => ({ ...current, active: event.target.value }))
                  }
                  value={filters.active}
                >
                  <option value="">All states</option>
                  <option value="true">Active</option>
                  <option value="false">Disabled</option>
                </select>
                <input
                  className="form-control sky-form-control"
                  onChange={(event) =>
                    setFilters((current) => ({ ...current, q: event.target.value }))
                  }
                  placeholder="Search repositories"
                  value={filters.q}
                />
                <button className="btn btn-sm sky-btn-primary" type="submit">
                  Apply
                </button>
                <button className="btn btn-sm sky-btn-ghost" onClick={clearFilters} type="button">
                  Clear
                </button>
              </form>
            </div>

            <div className="table-responsive">
              <table className="table sky-table">
                <thead>
                  <tr>
                    <th>Repository</th>
                    <th>Branches</th>
                    <th>Remote</th>
                    <th>Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {repositories.map((repository) => (
                    <tr
                      className={repository.repoId === selectedRepoId ? 'sky-selected-row' : ''}
                      key={repository.repoId}
                      onClick={() => {
                        setCreateOpen(false);
                        setSelectedRepoId(repository.repoId);
                      }}
                    >
                      <td>
                        <div className="fw-bold sky-detail-value">{repository.repoName}</div>
                        <div className="small sky-muted sky-mono">{repository.repoCode}</div>
                      </td>
                      <td>
                        <div className="small sky-muted">main: {repository.mainBranch}</div>
                        <div className="small sky-muted">dev: {repository.devBranch}</div>
                      </td>
                      <td>
                        <div className="sky-truncate">{repository.remoteUrl || '—'}</div>
                      </td>
                      <td>
                        <span className={`sky-pill ${statusClass(repository.active)}`}>
                          {statusLabel(repository.active)}
                        </span>
                      </td>
                      <td>
                        <div className="d-flex flex-wrap gap-1">
                          <button
                            className="btn btn-sm sky-btn-ghost"
                            onClick={(event) => {
                              event.stopPropagation();
                              setCreateOpen(false);
                              setSelectedRepoId(repository.repoId);
                              startEdit(
                                repository,
                                selectedRepoId === repository.repoId ? selectedPaths : [],
                              );
                            }}
                            type="button"
                          >
                            Edit
                          </button>
                          {canWrite && (
                            <>
                              <button
                                className="btn btn-sm sky-btn-ghost"
                                disabled={saving}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  handleToggleStatus(repository);
                                }}
                                type="button"
                              >
                                {repository.active ? 'Disable' : 'Enable'}
                              </button>
                              <button
                                className="btn btn-sm btn-outline-danger"
                                disabled={saving || !repository.active}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  handleDelete(repository);
                                }}
                                type="button"
                              >
                                Delete
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}

                  {!loading && repositories.length === 0 && (
                    <tr>
                      <td className="text-center sky-muted py-5" colSpan="5">
                        No repositories found.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>

          <section className="sky-card">
            <div className="sky-card-header d-flex align-items-center justify-content-between gap-2">
              <div>
                <h2 className="h5 mb-0">Repository detail</h2>
                <div className="small sky-muted">
                  Selected repository and profile path metadata.
                </div>
              </div>
              {selectedRepository && (
                <span className={`sky-pill ${statusClass(selectedRepository.active)}`}>
                  {statusLabel(selectedRepository.active)}
                </span>
              )}
            </div>

            {detailLoading ? (
              <div className="sky-empty-state">Loading repository detail...</div>
            ) : selectedRepository ? (
              <div className="sky-card-body">
                <div className="row g-3">
                  <div className="col-md-6">
                    <dl className="row g-2 mb-0">
                      <dt className="col-5 sky-detail-label">Repository</dt>
                      <dd className="col-7 sky-detail-value">{selectedRepository.repoName}</dd>
                      <dt className="col-5 sky-detail-label">Code</dt>
                      <dd className="col-7 sky-detail-value sky-mono">
                        {selectedRepository.repoCode}
                      </dd>
                      <dt className="col-5 sky-detail-label">Main branch</dt>
                      <dd className="col-7 sky-detail-value">{selectedRepository.mainBranch}</dd>
                      <dt className="col-5 sky-detail-label">Dev branch</dt>
                      <dd className="col-7 sky-detail-value">{selectedRepository.devBranch}</dd>
                    </dl>
                  </div>
                  <div className="col-md-6">
                    <dl className="row g-2 mb-0">
                      <dt className="col-5 sky-detail-label">Paths</dt>
                      <dd className="col-7 sky-detail-value">{selectedPathCount}</dd>
                      <dt className="col-5 sky-detail-label">Display order</dt>
                      <dd className="col-7 sky-detail-value">{selectedRepository.displayOrder}</dd>
                      <dt className="col-5 sky-detail-label">Updated</dt>
                      <dd className="col-7 sky-detail-value">
                        {formatDate(selectedRepository.updatedAt)}
                      </dd>
                      <dt className="col-5 sky-detail-label">Created</dt>
                      <dd className="col-7 sky-detail-value">
                        {formatDate(selectedRepository.createdAt)}
                      </dd>
                    </dl>
                  </div>
                </div>

                <hr />

                <div className="sky-page-kicker mb-2">Configured paths</div>
                <div className="table-responsive">
                  <table className="table sky-table">
                    <thead>
                      <tr>
                        <th>Profile</th>
                        <th>Root Path</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selectedPaths.map((path) => (
                        <tr key={path.profileId}>
                          <td>
                            <div className="fw-bold sky-detail-value">{path.profileCode}</div>
                            <div className="small sky-muted">{path.profileName}</div>
                          </td>
                          <td className="sky-mono">{path.rootPath || '—'}</td>
                          <td>
                            <span
                              className={`sky-pill ${statusClass(path.active && path.rootPath)}`}
                            >
                              {path.active && path.rootPath ? 'ACTIVE' : 'NOT SET'}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : (
              <div className="sky-empty-state">Select a repository to inspect.</div>
            )}
          </section>
        </div>
      </div>
    </>
  );
}

export default AdminRepositories;
