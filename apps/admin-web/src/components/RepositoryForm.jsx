function RepositoryForm({
  canWrite,
  form,
  idPrefix = 'repository',
  onFormChange,
  onPathChange,
  onReset,
  onSubmit,
  saving = false,
  selectedRepository = null,
  submitLabel = 'Save repository',
}) {
  const fieldId = (name) => `${idPrefix}-${name}`;

  return (
    <form className="sky-card-body" onSubmit={onSubmit}>
      <div className="row g-3">
        <div className="col-md-6">
          <label className="form-label sky-form-label" htmlFor={fieldId('repo-code')}>
            Repository Code <span className="text-danger">*</span>
          </label>
          <input
            className="form-control sky-form-control sky-mono"
            disabled={!canWrite || saving}
            id={fieldId('repo-code')}
            onChange={(event) => onFormChange('repoCode', event.target.value)}
            required
            value={form.repoCode}
          />
        </div>
        <div className="col-md-6">
          <label className="form-label sky-form-label" htmlFor={fieldId('repo-name')}>
            Repository Name <span className="text-danger">*</span>
          </label>
          <input
            className="form-control sky-form-control"
            disabled={!canWrite || saving}
            id={fieldId('repo-name')}
            onChange={(event) => onFormChange('repoName', event.target.value)}
            required
            value={form.repoName}
          />
        </div>
      </div>

      <div className="mt-3">
        <label className="form-label sky-form-label" htmlFor={fieldId('description')}>
          Description
        </label>
        <textarea
          className="form-control sky-form-control"
          disabled={!canWrite || saving}
          id={fieldId('description')}
          onChange={(event) => onFormChange('description', event.target.value)}
          rows="3"
          value={form.description}
        />
      </div>

      <div className="mt-3">
        <label className="form-label sky-form-label" htmlFor={fieldId('remote-url')}>
          Remote URL
        </label>
        <input
          className="form-control sky-form-control"
          disabled={!canWrite || saving}
          id={fieldId('remote-url')}
          onChange={(event) => onFormChange('remoteUrl', event.target.value)}
          placeholder="https://github.com/owner/repository.git"
          value={form.remoteUrl}
        />
      </div>

      <div className="row g-3 mt-0">
        <div className="col-md-4">
          <label className="form-label sky-form-label" htmlFor={fieldId('main-branch')}>
            Main Branch
          </label>
          <input
            className="form-control sky-form-control sky-mono"
            disabled={!canWrite || saving}
            id={fieldId('main-branch')}
            onChange={(event) => onFormChange('mainBranch', event.target.value)}
            value={form.mainBranch}
          />
        </div>
        <div className="col-md-4">
          <label className="form-label sky-form-label" htmlFor={fieldId('dev-branch')}>
            Dev Branch
          </label>
          <input
            className="form-control sky-form-control sky-mono"
            disabled={!canWrite || saving}
            id={fieldId('dev-branch')}
            onChange={(event) => onFormChange('devBranch', event.target.value)}
            value={form.devBranch}
          />
        </div>
        <div className="col-md-4">
          <label className="form-label sky-form-label" htmlFor={fieldId('display-order')}>
            Display Order
          </label>
          <input
            className="form-control sky-form-control"
            disabled={!canWrite || saving}
            id={fieldId('display-order')}
            onChange={(event) => onFormChange('displayOrder', event.target.value)}
            type="number"
            value={form.displayOrder}
          />
        </div>
      </div>

      <div className="form-check form-switch mt-3">
        <input
          checked={form.active}
          className="form-check-input"
          disabled={!canWrite || saving || selectedRepository?.isSkycommandRepository}
          id={fieldId('active')}
          onChange={(event) => onFormChange('active', event.target.checked)}
          type="checkbox"
        />
        <label className="form-check-label sky-muted" htmlFor={fieldId('active')}>
          Active repository
        </label>
      </div>
      {selectedRepository?.isSkycommandRepository && (
        <div className="small sky-muted mt-1">
          Clear the SkyCommand designation before disabling this repository.
        </div>
      )}

      <hr />

      <div className="sky-page-kicker mb-2">Profile Paths</div>
      {form.paths.length === 0 ? (
        <div className="sky-empty-state py-4">No configuration profiles are available.</div>
      ) : (
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
                    aria-label={`${path.profileCode} path active`}
                    checked={path.active}
                    className="form-check-input"
                    disabled={!canWrite || saving}
                    onChange={(event) => onPathChange(path.profileId, 'active', event.target.checked)}
                    type="checkbox"
                  />
                </div>
              </div>
              <input
                aria-label={`${path.profileCode} repository root path`}
                className="form-control sky-form-control sky-mono"
                disabled={!canWrite || saving || !path.active}
                onChange={(event) => onPathChange(path.profileId, 'rootPath', event.target.value)}
                placeholder="C:\\Path\\To\\Repository"
                value={path.rootPath}
              />
            </div>
          ))}
        </div>
      )}

      {canWrite && (
        <div className="d-flex flex-wrap gap-2 mt-4">
          <button className="btn sky-btn-primary" disabled={saving} type="submit">
            {saving ? 'Saving...' : submitLabel}
          </button>
          <button className="btn sky-btn-ghost" disabled={saving} onClick={onReset} type="button">
            Reset
          </button>
        </div>
      )}
    </form>
  );
}

export default RepositoryForm;
