import { useEffect, useMemo, useRef, useState } from 'react';
import RepositoryForm from '../components/RepositoryForm.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import adminService from '../services/adminService';
import DismissibleAlert from '../components/ui/DismissibleAlert.jsx';
import { getNextSortState, sortItemsBySorts } from '../utils/tableSorting.js';
import {
  createRepositoryForm,
  DEFAULT_REPOSITORY_FILTERS,
  formatRepositoryDate,
  populateRepositoryForm,
  REPOSITORY_PAGE_SIZE,
  repositoryStatusClass,
  repositoryStatusLabel,
  sanitizeRepositoryPayload,
} from './repositoryAdminUtils.js';

const REPOSITORY_FETCH_LIMIT = 200;
const MANAGE_REPOSITORY_DEFAULT_SORTS = [{ field: 'repository', direction: 'asc' }];

function getRepositorySortValue(repository, field) {
  if (field === 'repository') {
    return `${repository?.repoName || ''} ${repository?.repoCode || ''}`.trim();
  }

  if (field === 'branches') {
    return `${repository?.mainBranch || ''} ${repository?.devBranch || ''}`.trim();
  }

  if (field === 'remote') {
    return repository?.remoteUrl || null;
  }

  if (field === 'role') {
    return repository?.isSkycommandRepository ? 'SkyCommand' : 'Standard';
  }

  if (field === 'status') {
    return repositoryStatusLabel(repository?.active);
  }

  if (field === 'updated') {
    const timestamp = repository?.updatedAt ? new Date(repository.updatedAt).getTime() : Number.NaN;
    return Number.isFinite(timestamp) ? timestamp : null;
  }

  return repository?.[field] ?? '';
}

function ManageRepositories() {
  const { hasPermission } = useAuth();
  const canWrite = hasPermission('ADMIN_REPOSITORY_WRITE');

  const [repositories, setRepositories] = useState([]);
  const [profiles, setProfiles] = useState([]);
  const [selectedRepoId, setSelectedRepoId] = useState('');
  const [selectedRepository, setSelectedRepository] = useState(null);
  const [selectedPaths, setSelectedPaths] = useState([]);
  const [form, setForm] = useState(createRepositoryForm());
  const [filters, setFilters] = useState(DEFAULT_REPOSITORY_FILTERS);
  const [currentPage, setCurrentPage] = useState(1);
  const [sorts, setSorts] = useState(() => MANAGE_REPOSITORY_DEFAULT_SORTS);
  const [sortingCustomized, setSortingCustomized] = useState(false);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [readiness, setReadiness] = useState(null);
  const [readinessLoading, setReadinessLoading] = useState(true);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const filterAutoApplyReadyRef = useRef(false);

  const sortedRepositories = useMemo(
    () => sortItemsBySorts(repositories, sorts, getRepositorySortValue),
    [repositories, sorts],
  );
  const pageCount = Math.max(1, Math.ceil(sortedRepositories.length / REPOSITORY_PAGE_SIZE));
  const safeCurrentPage = Math.min(currentPage, pageCount);
  const pageStart = (safeCurrentPage - 1) * REPOSITORY_PAGE_SIZE;
  const visibleRepositories = useMemo(
    () => sortedRepositories.slice(pageStart, pageStart + REPOSITORY_PAGE_SIZE),
    [pageStart, sortedRepositories],
  );
  const rangeStart = sortedRepositories.length === 0 ? 0 : pageStart + 1;
  const rangeEnd = Math.min(pageStart + REPOSITORY_PAGE_SIZE, sortedRepositories.length);

  const selectedPathCount = useMemo(
    () => selectedPaths.filter((path) => path.rootPath && path.active !== false).length,
    [selectedPaths],
  );

  async function loadReadiness() {
    setReadinessLoading(true);

    try {
      const result = await adminService.getSkycommandRepositoryReadiness();
      setReadiness(result.readiness || null);
      return result.readiness || null;
    } catch (loadError) {
      setReadiness({
        ready: false,
        status: 'BLOCKED',
        errorCode: loadError.details?.code || 'SKYCOMMAND_REPOSITORY_READINESS_FAILED',
        message: loadError.message || 'Failed to inspect SkyCommand repository readiness.',
      });
      return null;
    } finally {
      setReadinessLoading(false);
    }
  }

  async function fetchRepositoryCatalogue(nextFilters = filters) {
    const items = [];
    let offset = 0;
    let expectedTotal = 0;

    do {
      const result = await adminService.listRepositories({
        ...nextFilters,
        limit: REPOSITORY_FETCH_LIMIT,
        offset,
      });
      const batch = result.items || [];
      expectedTotal = Number(result.total || 0);
      items.push(...batch);
      offset += batch.length;

      if (batch.length === 0) {
        break;
      }
    } while (items.length < expectedTotal);

    return items;
  }

  async function loadRepositories(
    nextFilters = filters,
    preferredRepoId = selectedRepoId,
    nextPage = currentPage,
  ) {
    const requestedPage = Math.max(1, Number(nextPage) || 1);
    setLoading(true);
    setError('');

    try {
      const nextRepositories = await fetchRepositoryCatalogue(nextFilters);
      const sortedNextRepositories = sortItemsBySorts(
        nextRepositories,
        sorts,
        getRepositorySortValue,
      );
      const nextPageCount = Math.max(
        1,
        Math.ceil(sortedNextRepositories.length / REPOSITORY_PAGE_SIZE),
      );

      setRepositories(nextRepositories);

      if (nextRepositories.length === 0) {
        setCurrentPage(1);
        setSelectedRepoId('');
        setSelectedRepository(null);
        setSelectedPaths([]);
        setForm(createRepositoryForm(profiles));
        return;
      }

      const preferredRepositoryExists = nextRepositories.some(
        (repository) => repository.repoId === preferredRepoId,
      );
      const resolvedRepository = preferredRepositoryExists
        ? sortedNextRepositories.find((repository) => repository.repoId === preferredRepoId)
        : sortedNextRepositories[(Math.min(requestedPage, nextPageCount) - 1) * REPOSITORY_PAGE_SIZE] ||
          sortedNextRepositories[0];
      const selectedIndex = resolvedRepository
        ? sortedNextRepositories.findIndex(
            (repository) => repository.repoId === resolvedRepository.repoId,
          )
        : -1;
      const resolvedPage = selectedIndex >= 0
        ? Math.floor(selectedIndex / REPOSITORY_PAGE_SIZE) + 1
        : Math.min(requestedPage, nextPageCount);

      setCurrentPage(resolvedPage);
      setSelectedRepoId(resolvedRepository?.repoId || '');
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
      setForm(createRepositoryForm(profiles));
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
      setForm(populateRepositoryForm(repository, paths, profiles));
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
      setReadinessLoading(true);
      setError('');

      try {
        const [profilesResult, repositoryItems, readinessResult] = await Promise.all([
          adminService.listConfigProfiles(),
          fetchRepositoryCatalogue(DEFAULT_REPOSITORY_FILTERS),
          adminService.getSkycommandRepositoryReadiness(),
        ]);

        if (!active) {
          return;
        }

        const nextProfiles = profilesResult.items || [];
        const nextRepositories = repositoryItems || [];
        const sortedNextRepositories = sortItemsBySorts(
          nextRepositories,
          MANAGE_REPOSITORY_DEFAULT_SORTS,
          getRepositorySortValue,
        );

        setProfiles(nextProfiles);
        setRepositories(nextRepositories);
        setCurrentPage(1);
        setReadiness(readinessResult.readiness || null);
        setSelectedRepoId(sortedNextRepositories[0]?.repoId || '');
        setForm(createRepositoryForm(nextProfiles));
      } catch (loadError) {
        if (active) {
          setError(loadError.message || 'Failed to load repository configuration.');
        }
      } finally {
        if (active) {
          setLoading(false);
          setReadinessLoading(false);
        }
      }
    }

    loadInitialData();

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    loadSelectedRepository(selectedRepoId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedRepoId, profiles]);

  useEffect(() => {
    if (!filterAutoApplyReadyRef.current) {
      filterAutoApplyReadyRef.current = true;
      return undefined;
    }

    const timeoutId = window.setTimeout(() => {
      loadRepositories(filters, '', 1);
    }, 250);

    return () => window.clearTimeout(timeoutId);
    // loadRepositories intentionally uses the filter snapshot from this render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters]);

  useEffect(() => {
    if (!detailsOpen) {
      return undefined;
    }

    function handleKeyDown(event) {
      if (event.key === 'Escape') {
        setDetailsOpen(false);
      }
    }

    const priorOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      document.body.style.overflow = priorOverflow;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [detailsOpen]);

  function updateForm(key, value) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function openRepositoryDetails(repository) {
    setSelectedRepoId(repository.repoId);
    setSuccess('');
    setError('');
    setDetailsOpen(true);
  }

  function updatePathForm(profileId, key, value) {
    setForm((current) => ({
      ...current,
      paths: current.paths.map((path) =>
        path.profileId === profileId ? { ...path, [key]: value } : path,
      ),
    }));
  }

  function resetSelectedForm() {
    setForm(populateRepositoryForm(selectedRepository, selectedPaths, profiles));
    setError('');
    setSuccess('');
  }

  async function handleSave(event) {
    event.preventDefault();

    if (!selectedRepository || !canWrite) {
      return;
    }

    setSaving(true);
    setError('');
    setSuccess('');

    try {
      const payload = sanitizeRepositoryPayload(form);
      const result = await adminService.updateRepository(selectedRepository.repoId, payload);
      const savedRepository = result.repository || selectedRepository;

      setSuccess(`Updated repository ${savedRepository.repoCode || payload.repoCode}.`);
      await loadSelectedRepository(selectedRepository.repoId);
      await Promise.all([
        loadRepositories(filters, selectedRepository.repoId, currentPage),
        loadReadiness(),
      ]);
    } catch (saveError) {
      setError(saveError.message || 'Failed to save repository.');
    } finally {
      setSaving(false);
    }
  }

  async function handleSkycommandDesignation(repository, designated) {
    if (!repository || !canWrite) {
      return;
    }

    const currentRepository = readiness?.repository;
    const prompt = designated
      ? currentRepository && currentRepository.repoId !== repository.repoId
        ? `Replace ${currentRepository.repoCode} with ${repository.repoCode} as the SkyCommand repository?`
        : `Designate ${repository.repoCode} as the SkyCommand repository?`
      : `Clear ${repository.repoCode} as the SkyCommand repository? Managed tool onboarding will remain blocked until another repository is designated.`;

    if (!window.confirm(prompt)) {
      return;
    }

    setSaving(true);
    setError('');
    setSuccess('');

    try {
      const result = await adminService.updateSkycommandRepositoryDesignation(repository.repoId, {
        designated,
      });

      setReadiness(result.readiness || null);
      setSuccess(
        designated
          ? `${repository.repoCode} is now the SkyCommand repository.`
          : `Cleared the SkyCommand repository designation from ${repository.repoCode}.`,
      );

      await loadSelectedRepository(repository.repoId);
      await loadRepositories(filters, repository.repoId, currentPage);
    } catch (saveError) {
      setError(saveError.message || 'Failed to update SkyCommand repository designation.');
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
      await loadSelectedRepository(repository.repoId);
      await Promise.all([
        loadRepositories(filters, repository.repoId, currentPage),
        loadReadiness(),
      ]);
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
        reason: 'Deleted from SkyCommand Manage Repositories page.',
      });
      setSuccess(`Disabled repository ${repository.repoCode}.`);
      await Promise.all([loadRepositories(filters, '', currentPage), loadReadiness()]);
    } catch (saveError) {
      setError(saveError.message || 'Failed to delete repository.');
    } finally {
      setSaving(false);
    }
  }

  function clearFilters() {
    setFilters(DEFAULT_REPOSITORY_FILTERS);
    setCurrentPage(1);
  }

  function applySorting(nextSorts, customized) {
    const sorted = sortItemsBySorts(repositories, nextSorts, getRepositorySortValue);
    const selectedIndex = selectedRepoId
      ? sorted.findIndex((repository) => repository.repoId === selectedRepoId)
      : -1;
    const nextPage = selectedIndex >= 0
      ? Math.floor(selectedIndex / REPOSITORY_PAGE_SIZE) + 1
      : 1;

    setSorts(nextSorts);
    setSortingCustomized(customized);
    setCurrentPage(nextPage);
  }

  function updateSorting(field, event) {
    const nextState = getNextSortState({
      sorts,
      defaultSorts: MANAGE_REPOSITORY_DEFAULT_SORTS,
      sortingCustomized,
      field,
      shiftKey: Boolean(event?.shiftKey),
    });
    applySorting(nextState.sorts, nextState.customized);
  }

  function clearSorting() {
    applySorting(MANAGE_REPOSITORY_DEFAULT_SORTS, false);
  }

  function renderSortableHeader(label, field) {
    const activeIndex = sorts.findIndex((sort) => sort.field === field);
    const activeSort = activeIndex >= 0 ? sorts[activeIndex] : null;
    const directionIcon = activeSort?.direction === 'asc' ? '↑' : '↓';
    const sortDescription = activeSort
      ? `${activeSort.direction === 'asc' ? 'ascending' : 'descending'}, priority ${activeIndex + 1}`
      : 'not currently sorted';

    return (
      <th>
        <button
          aria-label={`${label}: ${sortDescription}. Click to sort; Shift+click to add to multi-column sorting.`}
          className={`sky-table-sort-button ${activeSort ? 'is-active' : ''}`}
          onClick={(event) => updateSorting(field, event)}
          title="Click to sort · Shift+click to add sort"
          type="button"
        >
          <span>{label}</span>
          <span className="sky-table-sort-indicator" aria-hidden="true">
            {activeSort ? directionIcon : '↕'}
          </span>
          {activeSort && (
            <span className="sky-table-sort-priority" aria-hidden="true">
              {activeIndex + 1}
            </span>
          )}
        </button>
      </th>
    );
  }

  function goToPage(page) {
    const nextPage = Math.min(Math.max(1, Number(page) || 1), pageCount);
    const nextRepository = sortedRepositories[(nextPage - 1) * REPOSITORY_PAGE_SIZE] || null;

    setCurrentPage(nextPage);
    setSelectedRepoId(nextRepository?.repoId || '');
    setSuccess('');
    setError('');
  }

  function renderPagination() {
    return (
      <div className="sky-pagination-row sky-canonical-operations-pagination-row">
        <div className="small sky-muted sky-canonical-operations-pagination-summary">
          Showing {rangeStart}-{rangeEnd} of {sortedRepositories.length} repository configuration record(s)
        </div>
        <div
          className="sky-pagination-controls sky-canonical-operations-pagination-controls"
          aria-label="Manage repositories pagination"
        >
          <button
            aria-label="First page"
            className="btn btn-sm sky-pagination-nav-button"
            disabled={safeCurrentPage <= 1 || loading}
            onClick={() => goToPage(1)}
            title="First page"
            type="button"
          >
            «
          </button>
          <button
            aria-label="Previous page"
            className="btn btn-sm sky-pagination-nav-button"
            disabled={safeCurrentPage <= 1 || loading}
            onClick={() => goToPage(safeCurrentPage - 1)}
            title="Previous page"
            type="button"
          >
            ‹
          </button>
          <label className="sky-pagination-select-label" htmlFor="manageRepositoriesPageSelect">
            Page
          </label>
          <select
            className="form-select form-select-sm sky-form-control sky-pagination-select"
            disabled={loading}
            id="manageRepositoriesPageSelect"
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
            aria-label="Next page"
            className="btn btn-sm sky-pagination-nav-button"
            disabled={safeCurrentPage >= pageCount || loading}
            onClick={() => goToPage(safeCurrentPage + 1)}
            title="Next page"
            type="button"
          >
            ›
          </button>
          <button
            aria-label="Last page"
            className="btn btn-sm sky-pagination-nav-button"
            disabled={safeCurrentPage >= pageCount || loading}
            onClick={() => goToPage(pageCount)}
            title="Last page"
            type="button"
          >
            »
          </button>
        </div>
        <div className="sky-canonical-operations-pagination-balance" aria-hidden="true" />
      </div>
    );
  }

  return (
    <>
      <header className="sky-page-header">
        <div>
          <div className="sky-page-kicker">Git Repositories · Manage</div>
          <h1 className="sky-page-title">Manage Repositories</h1>
          <p className="sky-page-subtitle">
            Search and maintain repository identity, branch conventions, generated-artifact
            settings, profile-specific local paths, lifecycle state, and the trusted SkyCommand
            repository designation.
          </p>
        </div>

        <button
          className="btn sky-btn-ghost"
          disabled={loading || readinessLoading}
          onClick={() =>
            Promise.all([
              loadRepositories(filters, selectedRepoId, currentPage),
              loadReadiness(),
            ])
          }
          type="button"
        >
          {loading || readinessLoading ? 'Refreshing...' : 'Refresh'}
        </button>
      </header>

      {error && <DismissibleAlert tone="danger">{error}</DismissibleAlert>}
      {success && <DismissibleAlert tone="success">{success}</DismissibleAlert>}

      <section className="sky-card mb-3 sky-functional-history-browser sky-manage-repositories-browser">
        <div className="sky-card-header">
          <div>
            <div className="sky-page-kicker">Repository browser</div>
            <h2 className="h5 mb-0">Configured repositories</h2>
            <p className="sky-muted small mb-0">
              Filter the catalogue, select a row to edit its configuration below, or open its
              repository details.
            </p>
          </div>

          <div className="sky-manage-repositories-filter-grid">
            <div className="sky-manage-repositories-search-filter">
              <label className="form-label sky-form-label" htmlFor="repositorySearch">
                Search
              </label>
              <input
                className="form-control sky-form-control"
                id="repositorySearch"
                onChange={(event) =>
                  setFilters((current) => ({ ...current, q: event.target.value }))
                }
                placeholder="Code, name, description, remote URL..."
                value={filters.q}
              />
            </div>
            <div>
              <label className="form-label sky-form-label" htmlFor="repositoryStatusFilter">
                Status
              </label>
              <select
                className="form-select sky-form-control"
                id="repositoryStatusFilter"
                onChange={(event) =>
                  setFilters((current) => ({ ...current, active: event.target.value }))
                }
                value={filters.active}
              >
                <option value="">All</option>
                <option value="true">Active</option>
                <option value="false">Disabled</option>
              </select>
            </div>
            <div>
              <label className="form-label sky-form-label" htmlFor="repositoryRoleFilter">
                Role
              </label>
              <select
                className="form-select sky-form-control"
                id="repositoryRoleFilter"
                onChange={(event) =>
                  setFilters((current) => ({ ...current, skycommand: event.target.value }))
                }
                value={filters.skycommand}
              >
                <option value="">All</option>
                <option value="true">SkyCommand</option>
                <option value="false">Standard</option>
              </select>
            </div>
            <div className="sky-manage-repositories-filter-actions">
              {sortingCustomized && (
                <button className="btn btn-sm sky-btn-ghost" onClick={clearSorting} type="button">
                  Clear sorting
                </button>
              )}
              <button className="btn btn-sm sky-btn-ghost" onClick={clearFilters} type="button">
                Clear filters
              </button>
            </div>
          </div>
        </div>

        <div className="table-responsive sky-table-card sky-functional-history-table-card sky-canonical-operations-table-frame">
          <table className="table table-sm table-hover sky-table sky-canonical-operations-table align-middle mb-0">
            <thead>
              <tr>
                {renderSortableHeader('Repository', 'repository')}
                {renderSortableHeader('Branches', 'branches')}
                {renderSortableHeader('Remote', 'remote')}
                {renderSortableHeader('Role', 'role')}
                {renderSortableHeader('Status', 'status')}
                {renderSortableHeader('Updated', 'updated')}
                <th className="text-end">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan="7">
                    <div className="sky-empty-state py-4">
                      <div className="spinner-border text-info" role="status" aria-label="Loading" />
                    </div>
                  </td>
                </tr>
              ) : visibleRepositories.length === 0 ? (
                <tr>
                  <td colSpan="7">
                    <div className="sky-empty-state py-4">
                      No repositories match the current filters.
                    </div>
                  </td>
                </tr>
              ) : (
                visibleRepositories.map((repository) => (
                  <tr
                    className={`sky-clickable-row ${
                      repository.repoId === selectedRepoId ? 'sky-selected-row' : ''
                    }`}
                    key={repository.repoId}
                    onClick={() => {
                      setSelectedRepoId(repository.repoId);
                      setSuccess('');
                      setError('');
                    }}
                  >
                    <td>
                      <div className="fw-semibold sky-detail-value">{repository.repoName}</div>
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
                      {repository.isSkycommandRepository ? (
                        <span className="sky-pill sky-pill-info">SKYCOMMAND</span>
                      ) : (
                        <span className="sky-muted">Standard</span>
                      )}
                    </td>
                    <td>
                      <span className={`sky-pill ${repositoryStatusClass(repository.active)}`}>
                        {repositoryStatusLabel(repository.active)}
                      </span>
                    </td>
                    <td>{formatRepositoryDate(repository.updatedAt)}</td>
                    <td className="text-end">
                      <button
                        className="btn btn-sm sky-btn-ghost"
                        onClick={(event) => {
                          event.stopPropagation();
                          openRepositoryDetails(repository);
                        }}
                        type="button"
                      >
                        Repository Details
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        {renderPagination()}
      </section>

      <section className="sky-card">
        <div className="sky-card-header d-flex flex-wrap align-items-center justify-content-between gap-2">
          <div>
            <h2 className="h5 mb-0">Repository configuration</h2>
            <div className="small sky-muted">
              Edit metadata, generated-artifact settings, and profile-specific local paths for the
              selected repository.
            </div>
          </div>
          {selectedRepository && canWrite && (
            <div className="d-flex flex-wrap gap-2">
              <button
                className={
                  selectedRepository.isSkycommandRepository
                    ? 'btn btn-sm btn-outline-warning'
                    : 'btn btn-sm sky-btn-ghost'
                }
                disabled={
                  saving ||
                  (!selectedRepository.active && !selectedRepository.isSkycommandRepository)
                }
                onClick={() =>
                  handleSkycommandDesignation(
                    selectedRepository,
                    !selectedRepository.isSkycommandRepository,
                  )
                }
                type="button"
              >
                {selectedRepository.isSkycommandRepository
                  ? 'Clear SkyCommand'
                  : 'Set SkyCommand'}
              </button>
              <button
                className="btn btn-sm sky-btn-ghost"
                disabled={saving || selectedRepository.isSkycommandRepository}
                onClick={() => handleToggleStatus(selectedRepository)}
                type="button"
              >
                {selectedRepository.active ? 'Disable repository' : 'Enable repository'}
              </button>
              <button
                className="btn btn-sm btn-outline-danger"
                disabled={
                  saving ||
                  !selectedRepository.active ||
                  selectedRepository.isSkycommandRepository
                }
                onClick={() => handleDelete(selectedRepository)}
                type="button"
              >
                Delete
              </button>
            </div>
          )}
        </div>

        {detailLoading ? (
          <div className="sky-empty-state py-5">
            <div className="spinner-border text-info" role="status" aria-label="Loading" />
          </div>
        ) : selectedRepository ? (
          <RepositoryForm
            canWrite={canWrite}
            form={form}
            idPrefix="manage-repository"
            onFormChange={updateForm}
            onPathChange={updatePathForm}
            onReset={resetSelectedForm}
            onSubmit={handleSave}
            saving={saving}
            selectedRepository={selectedRepository}
            submitLabel="Save repository"
          />
        ) : (
          <div className="sky-empty-state py-5">
            Select a repository to inspect or edit its configuration.
          </div>
        )}
      </section>

      {detailsOpen && (
        <div
          aria-label="Repository details"
          aria-modal="true"
          className="sky-chart-modal-backdrop sky-tool-details-modal-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              setDetailsOpen(false);
            }
          }}
          role="dialog"
        >
          <section className="sky-chart-modal sky-tool-details-modal">
            <div className="sky-chart-modal-header">
              <div>
                <div className="sky-page-kicker sky-chart-modal-kicker">Repository details</div>
                <h2>
                  {selectedRepository?.repoId === selectedRepoId
                    ? selectedRepository.repoName
                    : 'Repository details'}
                </h2>
                <p>
                  {selectedRepository?.repoId === selectedRepoId
                    ? selectedRepository.repoCode
                    : 'Loading selected repository...'}
                </p>
              </div>
              <button
                aria-label="Close repository details"
                className="sky-chart-modal-close"
                onClick={() => setDetailsOpen(false)}
                type="button"
              >
                <svg aria-hidden="true" className="sky-chart-modal-close-icon" viewBox="0 0 24 24">
                  <path d="M6 6l12 12M18 6L6 18" />
                </svg>
              </button>
            </div>

            <div className="sky-tool-details-modal-body">
              {detailLoading || selectedRepository?.repoId !== selectedRepoId ? (
                <div className="sky-empty-state py-5">
                  <div className="spinner-border text-info" role="status" aria-label="Loading" />
                </div>
              ) : selectedRepository ? (
                <>
                  <div className="sky-execution-metric-grid">
                    <div className="sky-mini-metric">
                      <div className="sky-page-kicker">Status</div>
                      <span className={`sky-pill ${repositoryStatusClass(selectedRepository.active)}`}>
                        {repositoryStatusLabel(selectedRepository.active)}
                      </span>
                    </div>
                    <div className="sky-mini-metric">
                      <div className="sky-page-kicker">Role</div>
                      <div className="sky-mini-metric-value">
                        {selectedRepository.isSkycommandRepository ? 'SkyCommand' : 'Standard'}
                      </div>
                    </div>
                    <div className="sky-mini-metric">
                      <div className="sky-page-kicker">Configured paths</div>
                      <div className="sky-mini-metric-value">{selectedPathCount}</div>
                    </div>
                    <div className="sky-mini-metric">
                      <div className="sky-page-kicker">Display order</div>
                      <div className="sky-mini-metric-value">{selectedRepository.displayOrder}</div>
                    </div>
                  </div>

                  <section className="sky-card mb-3">
                    <div className="sky-card-header">
                      <h3 className="h5 mb-0">Repository identity</h3>
                    </div>
                    <div className="sky-card-body">
                      <dl className="row g-2 mb-0">
                        <dt className="col-md-3 sky-detail-label">Repository</dt>
                        <dd className="col-md-9 sky-detail-value">{selectedRepository.repoName}</dd>
                        <dt className="col-md-3 sky-detail-label">Code</dt>
                        <dd className="col-md-9 sky-detail-value sky-mono">
                          {selectedRepository.repoCode}
                        </dd>
                        <dt className="col-md-3 sky-detail-label">Main branch</dt>
                        <dd className="col-md-9 sky-detail-value sky-mono">
                          {selectedRepository.mainBranch}
                        </dd>
                        <dt className="col-md-3 sky-detail-label">Dev branch</dt>
                        <dd className="col-md-9 sky-detail-value sky-mono">
                          {selectedRepository.devBranch}
                        </dd>
                        <dt className="col-md-3 sky-detail-label">Remote URL</dt>
                        <dd className="col-md-9 sky-detail-value sky-mono text-break">
                          {selectedRepository.remoteUrl || '—'}
                        </dd>
                        <dt className="col-md-3 sky-detail-label">Updated</dt>
                        <dd className="col-md-9 sky-detail-value">
                          {formatRepositoryDate(selectedRepository.updatedAt)}
                        </dd>
                        <dt className="col-md-3 sky-detail-label">Created</dt>
                        <dd className="col-md-9 sky-detail-value">
                          {formatRepositoryDate(selectedRepository.createdAt)}
                        </dd>
                      </dl>
                    </div>
                  </section>

                  <section className="sky-card mb-3">
                    <div className="sky-card-header">
                      <div>
                        <div className="sky-page-kicker">Generated artifacts</div>
                        <h3 className="h5 mb-0">Map and zip configuration</h3>
                      </div>
                    </div>
                    <div className="sky-card-body">
                      <dl className="row g-2 mb-0">
                        <dt className="col-md-3 sky-detail-label">Map file name</dt>
                        <dd className="col-md-9 sky-detail-value sky-mono text-break">
                          {selectedRepository.repoMapFileName || '—'}
                        </dd>
                        <dt className="col-md-3 sky-detail-label">Map output path</dt>
                        <dd className="col-md-9 sky-detail-value sky-mono text-break">
                          {selectedRepository.repoMapOutputPath || 'Repository root'}
                        </dd>
                        <dt className="col-md-3 sky-detail-label">Zip file name</dt>
                        <dd className="col-md-9 sky-detail-value sky-mono text-break">
                          {selectedRepository.repoZipFileName || '—'}
                        </dd>
                        <dt className="col-md-3 sky-detail-label">Zip output path</dt>
                        <dd className="col-md-9 sky-detail-value sky-mono text-break">
                          {selectedRepository.repoZipOutputPath || 'Repository root'}
                        </dd>
                      </dl>
                    </div>
                  </section>

                  <section className="sky-card">
                    <div className="sky-card-header">
                      <div>
                        <div className="sky-page-kicker">Profile paths</div>
                        <h3 className="h5 mb-0">Configured paths</h3>
                      </div>
                    </div>
                    <div className="table-responsive">
                      <table className="table table-sm sky-table mb-0">
                        <thead>
                          <tr>
                            <th>Profile</th>
                            <th>Root path</th>
                            <th>Status</th>
                          </tr>
                        </thead>
                        <tbody>
                          {selectedPaths.length === 0 ? (
                            <tr>
                              <td colSpan="3">
                                <div className="sky-empty-state py-3">
                                  No profile paths are configured for this repository.
                                </div>
                              </td>
                            </tr>
                          ) : (
                            selectedPaths.map((path) => (
                              <tr key={path.profileId}>
                                <td>
                                  <div className="fw-semibold sky-detail-value">
                                    {path.profileCode}
                                  </div>
                                </td>
                                <td className="sky-mono small text-break">
                                  {path.rootPath || 'Not configured'}
                                </td>
                                <td>
                                  <span
                                    className={`sky-pill ${repositoryStatusClass(
                                      path.active && path.rootPath,
                                    )}`}
                                  >
                                    {path.active && path.rootPath ? 'ACTIVE' : 'NOT SET'}
                                  </span>
                                </td>
                              </tr>
                            ))
                          )}
                        </tbody>
                      </table>
                    </div>
                  </section>
                </>
              ) : (
                <div className="sky-empty-state py-5">Repository details are unavailable.</div>
              )}
            </div>
          </section>
        </div>
      )}
    </>
  );
}

export default ManageRepositories;
