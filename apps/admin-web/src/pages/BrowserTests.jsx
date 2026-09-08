import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import DismissibleAlert from '../components/ui/DismissibleAlert.jsx';
import PageHeader from '../components/ui/PageHeader.jsx';
import Panel from '../components/ui/Panel.jsx';
import StatusPill from '../components/ui/StatusPill.jsx';
import browserTestService from '../services/browserTestService.js';

const TERMINAL_RUN_STATUSES = new Set(['COMPLETED', 'FAILED', 'CANCELED', 'TERMINATED', 'TIMED_OUT']);
const DEFAULT_RUN_FILTERS = { q: '', categoryCode: '', environmentCode: '' };
const DEFAULT_MANAGE_FILTERS = { q: '', categoryCode: '', enabled: '' };

function normalizeBoolean(value) {
  return value === true || value === 'true' || value === 't' || value === 1 || value === '1';
}

function formatDuration(milliseconds) {
  const value = Number(milliseconds);
  if (!Number.isFinite(value) || value < 0) return '—';
  if (value < 1000) return `${Math.round(value)} ms`;
  if (value < 60000) return `${(value / 1000).toFixed(value < 10000 ? 1 : 0)} s`;
  const minutes = Math.floor(value / 60000);
  const seconds = Math.floor((value % 60000) / 1000);
  return `${minutes}m ${String(seconds).padStart(2, '0')}s`;
}

function formatDateTime(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString();
}

function getRunDuration(run) {
  if (run?.result?.durationMs !== undefined) return Number(run.result.durationMs);
  if (!run?.startTime) return null;
  const start = new Date(run.startTime).getTime();
  const end = run.closeTime ? new Date(run.closeTime).getTime() : Date.now();
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  return Math.max(0, end - start);
}

function riskToneClass(riskCode) {
  const normalized = String(riskCode || '').toLowerCase();
  if (normalized === 'high') return 'sky-pill-danger';
  if (normalized === 'medium') return 'sky-pill-warning';
  return 'sky-pill-success';
}

function getInitialParameterValues(test) {
  return (test?.parameters || []).reduce((values, parameter) => {
    if (parameter.defaultValue !== undefined && parameter.defaultValue !== null) {
      values[parameter.parameterName] = parameter.defaultValue;
    } else if (parameter.type === 'boolean') {
      values[parameter.parameterName] = false;
    } else {
      values[parameter.parameterName] = '';
    }
    return values;
  }, {});
}

function cleanParameterValues(values = {}) {
  return Object.fromEntries(
    Object.entries(values).filter(([, value]) => value !== undefined && value !== null && value !== ''),
  );
}

function BrowserRuntimeParameterFields({ disabled = false, parameters = [], values = {}, onChange }) {
  const orderedParameters = [...parameters]
    .filter((parameter) => parameter.enabled !== false)
    .sort((left, right) => Number(left.displayOrder || 0) - Number(right.displayOrder || 0));

  if (orderedParameters.length === 0) {
    return <div className="small sky-muted">This Browser Test has no runtime parameters.</div>;
  }

  return (
    <div className="row g-3">
      {orderedParameters.map((parameter) => {
        const id = `browser-test-param-${parameter.parameterName}`;
        const value = values[parameter.parameterName] ?? '';
        const options = (parameter.options || []).filter((option) => option.enabled !== false);
        const shouldUseSelect = parameter.type === 'repo' || parameter.type === 'select' || options.length > 0;

        return (
          <div className="col-12 col-lg-6" key={parameter.parameterId || parameter.parameterName}>
            <label className="form-label" htmlFor={id}>
              {parameter.label}
              {parameter.required && <span className="text-danger"> *</span>}
            </label>

            {parameter.type === 'boolean' ? (
              <div className="form-check form-switch pt-1">
                <input
                  checked={normalizeBoolean(value)}
                  className="form-check-input"
                  disabled={disabled}
                  id={id}
                  onChange={(event) => onChange(parameter.parameterName, event.target.checked)}
                  type="checkbox"
                />
                <label className="form-check-label sky-muted" htmlFor={id}>
                  {parameter.prompt || parameter.label}
                </label>
              </div>
            ) : shouldUseSelect ? (
              <select
                className="form-select sky-form-control"
                disabled={disabled}
                id={id}
                onChange={(event) => onChange(parameter.parameterName, event.target.value)}
                required={parameter.required}
                value={String(value)}
              >
                <option value="">{parameter.prompt || `Select ${parameter.label}`}</option>
                {options.map((option) => (
                  <option key={option.optionId || option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            ) : parameter.type === 'json' ? (
              <textarea
                className="form-control sky-form-control sky-mono"
                disabled={disabled}
                id={id}
                onChange={(event) => onChange(parameter.parameterName, event.target.value)}
                placeholder={parameter.prompt || parameter.parameterName}
                rows={4}
                value={typeof value === 'string' ? value : JSON.stringify(value, null, 2)}
              />
            ) : (
              <input
                className="form-control sky-form-control"
                disabled={disabled}
                id={id}
                onChange={(event) => onChange(parameter.parameterName, event.target.value)}
                placeholder={parameter.prompt || parameter.parameterName}
                required={parameter.required}
                type={parameter.type === 'number' ? 'number' : parameter.type === 'date' ? 'date' : 'text'}
                value={String(value)}
              />
            )}

            {parameter.type !== 'boolean' && parameter.prompt && (
              <div className="form-text sky-muted">{parameter.prompt}</div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function BrowserRunStatusPanel({ run, workflowId }) {
  if (!workflowId) return null;
  const status = run?.status || 'STARTED';
  const result = run?.result || null;

  return (
    <Panel
      actions={<StatusPill status={status} />}
      className="mt-3"
      kicker="LIVE EXECUTION"
      subtitle="Temporal-backed Browser Worker execution state."
      title="Browser Test Run"
    >
      <div className="sky-card-body">
        <div className="table-responsive sky-canonical-operations-table-frame">
          <table className="table table-sm align-middle sky-table sky-canonical-operations-table mb-0">
            <tbody>
              <tr><th>Workflow ID</th><td className="sky-mono">{workflowId}</td></tr>
              <tr><th>Run ID</th><td className="sky-mono">{run?.runId || '—'}</td></tr>
              <tr><th>Status</th><td><StatusPill status={status} /></td></tr>
              <tr><th>Started</th><td>{formatDateTime(run?.startTime)}</td></tr>
              <tr><th>Completed</th><td>{formatDateTime(run?.closeTime)}</td></tr>
              <tr><th>Duration</th><td>{formatDuration(getRunDuration(run))}</td></tr>
            </tbody>
          </table>
        </div>

        {result && (
          <div className="mt-3">
            <div className="sky-page-kicker mb-2">Runner result</div>
            <pre className="sky-code-block mb-0">{JSON.stringify(result, null, 2)}</pre>
          </div>
        )}
      </div>
    </Panel>
  );
}

export function BrowserTestRun() {
  const navigate = useNavigate();
  const [catalogue, setCatalogue] = useState([]);
  const [filters, setFilters] = useState(DEFAULT_RUN_FILTERS);
  const [selectedTestCode, setSelectedTestCode] = useState('');
  const [selectedTest, setSelectedTest] = useState(null);
  const [parameterValues, setParameterValues] = useState({});
  const [environmentCode, setEnvironmentCode] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [initializing, setInitializing] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [workflowId, setWorkflowId] = useState('');
  const [run, setRun] = useState(null);

  useEffect(() => {
    let active = true;
    async function loadCatalogue() {
      setLoading(true);
      setError('');
      try {
        const result = await browserTestService.listTests({ limit: 100, offset: 0 });
        if (active) setCatalogue(result.items || []);
      } catch (loadError) {
        if (active) setError(loadError.message || 'Failed to load Browser Tests.');
      } finally {
        if (active) setLoading(false);
      }
    }
    loadCatalogue();
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!workflowId) return undefined;
    let active = true;
    let timer = null;

    async function refreshRun() {
      try {
        const result = await browserTestService.getRun(workflowId);
        if (!active) return;
        setRun(result.run || null);
        if (!TERMINAL_RUN_STATUSES.has(String(result.run?.status || '').toUpperCase())) {
          timer = window.setTimeout(refreshRun, 1000);
        }
      } catch (loadError) {
        if (active) setError(loadError.message || 'Failed to refresh Browser Test run.');
      }
    }

    refreshRun();
    return () => {
      active = false;
      if (timer) window.clearTimeout(timer);
    };
  }, [workflowId]);

  const categories = useMemo(
    () => Array.from(new Map(catalogue.map((test) => [test.category?.categoryCode, test.category])).values()).filter(Boolean),
    [catalogue],
  );
  const environments = useMemo(
    () => Array.from(new Set(catalogue.map((test) => test.defaultEnvironmentCode).filter(Boolean))).sort(),
    [catalogue],
  );
  const filteredTests = useMemo(() => {
    const q = filters.q.trim().toLowerCase();
    return catalogue.filter((test) => {
      if (filters.categoryCode && test.category?.categoryCode !== filters.categoryCode) return false;
      if (filters.environmentCode && test.defaultEnvironmentCode !== filters.environmentCode) return false;
      if (!q) return true;
      return [test.label, test.testCode, test.description, test.category?.label, test.scriptPath]
        .some((value) => String(value || '').toLowerCase().includes(q));
    });
  }, [catalogue, filters]);

  async function initializeTest(test) {
    setInitializing(true);
    setError('');
    setNotice('');
    setWorkflowId('');
    setRun(null);
    try {
      const result = await browserTestService.getTest(test.testCode);
      const detail = result.test;
      setSelectedTestCode(detail.testCode);
      setSelectedTest(detail);
      setParameterValues(getInitialParameterValues(detail));
      setEnvironmentCode(detail.defaultEnvironmentCode || detail.environments?.[0]?.environmentCode || '');
      setConfirmed(false);
    } catch (loadError) {
      setError(loadError.message || 'Failed to initialize Browser Test.');
    } finally {
      setInitializing(false);
    }
  }

  async function startTest(event) {
    event.preventDefault();
    if (!selectedTest || running) return;
    setRunning(true);
    setError('');
    setNotice('');
    setRun(null);
    try {
      const result = await browserTestService.runTest(selectedTest.testCode, {
        environmentCode,
        parameters: cleanParameterValues(parameterValues),
        confirmed: selectedTest.requiresConfirmation ? confirmed : false,
      });
      const launchedWorkflowId = result.execution?.workflowId || '';
      setWorkflowId(launchedWorkflowId);
      browserTestService.setLastRunWorkflowId(launchedWorkflowId);
      setNotice(`${selectedTest.label} was accepted by Temporal and sent to the Browser Worker.`);
    } catch (runError) {
      setError(runError.message || 'Browser Test failed to start.');
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="container-fluid px-0">
      <PageHeader
        kicker="BROWSER TESTS · EXECUTION"
        subtitle="Launch registered Playwright tests through the dedicated Temporal-backed Browser Worker."
        title="Run Tests"
      />

      {error && <DismissibleAlert tone="danger">{error}</DismissibleAlert>}
      {notice && <DismissibleAlert tone="success">{notice}</DismissibleAlert>}

      <Panel
        className="sky-table-card"
        kicker="TEST BROWSER"
        subtitle="Filter the registered Browser Test catalogue, then initialize a test to review its runtime parameters."
        title="Available Tests"
      >
        <div className="sky-card-body">
          <div className="row g-2 mb-3">
            <div className="col-12 col-xl-6">
              <label className="form-label" htmlFor="browserTestSearch">Search</label>
              <input
                className="form-control sky-form-control"
                id="browserTestSearch"
                onChange={(event) => setFilters((current) => ({ ...current, q: event.target.value }))}
                placeholder="Name, code, description, source path..."
                value={filters.q}
              />
            </div>
            <div className="col-12 col-md-5 col-xl-2">
              <label className="form-label" htmlFor="browserTestCategory">Category</label>
              <select
                className="form-select sky-form-control"
                id="browserTestCategory"
                onChange={(event) => setFilters((current) => ({ ...current, categoryCode: event.target.value }))}
                value={filters.categoryCode}
              >
                <option value="">All categories</option>
                {categories.map((category) => <option key={category.categoryCode} value={category.categoryCode}>{category.label}</option>)}
              </select>
            </div>
            <div className="col-12 col-md-5 col-xl-2">
              <label className="form-label" htmlFor="browserTestEnvironment">Environment</label>
              <select
                className="form-select sky-form-control"
                id="browserTestEnvironment"
                onChange={(event) => setFilters((current) => ({ ...current, environmentCode: event.target.value }))}
                value={filters.environmentCode}
              >
                <option value="">All environments</option>
                {environments.map((code) => <option key={code} value={code}>{code}</option>)}
              </select>
            </div>
            <div className="col-12 col-md-2 col-xl-2 d-flex align-items-end">
              <button className="btn btn-sm btn-sky w-100" onClick={() => setFilters(DEFAULT_RUN_FILTERS)} type="button">Clear filters</button>
            </div>
          </div>

          <div className="table-responsive sky-canonical-operations-table-frame">
            <table className="table table-sm align-middle sky-table sky-canonical-operations-table mb-0">
              <thead>
                <tr>
                  <th>Test</th><th>Category</th><th>Browser</th><th>Environment</th><th>Risk</th><th>Parameters</th><th>Status</th><th className="text-end">Actions</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td className="sky-muted" colSpan={8}>Loading Browser Tests...</td></tr>
                ) : filteredTests.length === 0 ? (
                  <tr><td className="sky-muted" colSpan={8}>No Browser Tests match the current filters.</td></tr>
                ) : filteredTests.map((test) => (
                  <tr className={selectedTestCode === test.testCode ? 'sky-selected-row' : ''} key={test.testId}>
                    <td><div className="fw-semibold">{test.label}</div><div className="small sky-muted sky-mono">{test.testCode}</div></td>
                    <td>{test.category?.label || '—'}</td>
                    <td className="text-uppercase">{test.browserType}</td>
                    <td>{test.defaultEnvironmentCode}</td>
                    <td><span className={`sky-pill ${riskToneClass(test.riskCode)}`}>{String(test.riskName || test.riskCode || 'LOW').toUpperCase()}</span></td>
                    <td>{test.parameterCount}</td>
                    <td><StatusPill status={test.enabled ? 'ACTIVE' : 'DISABLED'} /></td>
                    <td className="text-end"><button className="btn btn-sm btn-sky" disabled={initializing || running} onClick={() => initializeTest(test)} type="button">Initialize</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="small sky-muted mt-2">Showing {filteredTests.length} of {catalogue.length} registered test(s)</div>
        </div>
      </Panel>

      {selectedTest && (
        <Panel
          actions={<><span className="sky-pill sky-pill-info">{selectedTest.browserType?.toUpperCase()}</span><span className="sky-pill sky-pill-info">{selectedTest.defaultEnvironmentCode}</span></>}
          className="mt-3"
          kicker="TEST INITIALIZATION"
          subtitle={selectedTest.description || 'Review execution configuration and launch the selected Browser Test.'}
          title={selectedTest.label}
        >
          <form className="sky-card-body" onSubmit={startTest}>
            <div className="row g-3 mb-3">
              <div className="col-12 col-lg-4">
                <label className="form-label" htmlFor="browserTestRunEnvironment">Environment</label>
                <select className="form-select sky-form-control" disabled={running} id="browserTestRunEnvironment" onChange={(event) => setEnvironmentCode(event.target.value)} value={environmentCode}>
                  {(selectedTest.environments || []).map((environment) => <option key={environment.environmentCode} value={environment.environmentCode}>{environment.environmentName} ({environment.environmentCode})</option>)}
                </select>
              </div>
              <div className="col-12 col-lg-4">
                <label className="form-label">Timeout</label>
                <div className="form-control sky-form-control sky-readonly-field">{selectedTest.timeoutSeconds} seconds</div>
              </div>
              <div className="col-12 col-lg-4">
                <label className="form-label">Retries</label>
                <div className="form-control sky-form-control sky-readonly-field">{selectedTest.retryCount}</div>
              </div>
            </div>

            <BrowserRuntimeParameterFields
              disabled={running}
              onChange={(name, value) => setParameterValues((current) => ({ ...current, [name]: value }))}
              parameters={selectedTest.parameters || []}
              values={parameterValues}
            />

            {selectedTest.requiresConfirmation && (
              <div className="sky-confirm-panel mt-3">
                <div className="form-check">
                  <input checked={confirmed} className="form-check-input" id="browserTestRunConfirm" onChange={(event) => setConfirmed(event.target.checked)} type="checkbox" />
                  <label className="form-check-label" htmlFor="browserTestRunConfirm">{selectedTest.confirmationText || 'I confirm this Browser Test execution.'}</label>
                </div>
              </div>
            )}

            <div className="d-flex flex-wrap gap-2 mt-3">
              <button className="btn btn-sky" disabled={running || (selectedTest.requiresConfirmation && !confirmed)} type="submit">{running ? 'Starting...' : 'Run Test'}</button>
              {workflowId && <button className="btn btn-sm btn-outline-info" onClick={() => navigate(`/browser-tests/operations?workflowId=${encodeURIComponent(workflowId)}`)} type="button">Open Test Operations</button>}
            </div>
          </form>
        </Panel>
      )}

      <BrowserRunStatusPanel run={run} workflowId={workflowId} />
    </div>
  );
}

export function BrowserTestOperations() {
  const [workflowId, setWorkflowId] = useState(() => {
    const queryValue = new URLSearchParams(window.location.search).get('workflowId');
    return queryValue || browserTestService.getLastRunWorkflowId();
  });
  const [lookupValue, setLookupValue] = useState(workflowId);
  const [run, setRun] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!workflowId) return undefined;
    let active = true;
    let timer = null;

    async function loadRun() {
      setLoading(true);
      try {
        const result = await browserTestService.getRun(workflowId);
        if (!active) return;
        setRun(result.run || null);
        setError('');
        browserTestService.setLastRunWorkflowId(workflowId);
        const params = new URLSearchParams(window.location.search);
        params.set('workflowId', workflowId);
        window.history.replaceState({}, '', `${window.location.pathname}?${params.toString()}`);
        if (!TERMINAL_RUN_STATUSES.has(String(result.run?.status || '').toUpperCase())) {
          timer = window.setTimeout(loadRun, 1000);
        }
      } catch (loadError) {
        if (active) setError(loadError.message || 'Failed to load Browser Test run.');
      } finally {
        if (active) setLoading(false);
      }
    }

    loadRun();
    return () => {
      active = false;
      if (timer) window.clearTimeout(timer);
    };
  }, [workflowId]);

  function handleLookup(event) {
    event.preventDefault();
    const value = lookupValue.trim();
    setRun(null);
    setError('');
    setWorkflowId(value);
  }

  return (
    <div className="container-fluid px-0">
      <PageHeader
        kicker="BROWSER TESTS · OPERATIONS"
        subtitle="Inspect Temporal-backed Browser Test execution state directly by workflow ID."
        title="Test Operations"
      />
      {error && <DismissibleAlert tone="danger">{error}</DismissibleAlert>}

      <Panel kicker="RUN LOOKUP" subtitle="Use the latest launched execution or paste a Browser Test Temporal workflow ID." title="Execution Browser">
        <form className="sky-card-body" onSubmit={handleLookup}>
          <div className="row g-2 align-items-end">
            <div className="col-12 col-xl-10">
              <label className="form-label" htmlFor="browserTestWorkflowId">Temporal workflow ID</label>
              <input className="form-control sky-form-control sky-mono" id="browserTestWorkflowId" onChange={(event) => setLookupValue(event.target.value)} placeholder="skycommand-browser-test-..." value={lookupValue} />
            </div>
            <div className="col-12 col-xl-2"><button className="btn btn-sky w-100" disabled={loading || !lookupValue.trim()} type="submit">{loading ? 'Loading...' : 'Load Run'}</button></div>
          </div>
        </form>
      </Panel>

      {!workflowId && (
        <Panel className="mt-3" kicker="NO RUN SELECTED" subtitle="Launch a registered Browser Test from Run Tests, or enter a workflow ID above." title="Browser Test Run">
          <div className="sky-card-body small sky-muted">No Browser Test execution is selected.</div>
        </Panel>
      )}
      <BrowserRunStatusPanel run={run} workflowId={workflowId} />
    </div>
  );
}

function serializeOptions(options = []) {
  return (options || []).map((option) => `${option.label || option.value}=${option.value}`).join('\n');
}

function parseOptionText(text = '') {
  return String(text)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      const splitAt = line.indexOf('=');
      const label = splitAt >= 0 ? line.slice(0, splitAt).trim() : line;
      const value = splitAt >= 0 ? line.slice(splitAt + 1).trim() : line;
      if (!label || !value) throw new Error(`Static option line ${index + 1} requires a label and value.`);
      return { label, value, displayOrder: index * 10 + 10, enabled: true };
    });
}

function createEmptyRegistryParameter(index, options = {}) {
  return {
    parameterName: '',
    label: '',
    type: options.parameterTypes?.[0]?.code || 'string',
    prompt: '',
    required: false,
    defaultValue: '',
    optionSourceCode: '',
    displayOrder: index * 10 + 10,
    enabled: true,
    optionText: '',
  };
}

function createEmptyRegistryForm(options = {}) {
  const defaultEnvironment = options.environments?.find((environment) => environment.environmentCode === 'LOCAL') || options.environments?.[0];
  return {
    testCode: '',
    categoryId: options.categories?.[0]?.categoryId || '',
    name: '',
    label: '',
    description: '',
    scriptRepoId: options.repositories?.find((repository) => repository.repoCode === 'SkyCommand')?.repoId || options.repositories?.[0]?.repoId || '',
    scriptPath: 'tests/browser/specs/',
    browserType: options.browserTypes?.[0] || 'chromium',
    defaultEnvironmentCode: defaultEnvironment?.environmentCode || 'LOCAL',
    environmentCodes: defaultEnvironment ? [defaultEnvironment.environmentCode] : [],
    timeoutSeconds: 60,
    retryCount: 0,
    grepPattern: '',
    permissionCode: 'BROWSER_TEST_RUN',
    riskCode: options.risks?.[0]?.riskCode || 'low',
    requiresConfirmation: false,
    confirmationText: '',
    displayOrder: 999,
    enabled: false,
    parameters: [],
  };
}

function populateRegistryForm(test, options = {}) {
  if (!test) return createEmptyRegistryForm(options);
  return {
    testCode: test.testCode || '',
    categoryId: test.category?.categoryId || '',
    name: test.name || '',
    label: test.label || '',
    description: test.description || '',
    scriptRepoId: test.scriptRepository?.repoId || '',
    scriptPath: test.scriptPath || '',
    browserType: test.browserType || 'chromium',
    defaultEnvironmentCode: test.defaultEnvironmentCode || 'LOCAL',
    environmentCodes: (test.environments || []).map((environment) => environment.environmentCode),
    timeoutSeconds: test.timeoutSeconds ?? 60,
    retryCount: test.retryCount ?? 0,
    grepPattern: test.grepPattern || '',
    permissionCode: test.permissionCode || 'BROWSER_TEST_RUN',
    riskCode: test.riskCode || 'low',
    requiresConfirmation: Boolean(test.requiresConfirmation),
    confirmationText: test.confirmationText || '',
    displayOrder: test.displayOrder ?? 999,
    enabled: Boolean(test.enabled),
    parameters: (test.parameters || []).map((parameter) => ({
      parameterName: parameter.parameterName || '',
      label: parameter.label || '',
      type: parameter.type || 'string',
      prompt: parameter.prompt || '',
      required: Boolean(parameter.required),
      defaultValue: parameter.defaultValue === null || parameter.defaultValue === undefined
        ? ''
        : parameter.type === 'json' && typeof parameter.defaultValue !== 'string'
          ? JSON.stringify(parameter.defaultValue, null, 2)
          : parameter.defaultValue,
      optionSourceCode: parameter.optionSourceCode || '',
      displayOrder: parameter.displayOrder ?? 999,
      enabled: parameter.enabled !== false,
      optionText: serializeOptions(parameter.options || []),
    })),
  };
}

function buildRegistryPayload(form) {
  const parameters = form.parameters.map((parameter) => ({
    parameterName: parameter.parameterName.trim(),
    label: parameter.label.trim() || parameter.parameterName.trim(),
    type: parameter.type,
    prompt: parameter.prompt.trim() || null,
    required: Boolean(parameter.required),
    defaultValue: parameter.defaultValue === '' ? null : parameter.defaultValue,
    optionSourceCode: parameter.optionSourceCode || null,
    displayOrder: Number(parameter.displayOrder),
    enabled: Boolean(parameter.enabled),
    options: parameter.optionSourceCode ? [] : parseOptionText(parameter.optionText),
  }));
  return {
    testCode: form.testCode.trim(),
    categoryId: form.categoryId,
    name: form.name.trim(),
    label: form.label.trim(),
    description: form.description.trim() || null,
    scriptRepoId: form.scriptRepoId,
    scriptPath: form.scriptPath.trim(),
    browserType: form.browserType,
    defaultEnvironmentCode: form.defaultEnvironmentCode,
    environmentCodes: form.environmentCodes,
    timeoutSeconds: Number(form.timeoutSeconds),
    retryCount: Number(form.retryCount),
    grepPattern: form.grepPattern.trim() || null,
    permissionCode: form.permissionCode || null,
    riskCode: form.riskCode,
    requiresConfirmation: Boolean(form.requiresConfirmation),
    confirmationText: form.requiresConfirmation ? form.confirmationText.trim() || null : null,
    displayOrder: Number(form.displayOrder),
    enabled: Boolean(form.enabled),
    parameters,
  };
}

function BrowserTestRegistryForm({ canEditCode = true, form, onChange, options, saving = false, submitLabel = 'Save Browser Test', onSubmit }) {
  function update(field, value) {
    onChange((current) => ({ ...current, [field]: value }));
  }

  function updateParameter(index, field, value) {
    onChange((current) => ({
      ...current,
      parameters: current.parameters.map((parameter, parameterIndex) => parameterIndex === index ? { ...parameter, [field]: value } : parameter),
    }));
  }

  function toggleEnvironment(code) {
    onChange((current) => {
      const currentCodes = new Set(current.environmentCodes || []);
      if (currentCodes.has(code)) currentCodes.delete(code); else currentCodes.add(code);
      currentCodes.add(current.defaultEnvironmentCode);
      return { ...current, environmentCodes: [...currentCodes] };
    });
  }

  function setDefaultEnvironment(code) {
    onChange((current) => ({
      ...current,
      defaultEnvironmentCode: code,
      environmentCodes: [...new Set([...(current.environmentCodes || []), code])],
    }));
  }

  return (
    <form className="sky-card-body" onSubmit={onSubmit}>
      <div className="row g-3">
        <div className="col-12 col-lg-4"><label className="form-label" htmlFor="browserRegistryCode">Test code *</label><input className="form-control sky-form-control sky-mono" disabled={!canEditCode} id="browserRegistryCode" onChange={(event) => update('testCode', event.target.value)} required value={form.testCode} /></div>
        <div className="col-12 col-lg-4"><label className="form-label" htmlFor="browserRegistryName">Name *</label><input className="form-control sky-form-control" id="browserRegistryName" onChange={(event) => update('name', event.target.value)} required value={form.name} /></div>
        <div className="col-12 col-lg-4"><label className="form-label" htmlFor="browserRegistryLabel">Display label *</label><input className="form-control sky-form-control" id="browserRegistryLabel" onChange={(event) => update('label', event.target.value)} required value={form.label} /></div>
        <div className="col-12"><label className="form-label" htmlFor="browserRegistryDescription">Description</label><textarea className="form-control sky-form-control" id="browserRegistryDescription" onChange={(event) => update('description', event.target.value)} rows={2} value={form.description} /></div>
        <div className="col-12 col-lg-4"><label className="form-label" htmlFor="browserRegistryCategory">Category *</label><select className="form-select sky-form-control" id="browserRegistryCategory" onChange={(event) => update('categoryId', event.target.value)} required value={form.categoryId}>{(options.categories || []).map((category) => <option key={category.categoryId} value={category.categoryId}>{category.label}</option>)}</select></div>
        <div className="col-12 col-lg-4"><label className="form-label" htmlFor="browserRegistryRepository">Script repository *</label><select className="form-select sky-form-control" id="browserRegistryRepository" onChange={(event) => update('scriptRepoId', event.target.value)} required value={form.scriptRepoId}>{(options.repositories || []).filter((repository) => repository.active !== false && repository.repoCode === 'SkyCommand').map((repository) => <option key={repository.repoId} value={repository.repoId}>{repository.repoName} ({repository.repoCode})</option>)}</select></div>
        <div className="col-12 col-lg-4"><label className="form-label" htmlFor="browserRegistryBrowser">Browser *</label><select className="form-select sky-form-control" id="browserRegistryBrowser" onChange={(event) => update('browserType', event.target.value)} value={form.browserType}>{(options.browserTypes || ['chromium']).map((browser) => <option key={browser} value={browser}>{browser}</option>)}</select></div>
        <div className="col-12"><label className="form-label" htmlFor="browserRegistryScriptPath">Repository-relative spec path *</label><input className="form-control sky-form-control sky-mono" id="browserRegistryScriptPath" onChange={(event) => update('scriptPath', event.target.value)} required value={form.scriptPath} /><div className="form-text sky-muted">Playwright source remains in Git and must live beneath tests/browser/specs/.</div></div>
        <div className="col-12 col-md-4 col-xl-2"><label className="form-label" htmlFor="browserRegistryTimeout">Timeout (sec)</label><input className="form-control sky-form-control" id="browserRegistryTimeout" min="1" max="3600" onChange={(event) => update('timeoutSeconds', event.target.value)} type="number" value={form.timeoutSeconds} /></div>
        <div className="col-12 col-md-4 col-xl-2"><label className="form-label" htmlFor="browserRegistryRetries">Retries</label><input className="form-control sky-form-control" id="browserRegistryRetries" min="0" max="3" onChange={(event) => update('retryCount', event.target.value)} type="number" value={form.retryCount} /></div>
        <div className="col-12 col-md-4 col-xl-2"><label className="form-label" htmlFor="browserRegistryOrder">Display order</label><input className="form-control sky-form-control" id="browserRegistryOrder" min="0" onChange={(event) => update('displayOrder', event.target.value)} type="number" value={form.displayOrder} /></div>
        <div className="col-12 col-xl-3"><label className="form-label" htmlFor="browserRegistryRisk">Risk</label><select className="form-select sky-form-control" id="browserRegistryRisk" onChange={(event) => update('riskCode', event.target.value)} value={form.riskCode}>{(options.risks || []).filter((risk) => risk.active !== false).map((risk) => <option key={risk.riskCode} value={risk.riskCode}>{risk.riskName}</option>)}</select></div>
        <div className="col-12 col-xl-3"><label className="form-label" htmlFor="browserRegistryPermission">Execution permission</label><select className="form-select sky-form-control" id="browserRegistryPermission" onChange={(event) => update('permissionCode', event.target.value)} value={form.permissionCode}><option value="">BROWSER_TEST_RUN only</option>{(options.permissions || []).map((permission) => <option key={permission.permissionCode} value={permission.permissionCode}>{permission.permissionCode}</option>)}</select></div>
        <div className="col-12 col-lg-6"><label className="form-label" htmlFor="browserRegistryGrep">Playwright grep / tag</label><input className="form-control sky-form-control sky-mono" id="browserRegistryGrep" onChange={(event) => update('grepPattern', event.target.value)} placeholder="@smoke" value={form.grepPattern} /></div>
        <div className="col-12 col-lg-6"><label className="form-label" htmlFor="browserRegistryDefaultEnvironment">Default environment</label><select className="form-select sky-form-control" id="browserRegistryDefaultEnvironment" onChange={(event) => setDefaultEnvironment(event.target.value)} value={form.defaultEnvironmentCode}>{(options.environments || []).filter((environment) => environment.enabled !== false).map((environment) => <option key={environment.environmentCode} value={environment.environmentCode}>{environment.environmentName} ({environment.environmentCode})</option>)}</select></div>
      </div>

      <div className="mt-3">
        <div className="form-label">Allowed environments</div>
        <div className="d-flex flex-wrap gap-3">
          {(options.environments || []).filter((environment) => environment.enabled !== false).map((environment) => (
            <div className="form-check" key={environment.environmentCode}>
              <input checked={(form.environmentCodes || []).includes(environment.environmentCode)} className="form-check-input" disabled={environment.environmentCode === form.defaultEnvironmentCode} id={`browser-env-${environment.environmentCode}`} onChange={() => toggleEnvironment(environment.environmentCode)} type="checkbox" />
              <label className="form-check-label" htmlFor={`browser-env-${environment.environmentCode}`}>{environment.environmentName}</label>
            </div>
          ))}
        </div>
      </div>

      <div className="d-flex flex-wrap gap-4 mt-3">
        <div className="form-check form-switch"><input checked={form.requiresConfirmation} className="form-check-input" id="browserRegistryConfirmation" onChange={(event) => update('requiresConfirmation', event.target.checked)} type="checkbox" /><label className="form-check-label" htmlFor="browserRegistryConfirmation">Confirmation required</label></div>
        <div className="form-check form-switch"><input checked={form.enabled} className="form-check-input" id="browserRegistryEnabled" onChange={(event) => update('enabled', event.target.checked)} type="checkbox" /><label className="form-check-label" htmlFor="browserRegistryEnabled">Enabled</label></div>
      </div>
      {form.requiresConfirmation && <div className="mt-3"><label className="form-label" htmlFor="browserRegistryConfirmationText">Confirmation text *</label><input className="form-control sky-form-control" id="browserRegistryConfirmationText" onChange={(event) => update('confirmationText', event.target.value)} required value={form.confirmationText} /></div>}

      <div className="d-flex justify-content-between align-items-center gap-2 mt-4 mb-2">
        <div><div className="sky-page-kicker">RUNTIME PARAMETERS</div><div className="small sky-muted">Parameterized values are validated by the registry before Temporal execution.</div></div>
        <button className="btn btn-sm btn-sky" onClick={() => onChange((current) => ({ ...current, parameters: [...current.parameters, createEmptyRegistryParameter(current.parameters.length, options)] }))} type="button">Add parameter</button>
      </div>

      {(form.parameters || []).length === 0 ? <div className="small sky-muted">No Browser Test parameters configured.</div> : (
        <div className="d-grid gap-3">
          {form.parameters.map((parameter, index) => (
            <section className="sky-tool-parameter-editor" key={`${parameter.parameterName || 'new'}-${index}`}>
              <div className="d-flex justify-content-between align-items-center gap-2 mb-3"><strong>Parameter {index + 1}</strong><button className="btn btn-sm btn-outline-danger" onClick={() => onChange((current) => ({ ...current, parameters: current.parameters.filter((_, parameterIndex) => parameterIndex !== index) }))} type="button">Remove</button></div>
              <div className="row g-3">
                <div className="col-12 col-lg-3"><label className="form-label">Name *</label><input className="form-control sky-form-control sky-mono" onChange={(event) => updateParameter(index, 'parameterName', event.target.value)} required value={parameter.parameterName} /></div>
                <div className="col-12 col-lg-3"><label className="form-label">Label *</label><input className="form-control sky-form-control" onChange={(event) => updateParameter(index, 'label', event.target.value)} required value={parameter.label} /></div>
                <div className="col-12 col-lg-3"><label className="form-label">Type</label><select className="form-select sky-form-control" onChange={(event) => updateParameter(index, 'type', event.target.value)} value={parameter.type}>{(options.parameterTypes || []).filter((type) => type.active !== false).map((type) => <option key={type.code} value={type.code}>{type.name}</option>)}</select></div>
                <div className="col-12 col-lg-3"><label className="form-label">Display order</label><input className="form-control sky-form-control" min="0" onChange={(event) => updateParameter(index, 'displayOrder', event.target.value)} type="number" value={parameter.displayOrder} /></div>
                <div className="col-12 col-lg-6"><label className="form-label">Prompt / help text</label><input className="form-control sky-form-control" onChange={(event) => updateParameter(index, 'prompt', event.target.value)} value={parameter.prompt} /></div>
                <div className="col-12 col-lg-6"><label className="form-label">Default value</label>{parameter.type === 'json' ? <textarea className="form-control sky-form-control sky-mono" onChange={(event) => updateParameter(index, 'defaultValue', event.target.value)} rows={3} value={parameter.defaultValue} /> : <input className="form-control sky-form-control" onChange={(event) => updateParameter(index, 'defaultValue', event.target.value)} value={parameter.defaultValue} />}</div>
                <div className="col-12 col-lg-4"><label className="form-label">Dynamic option source</label><select className="form-select sky-form-control" onChange={(event) => updateParameter(index, 'optionSourceCode', event.target.value)} value={parameter.optionSourceCode}><option value="">None</option>{(options.optionSources || []).filter((source) => source.active !== false).map((source) => <option key={source.code} value={source.code}>{source.name}</option>)}</select></div>
                <div className="col-12 col-lg-8"><label className="form-label">Static choices (one Label=Value per line)</label><textarea className="form-control sky-form-control sky-mono" disabled={Boolean(parameter.optionSourceCode)} onChange={(event) => updateParameter(index, 'optionText', event.target.value)} rows={3} value={parameter.optionText} /></div>
              </div>
              <div className="d-flex flex-wrap gap-4 mt-3"><div className="form-check form-switch"><input checked={parameter.required} className="form-check-input" id={`browser-param-required-${index}`} onChange={(event) => updateParameter(index, 'required', event.target.checked)} type="checkbox" /><label className="form-check-label" htmlFor={`browser-param-required-${index}`}>Required</label></div><div className="form-check form-switch"><input checked={parameter.enabled} className="form-check-input" id={`browser-param-enabled-${index}`} onChange={(event) => updateParameter(index, 'enabled', event.target.checked)} type="checkbox" /><label className="form-check-label" htmlFor={`browser-param-enabled-${index}`}>Enabled</label></div></div>
            </section>
          ))}
        </div>
      )}

      <div className="mt-4"><button className="btn btn-sky" disabled={saving} type="submit">{saving ? 'Saving...' : submitLabel}</button></div>
    </form>
  );
}

export function BrowserTestManage() {
  const [options, setOptions] = useState(null);
  const [tests, setTests] = useState([]);
  const [filters, setFilters] = useState(DEFAULT_MANAGE_FILTERS);
  const [selectedTestId, setSelectedTestId] = useState('');
  const [form, setForm] = useState(null);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const editorRef = useRef(null);

  async function refreshList(nextFilters = filters) {
    const result = await browserTestService.listAdminTests({ ...nextFilters, limit: 100, offset: 0 });
    setTests(result.items || []);
  }

  useEffect(() => {
    let active = true;
    async function load() {
      setLoading(true);
      try {
        const [optionsResult, testsResult] = await Promise.all([
          browserTestService.getAdminOptions(),
          browserTestService.listAdminTests({ limit: 100, offset: 0 }),
        ]);
        if (!active) return;
        setOptions(optionsResult.options || {});
        setTests(testsResult.items || []);
      } catch (loadError) {
        if (active) setError(loadError.message || 'Failed to load Browser Test administration.');
      } finally {
        if (active) setLoading(false);
      }
    }
    load();
    return () => { active = false; };
  }, []);

  const filteredTests = useMemo(() => {
    const q = filters.q.trim().toLowerCase();
    return tests.filter((test) => {
      if (filters.categoryCode && test.category?.categoryCode !== filters.categoryCode) return false;
      if (filters.enabled !== '' && String(Boolean(test.enabled)) !== filters.enabled) return false;
      if (!q) return true;
      return [test.label, test.testCode, test.description, test.scriptPath].some((value) => String(value || '').toLowerCase().includes(q));
    });
  }, [tests, filters]);

  async function selectTest(test) {
    setSelectedTestId(test.testId);
    setDetailLoading(true);
    setError('');
    setNotice('');
    try {
      const result = await browserTestService.getAdminTest(test.testId);
      setForm(populateRegistryForm(result.test, options || {}));
      window.requestAnimationFrame(() => editorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
    } catch (loadError) {
      setError(loadError.message || 'Failed to load Browser Test configuration.');
    } finally {
      setDetailLoading(false);
    }
  }

  async function saveTest(event) {
    event.preventDefault();
    if (!selectedTestId || !form) return;
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const payload = buildRegistryPayload(form);
      const { environmentCodes, parameters, testCode, ...definition } = payload;
      await browserTestService.updateAdminTest(selectedTestId, definition);
      await browserTestService.replaceAdminTestParameters(selectedTestId, parameters);
      await browserTestService.replaceAdminTestEnvironments(selectedTestId, environmentCodes);
      const detail = await browserTestService.getAdminTest(selectedTestId);
      setForm(populateRegistryForm(detail.test, options || {}));
      await refreshList();
      setNotice(`${detail.test.label} configuration saved.`);
    } catch (saveError) {
      setError(saveError.message || 'Failed to save Browser Test configuration.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="container-fluid px-0">
      <PageHeader kicker="BROWSER TESTS · ADMINISTRATION" subtitle="Review and maintain registered source-controlled Playwright tests." title="Manage Tests" />
      {error && <DismissibleAlert tone="danger">{error}</DismissibleAlert>}
      {notice && <DismissibleAlert tone="success">{notice}</DismissibleAlert>}

      <Panel className="sky-table-card" kicker="TEST REGISTRY" subtitle="Select a test to edit its registry metadata, environments, permissions, and runtime parameters." title="Registered Tests">
        <div className="sky-card-body">
          <div className="row g-2 mb-3">
            <div className="col-12 col-xl-6"><label className="form-label" htmlFor="manageBrowserTestSearch">Search</label><input className="form-control sky-form-control" id="manageBrowserTestSearch" onChange={(event) => setFilters((current) => ({ ...current, q: event.target.value }))} placeholder="Name, code, source path..." value={filters.q} /></div>
            <div className="col-12 col-md-5 col-xl-2"><label className="form-label" htmlFor="manageBrowserTestCategory">Category</label><select className="form-select sky-form-control" id="manageBrowserTestCategory" onChange={(event) => setFilters((current) => ({ ...current, categoryCode: event.target.value }))} value={filters.categoryCode}><option value="">All categories</option>{(options?.categories || []).map((category) => <option key={category.categoryId} value={category.categoryCode}>{category.label}</option>)}</select></div>
            <div className="col-12 col-md-5 col-xl-2"><label className="form-label" htmlFor="manageBrowserTestStatus">Status</label><select className="form-select sky-form-control" id="manageBrowserTestStatus" onChange={(event) => setFilters((current) => ({ ...current, enabled: event.target.value }))} value={filters.enabled}><option value="">All statuses</option><option value="true">Active</option><option value="false">Disabled</option></select></div>
            <div className="col-12 col-md-2 col-xl-2 d-flex align-items-end"><button className="btn btn-sm btn-sky w-100" onClick={() => setFilters(DEFAULT_MANAGE_FILTERS)} type="button">Clear filters</button></div>
          </div>
          <div className="table-responsive sky-canonical-operations-table-frame">
            <table className="table table-sm align-middle sky-table sky-canonical-operations-table mb-0">
              <thead><tr><th>Test</th><th>Category</th><th>Source</th><th>Environment</th><th>Risk</th><th>Parameters</th><th>Status</th><th className="text-end">Actions</th></tr></thead>
              <tbody>{loading ? <tr><td className="sky-muted" colSpan={8}>Loading registered tests...</td></tr> : filteredTests.length === 0 ? <tr><td className="sky-muted" colSpan={8}>No registered tests match the current filters.</td></tr> : filteredTests.map((test) => <tr className={selectedTestId === test.testId ? 'sky-selected-row' : ''} key={test.testId}><td><div className="fw-semibold">{test.label}</div><div className="small sky-muted sky-mono">{test.testCode}</div></td><td>{test.category?.label}</td><td><div>{test.scriptRepository?.repoName}</div><div className="small sky-muted sky-mono">{test.scriptPath}</div></td><td>{test.defaultEnvironmentCode}</td><td><span className={`sky-pill ${riskToneClass(test.riskCode)}`}>{String(test.riskName || test.riskCode).toUpperCase()}</span></td><td>{test.parameterCount}</td><td><StatusPill status={test.enabled ? 'ACTIVE' : 'DISABLED'} /></td><td className="text-end"><button className="btn btn-sm btn-sky" disabled={detailLoading} onClick={() => selectTest(test)} type="button">Configure</button></td></tr>)}</tbody>
            </table>
          </div>
          <div className="small sky-muted mt-2">Showing {filteredTests.length} of {tests.length} registered test(s)</div>
        </div>
      </Panel>

      <div ref={editorRef}>
        {form && options && (
          <Panel actions={<StatusPill status={form.enabled ? 'ACTIVE' : 'DISABLED'} />} className="mt-3" kicker="TEST CONFIGURATION" subtitle="Test code is immutable here to protect registered references. Source remains version-controlled in Git." title={form.label || form.testCode}>
            <BrowserTestRegistryForm canEditCode={false} form={form} onChange={setForm} onSubmit={saveTest} options={options} saving={saving} submitLabel="Save configuration" />
          </Panel>
        )}
      </div>
    </div>
  );
}

export function BrowserTestAdd() {
  const navigate = useNavigate();
  const [options, setOptions] = useState(null);
  const [form, setForm] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    async function load() {
      setLoading(true);
      try {
        const result = await browserTestService.getAdminOptions();
        if (!active) return;
        const loadedOptions = result.options || {};
        setOptions(loadedOptions);
        setForm(createEmptyRegistryForm(loadedOptions));
      } catch (loadError) {
        if (active) setError(loadError.message || 'Failed to load Browser Test registration options.');
      } finally {
        if (active) setLoading(false);
      }
    }
    load();
    return () => { active = false; };
  }, []);

  async function createTest(event) {
    event.preventDefault();
    if (!form) return;
    setSaving(true);
    setError('');
    try {
      const payload = buildRegistryPayload(form);
      const result = await browserTestService.createAdminTest(payload);
      navigate('/browser-tests/manage', { replace: true, state: { createdTestId: result.test?.testId } });
    } catch (createError) {
      setError(createError.message || 'Failed to register Browser Test.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="container-fluid px-0">
      <PageHeader kicker="BROWSER TESTS · REGISTRATION" subtitle="Register a source-controlled Playwright spec with SkyCommand execution metadata, permissions, environments, and parameters." title="Add Test" />
      {error && <DismissibleAlert tone="danger">{error}</DismissibleAlert>}
      {loading && <Panel kicker="LOADING" title="Browser Test Registration"><div className="sky-card-body sky-muted">Loading registry options...</div></Panel>}
      {form && options && <Panel kicker="NEW BROWSER TEST" subtitle="The Playwright source file must already exist in the selected repository." title="Test Registration"><BrowserTestRegistryForm form={form} onChange={setForm} onSubmit={createTest} options={options} saving={saving} submitLabel="Register Browser Test" /></Panel>}
    </div>
  );
}

export default BrowserTestRun;
