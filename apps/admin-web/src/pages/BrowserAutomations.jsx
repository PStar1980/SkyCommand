import { useEffect, useMemo, useState } from 'react';
import PageHeader from '../components/ui/PageHeader.jsx';
import DismissibleAlert from '../components/ui/DismissibleAlert.jsx';
import browserAutomationService from '../services/browserAutomationService.js';

function normalizeText(value) {
  return String(value ?? '').trim().toLowerCase();
}

function statusPill(enabled) {
  return <span className={`sky-pill ${enabled ? 'sky-pill-success' : ''}`}>{enabled ? 'ACTIVE' : 'DISABLED'}</span>;
}

function sideEffectPill(level) {
  const normalized = String(level || 'READ_ONLY').toUpperCase();
  const className = normalized === 'HIGH_IMPACT'
    ? 'sky-pill-danger'
    : normalized === 'MUTATING'
      ? 'sky-pill-warning'
      : 'sky-pill-info';
  return <span className={`sky-pill ${className}`}>{normalized.replace('_', ' ')}</span>;
}

function DetailRow({ label, children }) {
  return (
    <tr>
      <th scope="row">{label}</th>
      <td>{children ?? '—'}</td>
    </tr>
  );
}

export function BrowserAutomationRegistry() {
  const [items, setItems] = useState([]);
  const [options, setOptions] = useState(null);
  const [selectedId, setSelectedId] = useState('');
  const [search, setSearch] = useState('');
  const [categoryCode, setCategoryCode] = useState('');
  const [sideEffectLevel, setSideEffectLevel] = useState('');
  const [enabledFilter, setEnabledFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    async function load() {
      setLoading(true);
      setError('');
      try {
        const [registryResult, optionsResult] = await Promise.all([
          browserAutomationService.listAdminAutomations({ limit: 100, offset: 0 }),
          browserAutomationService.getAdminOptions(),
        ]);
        if (!active) return;
        const nextItems = registryResult.items || [];
        setItems(nextItems);
        setOptions(optionsResult.options || null);
        setSelectedId((current) => current || nextItems[0]?.automationId || '');
      } catch (loadError) {
        if (active) setError(loadError.message || 'Failed to load the Playwright Automation registry.');
      } finally {
        if (active) setLoading(false);
      }
    }
    load();
    return () => { active = false; };
  }, []);

  const filteredItems = useMemo(() => {
    const needle = normalizeText(search);
    return items.filter((item) => {
      const matchesSearch = !needle || [
        item.label,
        item.automationCode,
        item.description,
        item.scriptPath,
        item.outputType,
      ].some((value) => normalizeText(value).includes(needle));
      const matchesCategory = !categoryCode || item.category?.categoryCode === categoryCode;
      const matchesSideEffects = !sideEffectLevel || item.sideEffectLevel === sideEffectLevel;
      const matchesStatus = enabledFilter === '' || String(Boolean(item.enabled)) === enabledFilter;
      return matchesSearch && matchesCategory && matchesSideEffects && matchesStatus;
    });
  }, [categoryCode, enabledFilter, items, search, sideEffectLevel]);

  useEffect(() => {
    if (!filteredItems.some((item) => item.automationId === selectedId)) {
      setSelectedId(filteredItems[0]?.automationId || '');
    }
  }, [filteredItems, selectedId]);

  const selected = items.find((item) => item.automationId === selectedId) || null;

  function clearFilters() {
    setSearch('');
    setCategoryCode('');
    setSideEffectLevel('');
    setEnabledFilter('');
  }

  return (
    <>
      <PageHeader
        kicker="PLAYWRIGHT AUTOMATION · REGISTRY"
        subtitle="Phase 6 establishes source-controlled automation definitions, typed parameters, safety contracts, environments, permissions, and structured outputs. Execution surfaces arrive in Phase 7."
        title="Automation Registry"
      />

      {error && <DismissibleAlert className="mb-3" message={error} onDismiss={() => setError('')} variant="danger" />}

      <section className="sky-card mb-3">
        <div className="sky-card-header">
          <div>
            <div className="sky-page-kicker">Automation catalogue</div>
            <h2 className="h5 mb-0">Registered Automations</h2>
            <div className="small sky-muted mt-1">Browse Playwright Automation definitions before operator execution is enabled in Phase 7.</div>
          </div>
        </div>
        <div className="sky-card-body">
          <div className="row g-2 align-items-end mb-3">
            <div className="col-xl-5">
              <label className="form-label" htmlFor="browserAutomationRegistrySearch">Search</label>
              <input
                className="form-control"
                id="browserAutomationRegistrySearch"
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Name, code, description, source path..."
                value={search}
              />
            </div>
            <div className="col-xl-2">
              <label className="form-label" htmlFor="browserAutomationRegistryCategory">Category</label>
              <select className="form-select" id="browserAutomationRegistryCategory" onChange={(event) => setCategoryCode(event.target.value)} value={categoryCode}>
                <option value="">All categories</option>
                {(options?.categories || []).map((category) => <option key={category.categoryCode} value={category.categoryCode}>{category.label}</option>)}
              </select>
            </div>
            <div className="col-xl-2">
              <label className="form-label" htmlFor="browserAutomationRegistrySideEffect">Side effects</label>
              <select className="form-select" id="browserAutomationRegistrySideEffect" onChange={(event) => setSideEffectLevel(event.target.value)} value={sideEffectLevel}>
                <option value="">All levels</option>
                {(options?.sideEffectLevels || []).map((level) => <option key={level} value={level}>{level.replace('_', ' ')}</option>)}
              </select>
            </div>
            <div className="col-xl-2">
              <label className="form-label" htmlFor="browserAutomationRegistryStatus">Status</label>
              <select className="form-select" id="browserAutomationRegistryStatus" onChange={(event) => setEnabledFilter(event.target.value)} value={enabledFilter}>
                <option value="">All statuses</option>
                <option value="true">Active</option>
                <option value="false">Disabled</option>
              </select>
            </div>
            <div className="col-xl-1 d-grid">
              <button className="btn btn-sm sky-btn-primary" onClick={clearFilters} type="button">Clear filters</button>
            </div>
          </div>

          <div className="sky-canonical-operations-table-frame">
            <div className="table-responsive">
              <table className="table table-sm align-middle mb-0 sky-canonical-operations-table">
                <thead>
                  <tr>
                    <th>AUTOMATION</th>
                    <th>CATEGORY</th>
                    <th>SIDE EFFECTS</th>
                    <th>IDEMPOTENCY</th>
                    <th>RETRIES</th>
                    <th>OUTPUT CONTRACT</th>
                    <th>STATUS</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr><td colSpan={7}><div className="sky-empty-state">Loading Playwright Automation registry...</div></td></tr>
                  ) : filteredItems.length === 0 ? (
                    <tr><td colSpan={7}><div className="sky-empty-state">No Playwright Automations match the current filters.</div></td></tr>
                  ) : filteredItems.map((item) => (
                    <tr
                      className={`sky-clickable-row ${item.automationId === selectedId ? 'sky-selected-row' : ''}`}
                      key={item.automationId}
                      onClick={() => setSelectedId(item.automationId)}
                    >
                      <td><strong>{item.label}</strong><div className="small sky-muted font-monospace">{item.automationCode}</div></td>
                      <td>{item.category?.label || 'Uncategorized'}</td>
                      <td>{sideEffectPill(item.sideEffectLevel)}</td>
                      <td>{String(item.idempotencyMode || '').replace('_', ' ')}</td>
                      <td>{item.retryCount}</td>
                      <td><span className="font-monospace">{item.outputType}</span></td>
                      <td>{statusPill(item.enabled)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <div className="small sky-muted mt-2">Showing {filteredItems.length} of {items.length} registered automation(s).</div>
        </div>
      </section>

      {selected && (
        <section className="sky-card mb-3">
          <div className="sky-card-header">
            <div>
              <div className="sky-page-kicker">Registry detail</div>
              <h2 className="h5 mb-0">{selected.label}</h2>
              <div className="small sky-muted mt-1">{selected.description || 'No description configured.'}</div>
            </div>
            <div className="d-flex gap-2 align-items-center">
              {sideEffectPill(selected.sideEffectLevel)}
              {statusPill(selected.enabled)}
            </div>
          </div>
          <div className="sky-card-body">
            <div className="table-responsive">
              <table className="table table-sm mb-0 sky-detail-table">
                <tbody>
                  <DetailRow label="Automation code"><span className="font-monospace">{selected.automationCode}</span></DetailRow>
                  <DetailRow label="Source">{selected.scriptRepository?.repoName || selected.scriptRepository?.repoCode} · <span className="font-monospace">{selected.scriptPath}</span></DetailRow>
                  <DetailRow label="Environment">{selected.defaultEnvironmentCode}</DetailRow>
                  <DetailRow label="Browser">{String(selected.browserType || '').toUpperCase()}</DetailRow>
                  <DetailRow label="Risk">{selected.riskName || selected.riskCode}</DetailRow>
                  <DetailRow label="Confirmation">{selected.requiresConfirmation ? selected.confirmationText || 'Required' : 'Not required'}</DetailRow>
                  <DetailRow label="Side effects">{selected.sideEffectLevel}</DetailRow>
                  <DetailRow label="Idempotency">{selected.idempotencyMode}</DetailRow>
                  <DetailRow label="Retries / concurrency">{selected.retryCount} / {selected.maxConcurrency}</DetailRow>
                  <DetailRow label="Output contract"><span className="font-monospace">{selected.outputType}</span></DetailRow>
                  <DetailRow label="Output schema"><span className="font-monospace">{selected.outputSchemaPath}</span></DetailRow>
                  <DetailRow label="Parameters / environments">{selected.parameterCount} / {selected.environmentCount}</DetailRow>
                </tbody>
              </table>
            </div>
          </div>
        </section>
      )}
    </>
  );
}

export default BrowserAutomationRegistry;
