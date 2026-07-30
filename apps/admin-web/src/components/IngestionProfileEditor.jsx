function IngestionProfileEditor({ disabled = false, onChange, options = {}, profile }) {
  if (!profile) {
    return null;
  }

  const domains = options.dataDomains || [];
  const sources = (options.dataSources || []).filter(
    (source) => !profile.dataDomainId || source.domainId === profile.dataDomainId,
  );

  function updateDomain(dataDomainId) {
    const nextSources = (options.dataSources || []).filter(
      (source) => source.domainId === dataDomainId,
    );
    const sourceId = nextSources.some((source) => source.sourceId === profile.sourceId)
      ? profile.sourceId
      : nextSources[0]?.sourceId || '';

    onChange({ ...profile, dataDomainId, sourceId });
  }

  function update(key, value) {
    onChange({ ...profile, [key]: value });
  }

  const capabilities = [
    ['supportsIncremental', 'Incremental'],
    ['supportsSelectedAssets', 'Selected assets'],
    ['supportsBackfill', 'Backfill'],
    ['supportsRevisions', 'Revisions'],
    ['supportsResume', 'Resume'],
    ['supportsDryRun', 'Dry run'],
  ];

  return (
    <div className="col-12">
      <div className="border rounded p-3 mt-2">
        <div className="d-flex flex-wrap align-items-start justify-content-between gap-2 mb-3">
          <div>
            <div className="sky-subsection-title">Portable ingestion profile</div>
            <div className="small sky-muted">
              Required for tools in an INGESTION category. This metadata drives discovery,
              source identity, capabilities, and future recovery behaviour.
            </div>
          </div>
          <label className="form-check form-switch">
            <input
              checked={profile.active !== false}
              className="form-check-input"
              disabled={disabled}
              onChange={(event) => update('active', event.target.checked)}
              type="checkbox"
            />
            <span className="form-check-label">Profile active</span>
          </label>
        </div>

        <div className="row g-3">
          <div className="col-md-6 col-xl-3">
            <label className="form-label sky-form-label" htmlFor="ingestionProfileDomain">
              Data domain <span className="text-danger">*</span>
            </label>
            <select
              className="form-select sky-form-control"
              disabled={disabled}
              id="ingestionProfileDomain"
              onChange={(event) => updateDomain(event.target.value)}
              required
              value={profile.dataDomainId}
            >
              <option value="">Select a domain</option>
              {domains.map((domain) => (
                <option key={domain.domainId} value={domain.domainId}>
                  {domain.name} ({domain.domainCode})
                </option>
              ))}
            </select>
          </div>

          <div className="col-md-6 col-xl-3">
            <label className="form-label sky-form-label" htmlFor="ingestionProfileSource">
              Source <span className="text-danger">*</span>
            </label>
            <select
              className="form-select sky-form-control"
              disabled={disabled || !profile.dataDomainId}
              id="ingestionProfileSource"
              onChange={(event) => update('sourceId', event.target.value)}
              required
              value={profile.sourceId}
            >
              <option value="">Select a source</option>
              {sources.map((source) => (
                <option key={source.sourceId} value={source.sourceId}>
                  {source.name} ({source.sourceCode})
                </option>
              ))}
            </select>
          </div>

          <div className="col-md-6 col-xl-3">
            <label className="form-label sky-form-label" htmlFor="ingestionProfileAdapter">
              Adapter code <span className="text-danger">*</span>
            </label>
            <input
              className="form-control sky-form-control sky-mono"
              disabled={disabled}
              id="ingestionProfileAdapter"
              onChange={(event) => update('adapterCode', event.target.value.toUpperCase())}
              placeholder="EXAMPLE_API"
              required
              value={profile.adapterCode}
            />
          </div>

          <div className="col-md-6 col-xl-3">
            <label className="form-label sky-form-label" htmlFor="ingestionProfileContract">
              Result contract <span className="text-danger">*</span>
            </label>
            <input
              className="form-control sky-form-control sky-mono"
              disabled={disabled}
              id="ingestionProfileContract"
              onChange={(event) => update('contractVersion', event.target.value.toLowerCase())}
              placeholder="ingestion_run_summary.v1"
              required
              value={profile.contractVersion}
            />
          </div>

          <div className="col-12">
            <div className="small sky-muted mb-2">Declared capabilities</div>
            <div className="d-flex flex-wrap gap-3">
              {capabilities.map(([key, label]) => (
                <label className="form-check" key={key}>
                  <input
                    checked={Boolean(profile[key])}
                    className="form-check-input"
                    disabled={disabled}
                    onChange={(event) => update(key, event.target.checked)}
                    type="checkbox"
                  />
                  <span className="form-check-label">{label}</span>
                </label>
              ))}
            </div>
          </div>

          <div className="col-12">
            <label className="form-label sky-form-label" htmlFor="ingestionProfileConfiguration">
              Non-secret adapter configuration (JSON)
            </label>
            <textarea
              className="form-control sky-form-control sky-mono"
              disabled={disabled}
              id="ingestionProfileConfiguration"
              onChange={(event) => update('configurationText', event.target.value)}
              rows="4"
              value={profile.configurationText}
            />
            <div className="form-text sky-muted">
              Credentials do not belong here; use environment or approved secret storage.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default IngestionProfileEditor;
