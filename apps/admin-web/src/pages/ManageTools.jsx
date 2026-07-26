import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import Panel from '../components/ui/Panel.jsx';
import StatusPill from '../components/ui/StatusPill.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import adminService from '../services/adminService.js';

const MANAGE_TOOLS_PAGE_SIZE = 10;

const DEFAULT_FILTERS = {
  q: '',
  categoryCode: '',
  runtimeCode: '',
  riskCode: '',
  enabled: '',
};

function createEmptyToolForm(options = {}) {
  return {
    toolCode: '',
    name: '',
    label: '',
    description: '',
    categoryId: options.categories?.[0]?.categoryId || '',
    scriptRepoId: options.repositories?.[0]?.repoId || '',
    scriptPath: '',
    runtimeCode: options.runtimes?.[0]?.runtimeCode || 'node',
    permissionCode: '',
    riskCode: options.risks?.[0]?.riskCode || 'low',
    requiresConfirmation: false,
    confirmationText: '',
    capturesOutput: true,
    allowParams: false,
    displayOrder: 999,
    enabled: false,
    outputType: '',
    outputSchemaPath: '',
    visibility: options.visibilityChannels?.map((channel) => channel.channelCode) || [],
    parameters: [],
  };
}

function createEmptyParameter(index, options = {}) {
  return {
    parameterName: '',
    label: '',
    paramTypeCode: options.paramTypes?.[0]?.paramTypeCode || 'string',
    prompt: '',
    required: false,
    defaultValue: '',
    optionSourceCode: '',
    displayOrder: index + 1,
    enabled: true,
    optionText: '',
  };
}

function serializeOptions(options = []) {
  return options.map((option) => `${option.label || option.value}=${option.value}`).join('\n');
}

function parseOptions(text = '') {
  return String(text)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      const separatorIndex = line.indexOf('=');
      const label = separatorIndex >= 0 ? line.slice(0, separatorIndex).trim() : line;
      const value = separatorIndex >= 0 ? line.slice(separatorIndex + 1).trim() : line;

      if (!label || !value) {
        throw new Error(`Static option line ${index + 1} must contain a label and value.`);
      }

      return {
        label,
        value,
        displayOrder: index + 1,
        enabled: true,
      };
    });
}

function populateToolForm(tool, options = {}) {
  if (!tool) {
    return createEmptyToolForm(options);
  }

  return {
    toolCode: tool.toolCode || '',
    name: tool.name || '',
    label: tool.label || '',
    description: tool.description || '',
    categoryId: tool.categoryId || '',
    scriptRepoId: tool.scriptRepoId || '',
    scriptPath: tool.scriptPath || '',
    runtimeCode: tool.runtimeCode || 'node',
    permissionCode: tool.permissionCode || '',
    riskCode: tool.riskCode || 'low',
    requiresConfirmation: Boolean(tool.requiresConfirmation),
    confirmationText: tool.confirmationText || '',
    capturesOutput: tool.capturesOutput !== false,
    allowParams: Boolean(tool.allowParams),
    displayOrder: tool.displayOrder ?? 999,
    enabled: Boolean(tool.enabled),
    outputType: tool.outputType || '',
    outputSchemaPath: tool.outputSchemaPath || '',
    visibility: tool.visibility || [],
    parameters: (tool.parameters || []).map((parameter) => ({
      parameterName: parameter.parameterName || '',
      label: parameter.label || '',
      paramTypeCode: parameter.paramTypeCode || 'string',
      prompt: parameter.prompt || '',
      required: Boolean(parameter.required),
      defaultValue: parameter.defaultValue ?? '',
      optionSourceCode: parameter.optionSourceCode || '',
      displayOrder: parameter.displayOrder ?? 999,
      enabled: parameter.enabled !== false,
      optionText: serializeOptions(parameter.options),
    })),
  };
}

function buildToolPayload(form) {
  const parameters = form.parameters.map((parameter) => ({
    parameterName: parameter.parameterName.trim(),
    label: parameter.label.trim() || parameter.parameterName.trim(),
    paramTypeCode: parameter.paramTypeCode,
    prompt: parameter.prompt.trim() || null,
    required: Boolean(parameter.required),
    defaultValue: parameter.defaultValue === '' ? null : String(parameter.defaultValue),
    optionSourceCode: parameter.optionSourceCode || null,
    displayOrder: Number(parameter.displayOrder),
    enabled: Boolean(parameter.enabled),
    options: parameter.optionSourceCode ? [] : parseOptions(parameter.optionText),
  }));

  return {
    toolCode: form.toolCode.trim(),
    name: form.name.trim(),
    label: form.label.trim(),
    description: form.description.trim() || null,
    categoryId: form.categoryId,
    scriptRepoId: form.scriptRepoId,
    scriptPath: form.scriptPath.trim(),
    runtimeCode: form.runtimeCode,
    permissionCode: form.permissionCode || null,
    riskCode: form.riskCode,
    requiresConfirmation: Boolean(form.requiresConfirmation),
    confirmationText: form.requiresConfirmation ? form.confirmationText.trim() || null : null,
    capturesOutput: Boolean(form.capturesOutput),
    allowParams: parameters.some((parameter) => parameter.enabled),
    displayOrder: Number(form.displayOrder),
    enabled: Boolean(form.enabled),
    outputType: form.outputType.trim() || null,
    outputSchemaPath: form.outputSchemaPath.trim() || null,
    visibility: form.visibility,
    parameters,
  };
}

function ManagedToolVerificationPanel({ canWrite, onToolUpdated, tool }) {
  const [verification, setVerification] = useState(null);
  const [parameterValues, setParameterValues] = useState({});
  const [confirmed, setConfirmed] = useState(false);
  const [confirmationPhrase, setConfirmationPhrase] = useState('');
  const [contractResult, setContractResult] = useState(null);
  const [testResult, setTestResult] = useState(null);
  const [loading, setLoading] = useState(true);
  const [contractChecking, setContractChecking] = useState(false);
  const [testRunning, setTestRunning] = useState(false);
  const [statusUpdating, setStatusUpdating] = useState(false);
  const [error, setError] = useState('');

  async function loadVerification() {
    if (!tool?.toolId) return;
    setLoading(true);
    setError('');

    try {
      const result = await adminService.getManagedToolVerification(tool.toolId);
      setVerification(result.verification || null);
      setParameterValues(result.verification?.parameterTemplate || {});
    } catch (loadError) {
      setError(loadError.message || 'Failed to load managed-tool verification state.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    setContractResult(null);
    setTestResult(null);
    setConfirmed(false);
    setConfirmationPhrase('');
    loadVerification();
  }, [tool?.toolId]);

  function updateParameterValue(parameterName, value) {
    setParameterValues((current) => ({ ...current, [parameterName]: value }));
  }

  async function runContractCheck() {
    setContractChecking(true);
    setError('');
    setContractResult(null);

    try {
      const result = await adminService.checkManagedToolContract(tool.toolId);
      setContractResult(result.contractCheck || null);
    } catch (checkError) {
      setError(checkError.message || 'Managed-tool contract check failed.');
    } finally {
      setContractChecking(false);
    }
  }

  async function runControlledTest() {
    setTestRunning(true);
    setError('');
    setTestResult(null);

    try {
      const result = await adminService.runManagedToolControlledTest(tool.toolId, {
        parameters: parameterValues,
        confirmed,
        confirmationPhrase,
      });
      setTestResult(result.controlledTest || null);
      await loadVerification();
    } catch (testError) {
      setError(testError.message || 'Controlled managed-tool test failed.');
    } finally {
      setTestRunning(false);
    }
  }

  async function toggleEnabledState() {
    setStatusUpdating(true);
    setError('');

    try {
      const result = await adminService.updateAdminToolStatus(tool.toolId, {
        enabled: !tool.enabled,
      });
      await onToolUpdated?.(result.tool);
      await loadVerification();
    } catch (statusError) {
      setError(statusError.message || 'Failed to update managed-tool status.');
    } finally {
      setStatusUpdating(false);
    }
  }

  const parameters = (tool.parameters || [])
    .filter((parameter) => parameter.enabled !== false)
    .sort((left, right) => left.displayOrder - right.displayOrder);

  return (
    <Panel
      actions={
        <button
          className="btn btn-sm sky-btn-ghost"
          disabled={loading}
          onClick={loadVerification}
          type="button"
        >
          {loading ? 'Refreshing…' : 'Refresh verification'}
        </button>
      }
      className="mt-3"
      subtitle="Contract inspection and controlled execution are deliberate administrator tools. They never become hash gates, automatic enablement requirements, or hidden runtime authorities."
      title="Managed tool verification"
    >
      <div className="sky-card-body">
        {error && <div className="alert alert-danger">{error}</div>}
        {loading && !verification ? (
          <div className="sky-muted">Loading managed-tool verification…</div>
        ) : (
          <>
            <div className="d-flex flex-wrap align-items-center gap-2 mb-3">
              <StatusPill status={verification?.status || 'UNKNOWN'} />
              <span>{verification?.message}</span>
            </div>

            <div className="alert alert-info">
              <strong>Accessibility boundary:</strong> checks are advisory. PostgreSQL enabled
              state, permissions, risk, confirmation, and visibility remain the only normal
              execution controls. Registration hashes are never checked when this tool runs.
            </div>

            <div className="table-responsive mb-4">
              <table className="table table-sm align-middle">
                <thead>
                  <tr>
                    <th>Check</th>
                    <th>Status</th>
                    <th>Evidence</th>
                  </tr>
                </thead>
                <tbody>
                  {(verification?.checks || []).map((check) => (
                    <tr key={check.code}>
                      <td>{check.label}</td>
                      <td>
                        <StatusPill status={check.status} />
                      </td>
                      <td>{check.message || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="row g-3">
              <div className="col-xl-5">
                <section className="sky-tool-parameter-editor h-100">
                  <div className="d-flex flex-wrap align-items-center justify-content-between gap-2 mb-3">
                    <div>
                      <h3 className="h6 mb-1">Non-destructive contract check</h3>
                      <div className="small sky-muted">
                        Builds a representative ToolResult from the configured output contract
                        without importing or executing the tool script.
                      </div>
                    </div>
                    <button
                      className="btn btn-sm sky-btn-primary"
                      disabled={!canWrite || contractChecking || !verification?.canContractCheck}
                      onClick={runContractCheck}
                      type="button"
                    >
                      {contractChecking ? 'Checking…' : 'Run contract check'}
                    </button>
                  </div>

                  {!verification?.canContractCheck && (
                    <div className="small sky-muted">
                      No structured output type is configured. This does not prevent normal
                      execution.
                    </div>
                  )}

                  {contractResult && (
                    <div className="mt-3">
                      <div className="d-flex align-items-center gap-2 mb-2">
                        <StatusPill status={contractResult.status} />
                        <span>{contractResult.message}</span>
                      </div>
                      {contractResult.sampleOutput !== null && (
                        <pre className="sky-code-block mb-0">
                          {JSON.stringify(contractResult.sampleOutput, null, 2)}
                        </pre>
                      )}
                    </div>
                  )}
                </section>
              </div>

              <div className="col-xl-7">
                <section className="sky-tool-parameter-editor h-100">
                  <div className="d-flex flex-wrap align-items-center justify-content-between gap-2 mb-3">
                    <div>
                      <h3 className="h6 mb-1">Controlled test execution</h3>
                      <div className="small sky-muted">
                        Runs the registered script through the normal process adapter and Tool
                        History, even while the managed catalogue record is disabled. Enabled state
                        is unchanged.
                      </div>
                    </div>
                    <button
                      className="btn btn-sm sky-btn-primary"
                      disabled={!canWrite || testRunning || !verification?.canRunControlledTest}
                      onClick={runControlledTest}
                      type="button"
                    >
                      {testRunning ? 'Running…' : 'Run controlled test'}
                    </button>
                  </div>

                  {parameters.length === 0 ? (
                    <div className="small sky-muted mb-3">This tool has no enabled parameters.</div>
                  ) : (
                    <div className="row g-3 mb-3">
                      {parameters.map((parameter) => (
                        <div
                          className="col-md-6"
                          key={parameter.parameterId || parameter.parameterName}
                        >
                          <label
                            className="form-label sky-form-label"
                            htmlFor={`test-${parameter.parameterName}`}
                          >
                            {parameter.label || parameter.parameterName}
                            {parameter.required ? ' *' : ''}
                          </label>
                          {parameter.paramTypeCode === 'boolean' ? (
                            <select
                              className="form-select sky-form-control"
                              id={`test-${parameter.parameterName}`}
                              onChange={(event) =>
                                updateParameterValue(parameter.parameterName, event.target.value)
                              }
                              value={String(parameterValues[parameter.parameterName] ?? '')}
                            >
                              <option value="">Use default / omit</option>
                              <option value="true">True</option>
                              <option value="false">False</option>
                            </select>
                          ) : parameter.options?.length ? (
                            <select
                              className="form-select sky-form-control"
                              id={`test-${parameter.parameterName}`}
                              onChange={(event) =>
                                updateParameterValue(parameter.parameterName, event.target.value)
                              }
                              value={String(parameterValues[parameter.parameterName] ?? '')}
                            >
                              <option value="">Use default / omit</option>
                              {parameter.options
                                .filter((option) => option.enabled !== false)
                                .map((option) => (
                                  <option
                                    key={option.optionId || option.value}
                                    value={option.value}
                                  >
                                    {option.label}
                                  </option>
                                ))}
                            </select>
                          ) : (
                            <input
                              className="form-control sky-form-control"
                              id={`test-${parameter.parameterName}`}
                              onChange={(event) =>
                                updateParameterValue(parameter.parameterName, event.target.value)
                              }
                              placeholder={parameter.prompt || ''}
                              type={
                                parameter.paramTypeCode === 'number'
                                  ? 'number'
                                  : parameter.paramTypeCode === 'date'
                                    ? 'date'
                                    : 'text'
                              }
                              value={String(parameterValues[parameter.parameterName] ?? '')}
                            />
                          )}
                          {parameter.prompt && (
                            <div className="small sky-muted mt-1">{parameter.prompt}</div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}

                  {tool.requiresConfirmation && (
                    <div className="row g-3 mb-3">
                      <div className="col-md-6 d-flex align-items-end">
                        <label className="form-check form-switch mb-2">
                          <input
                            checked={confirmed}
                            className="form-check-input"
                            onChange={(event) => setConfirmed(event.target.checked)}
                            type="checkbox"
                          />
                          <span className="form-check-label">Confirm controlled execution</span>
                        </label>
                      </div>
                      {tool.riskCode === 'high' && (
                        <div className="col-md-6">
                          <label
                            className="form-label sky-form-label"
                            htmlFor="managed-test-confirmation-phrase"
                          >
                            High-risk confirmation phrase
                          </label>
                          <input
                            className="form-control sky-form-control"
                            id="managed-test-confirmation-phrase"
                            onChange={(event) => setConfirmationPhrase(event.target.value)}
                            value={confirmationPhrase}
                          />
                        </div>
                      )}
                    </div>
                  )}

                  {testResult && (
                    <div className="mt-3">
                      <div className="d-flex flex-wrap align-items-center gap-2 mb-2">
                        <StatusPill status={testResult.status} />
                        <span>{testResult.summary || testResult.message}</span>
                        <span className="small sky-muted">{testResult.durationMs} ms</span>
                      </div>
                      <div className="small sky-muted mb-2">
                        ToolResult contract:{' '}
                        {testResult.toolResultContract?.status || 'NOT_EMITTED'} · enabled state
                        changed: no
                      </div>
                      {testResult.toolResult && (
                        <pre className="sky-code-block mb-2">
                          {JSON.stringify(testResult.toolResult, null, 2)}
                        </pre>
                      )}
                      {(testResult.stdout || testResult.stderr) && (
                        <details>
                          <summary>Operational output</summary>
                          <pre className="sky-code-block mt-2 mb-0">
                            {[testResult.stdout, testResult.stderr].filter(Boolean).join('\n')}
                          </pre>
                        </details>
                      )}
                    </div>
                  )}
                </section>
              </div>
            </div>

            <div className="d-flex flex-wrap align-items-center justify-content-between gap-2 mt-4 pt-3 border-top">
              <div className="small sky-muted">
                Enablement is an explicit catalogue action. Contract and test results are helpful
                evidence, not mandatory locks.
              </div>
              {canWrite && (
                <button
                  className={
                    tool.enabled ? 'btn btn-sm sky-btn-danger' : 'btn btn-sm sky-btn-primary'
                  }
                  disabled={statusUpdating}
                  onClick={toggleEnabledState}
                  type="button"
                >
                  {statusUpdating ? 'Updating…' : tool.enabled ? 'Disable tool' : 'Enable tool'}
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </Panel>
  );
}

function ManageTools() {
  const { hasPermission } = useAuth();
  const [searchParams] = useSearchParams();
  const requestedToolId = searchParams.get('toolId') || '';
  const requestedView = searchParams.get('view') || '';
  const canWrite = hasPermission('ADMIN_TOOL_WRITE');
  const [options, setOptions] = useState({});
  const [tools, setTools] = useState([]);
  const [total, setTotal] = useState(0);
  const [filters, setFilters] = useState(DEFAULT_FILTERS);
  const [currentPage, setCurrentPage] = useState(1);
  const [selectedToolId, setSelectedToolId] = useState('');
  const [selectedTool, setSelectedTool] = useState(null);
  const [form, setForm] = useState(createEmptyToolForm());
  const [creating, setCreating] = useState(false);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const verificationPanelRef = useRef(null);
  const verificationScrollHandledRef = useRef(false);

  const selectedListTool = useMemo(
    () => tools.find((tool) => tool.toolId === selectedToolId) || null,
    [selectedToolId, tools],
  );

  const pageCount = Math.max(1, Math.ceil(total / MANAGE_TOOLS_PAGE_SIZE));
  const safeCurrentPage = Math.min(currentPage, pageCount);
  const rangeStart = total === 0 ? 0 : (safeCurrentPage - 1) * MANAGE_TOOLS_PAGE_SIZE + 1;
  const rangeEnd = Math.min(safeCurrentPage * MANAGE_TOOLS_PAGE_SIZE, total);

  function scrollToVerification(behavior = 'smooth') {
    const target = verificationPanelRef.current;

    if (!target) {
      return;
    }

    target.scrollIntoView({ behavior, block: 'start' });
    target.focus({ preventScroll: true });
  }

  async function loadList(
    nextFilters = filters,
    preferredToolId = selectedToolId,
    nextPage = currentPage,
  ) {
    setLoading(true);
    setError('');

    const safePage = Math.max(1, Number(nextPage) || 1);

    try {
      const result = await adminService.listAdminTools({
        ...nextFilters,
        limit: MANAGE_TOOLS_PAGE_SIZE,
        offset: (safePage - 1) * MANAGE_TOOLS_PAGE_SIZE,
      });
      const nextTools = result.items || [];
      const nextTotal = result.total || 0;
      const nextPageCount = Math.max(1, Math.ceil(nextTotal / MANAGE_TOOLS_PAGE_SIZE));

      if (nextTotal > 0 && safePage > nextPageCount) {
        await loadList(nextFilters, preferredToolId, nextPageCount);
        return;
      }

      setTools(nextTools);
      setTotal(nextTotal);
      setCurrentPage(safePage);

      if (creating) {
        return;
      }

      if (nextTools.length === 0) {
        setSelectedToolId('');
        setSelectedTool(null);
        setForm(createEmptyToolForm(options));
        return;
      }

      const preferredToolExists = nextTools.some((tool) => tool.toolId === preferredToolId);
      setSelectedToolId(preferredToolExists ? preferredToolId : nextTools[0]?.toolId || '');
    } catch (loadError) {
      setError(loadError.message || 'Failed to load tool catalogue.');
    } finally {
      setLoading(false);
    }
  }

  async function loadDetail(toolId) {
    if (!toolId || creating) {
      return;
    }

    setDetailLoading(true);
    setError('');

    try {
      const result = await adminService.getAdminTool(toolId);
      const tool = result.tool || null;
      setSelectedTool(tool);
      setForm(populateToolForm(tool, options));
    } catch (loadError) {
      setError(loadError.message || 'Failed to load tool detail.');
    } finally {
      setDetailLoading(false);
    }
  }

  useEffect(() => {
    let active = true;

    async function loadInitial() {
      setLoading(true);
      setError('');

      try {
        const [optionsResult, toolsResult] = await Promise.all([
          adminService.getAdminToolOptions(),
          adminService.listAdminTools({
            ...DEFAULT_FILTERS,
            limit: MANAGE_TOOLS_PAGE_SIZE,
            offset: 0,
          }),
        ]);

        if (!active) {
          return;
        }

        const nextTools = toolsResult.items || [];
        setOptions(optionsResult);
        setTools(nextTools);
        setTotal(toolsResult.total || 0);
        setCurrentPage(1);
        setSelectedToolId(requestedToolId || nextTools[0]?.toolId || '');
        setForm(createEmptyToolForm(optionsResult));
      } catch (loadError) {
        if (active) {
          setError(loadError.message || 'Failed to load Manage Tools.');
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    loadInitial();

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    loadDetail(selectedToolId);
  }, [selectedToolId, creating]);

  useEffect(() => {
    if (
      requestedView !== 'verification' ||
      verificationScrollHandledRef.current ||
      detailLoading ||
      !selectedTool?.managedBySkyCommand
    ) {
      return undefined;
    }

    verificationScrollHandledRef.current = true;
    const timeoutId = window.setTimeout(() => scrollToVerification('smooth'), 100);

    return () => window.clearTimeout(timeoutId);
  }, [detailLoading, requestedView, selectedTool?.managedBySkyCommand, selectedTool?.toolId]);

  function startCreate() {
    setCreating(true);
    setSelectedToolId('');
    setSelectedTool(null);
    setForm(createEmptyToolForm(options));
    setError('');
    setSuccess('');
  }

  function cancelCreate() {
    setCreating(false);
    const nextToolId = tools[0]?.toolId || '';
    setSelectedToolId(nextToolId);
    setError('');
    setSuccess('');
  }

  function updateForm(key, value) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function toggleVisibility(channelCode) {
    setForm((current) => ({
      ...current,
      visibility: current.visibility.includes(channelCode)
        ? current.visibility.filter((item) => item !== channelCode)
        : [...current.visibility, channelCode],
    }));
  }

  function addParameter() {
    setForm((current) => ({
      ...current,
      allowParams: true,
      parameters: [...current.parameters, createEmptyParameter(current.parameters.length, options)],
    }));
  }

  function updateParameter(index, key, value) {
    setForm((current) => ({
      ...current,
      parameters: current.parameters.map((parameter, parameterIndex) =>
        parameterIndex === index ? { ...parameter, [key]: value } : parameter,
      ),
    }));
  }

  function removeParameter(index) {
    setForm((current) => {
      const parameters = current.parameters
        .filter((_, parameterIndex) => parameterIndex !== index)
        .map((parameter, parameterIndex) => ({
          ...parameter,
          displayOrder: parameterIndex + 1,
        }));

      return {
        ...current,
        parameters,
        allowParams: parameters.length > 0,
      };
    });
  }

  async function handleSave(event) {
    event.preventDefault();

    if (!canWrite) {
      return;
    }

    setSaving(true);
    setError('');
    setSuccess('');

    try {
      const payload = buildToolPayload(form);
      const result = creating
        ? await adminService.createAdminTool(payload)
        : await adminService.updateAdminTool(selectedTool.toolId, payload);
      const savedTool = result.tool;

      setCreating(false);
      setSelectedTool(savedTool);
      setSelectedToolId(savedTool.toolId);
      setForm(populateToolForm(savedTool, options));
      setSuccess(`${savedTool.label} was ${creating ? 'created' : 'updated'}.`);
      await loadList(filters, savedTool.toolId);
    } catch (saveError) {
      setError(saveError.message || 'Failed to save tool configuration.');
    } finally {
      setSaving(false);
    }
  }

  async function handleToggleStatus() {
    const tool = selectedTool || selectedListTool;

    if (!tool || !canWrite) {
      return;
    }

    setSaving(true);
    setError('');
    setSuccess('');

    try {
      const result = await adminService.updateAdminToolStatus(tool.toolId, {
        enabled: !tool.enabled,
      });
      const updatedTool = result.tool;
      setSelectedTool(updatedTool);
      setForm(populateToolForm(updatedTool, options));
      setSuccess(`${updatedTool.label} is now ${updatedTool.enabled ? 'enabled' : 'disabled'}.`);
      await loadList(filters, updatedTool.toolId);
    } catch (saveError) {
      setError(saveError.message || 'Failed to update tool status.');
    } finally {
      setSaving(false);
    }
  }

  async function handleManagedToolUpdated(updatedTool) {
    setSelectedTool(updatedTool);
    setForm(populateToolForm(updatedTool, options));
    setSuccess(`${updatedTool.label} is now ${updatedTool.enabled ? 'enabled' : 'disabled'}.`);
    await loadList(filters, updatedTool.toolId);
  }

  function applyFilters(event) {
    event.preventDefault();
    setCreating(false);
    loadList(filters, '', 1);
  }

  function clearFilters() {
    setFilters(DEFAULT_FILTERS);
    setCreating(false);
    loadList(DEFAULT_FILTERS, '', 1);
  }

  function goToPage(page) {
    const nextPage = Math.min(Math.max(1, Number(page) || 1), pageCount);
    setCreating(false);
    loadList(filters, '', nextPage);
  }

  function renderPagination() {
    return (
      <div className="sky-pagination-row">
        <div className="small sky-muted">
          Showing {rangeStart}-{rangeEnd} of {total} managed tool(s)
        </div>
        <div className="sky-pagination-controls" aria-label="Manage tools pagination">
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
          <label className="sky-pagination-select-label" htmlFor="manageToolsPageSelect">
            Page
          </label>
          <select
            className="form-select form-select-sm sky-form-control sky-pagination-select"
            disabled={loading}
            id="manageToolsPageSelect"
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
          <div className="sky-page-kicker">Tools</div>
          <h1 className="sky-page-title">Manage Tools</h1>
          <p className="sky-page-subtitle">
            Maintain PostgreSQL tool identity, execution policy, visibility, positional parameters,
            static choices, and structured-output metadata without manual SQL.
          </p>
        </div>

        <div className="d-flex flex-wrap gap-2">
          <button
            className="btn sky-btn-ghost"
            disabled={loading}
            onClick={() => loadList()}
            type="button"
          >
            {loading ? 'Refreshing...' : 'Refresh catalogue'}
          </button>
          {canWrite && (
            <button className="btn sky-btn-primary" onClick={startCreate} type="button">
              Add catalogue record
            </button>
          )}
        </div>
      </header>

      {error && <div className="alert alert-danger">{error}</div>}
      {success && <div className="alert alert-success">{success}</div>}

      <section className="sky-card mb-3 sky-functional-history-browser sky-manage-tools-browser">
        <div className="sky-card-header">
          <div>
            <div className="sky-page-kicker">Catalogue browser</div>
            <h2 className="h5 mb-0">Managed tools</h2>
            <p className="sky-muted small mb-0">
              Filter the catalogue, then select a row to inspect or edit the complete configuration
              below.
            </p>
          </div>
          <form className="sky-manage-tools-filter-grid" onSubmit={applyFilters}>
            <div className="sky-manage-tools-search-filter">
              <label className="form-label sky-form-label" htmlFor="toolSearch">
                Search
              </label>
              <input
                className="form-control sky-form-control"
                id="toolSearch"
                onChange={(event) =>
                  setFilters((current) => ({ ...current, q: event.target.value }))
                }
                placeholder="Code, label, category, repository..."
                value={filters.q}
              />
            </div>
            <div>
              <label className="form-label sky-form-label" htmlFor="categoryFilter">
                Category
              </label>
              <select
                className="form-select sky-form-control"
                id="categoryFilter"
                onChange={(event) =>
                  setFilters((current) => ({ ...current, categoryCode: event.target.value }))
                }
                value={filters.categoryCode}
              >
                <option value="">All</option>
                {(options.categories || []).map((category) => (
                  <option key={category.categoryId} value={category.categoryCode}>
                    {category.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="form-label sky-form-label" htmlFor="runtimeFilter">
                Runtime
              </label>
              <select
                className="form-select sky-form-control"
                id="runtimeFilter"
                onChange={(event) =>
                  setFilters((current) => ({ ...current, runtimeCode: event.target.value }))
                }
                value={filters.runtimeCode}
              >
                <option value="">All</option>
                {(options.runtimes || []).map((runtime) => (
                  <option key={runtime.runtimeCode} value={runtime.runtimeCode}>
                    {runtime.runtimeName}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="form-label sky-form-label" htmlFor="riskFilter">
                Risk
              </label>
              <select
                className="form-select sky-form-control"
                id="riskFilter"
                onChange={(event) =>
                  setFilters((current) => ({ ...current, riskCode: event.target.value }))
                }
                value={filters.riskCode}
              >
                <option value="">All</option>
                {(options.risks || []).map((risk) => (
                  <option key={risk.riskCode} value={risk.riskCode}>
                    {risk.riskName}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="form-label sky-form-label" htmlFor="statusFilter">
                Status
              </label>
              <select
                className="form-select sky-form-control"
                id="statusFilter"
                onChange={(event) =>
                  setFilters((current) => ({ ...current, enabled: event.target.value }))
                }
                value={filters.enabled}
              >
                <option value="">All</option>
                <option value="true">Enabled</option>
                <option value="false">Disabled</option>
              </select>
            </div>
            <div className="sky-manage-tools-filter-actions">
              <button className="btn btn-sm sky-btn-primary" type="submit">
                Apply filters
              </button>
              <button className="btn btn-sm sky-btn-ghost" onClick={clearFilters} type="button">
                Clear
              </button>
            </div>
          </form>
        </div>

        <div className="table-responsive sky-table-card sky-functional-history-table-card">
          <table className="table table-sm table-hover sky-table align-middle mb-0">
            <thead>
              <tr>
                <th>Tool</th>
                <th>Runtime</th>
                <th>Risk</th>
                <th>Parameters</th>
                <th>Visibility</th>
                <th>Output contract</th>
                <th>Status</th>
                <th className="text-end">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan="8">
                    <div className="sky-empty-state py-4">
                      <div className="spinner-border text-info" role="status" aria-label="Loading" />
                    </div>
                  </td>
                </tr>
              ) : tools.length === 0 ? (
                <tr>
                  <td colSpan="8">
                    <div className="sky-empty-state py-4">
                      No tools match the current filters.
                    </div>
                  </td>
                </tr>
              ) : (
                tools.map((tool) => (
                  <tr
                    className={`sky-clickable-row ${
                      tool.toolId === selectedToolId && !creating ? 'sky-selected-row' : ''
                    }`}
                    key={tool.toolId}
                    onClick={() => {
                      setCreating(false);
                      setSelectedToolId(tool.toolId);
                      setSuccess('');
                      setError('');
                    }}
                  >
                    <td>
                      <div className="fw-semibold sky-detail-value">{tool.label}</div>
                      <div className="small sky-mono">{tool.toolCode}</div>
                      <div className="small sky-muted">{tool.categoryLabel}</div>
                    </td>
                    <td>{tool.runtimeCode || '—'}</td>
                    <td>
                      <span className={`sky-pill ${
                        tool.riskCode === 'high'
                          ? 'sky-pill-danger'
                          : tool.riskCode === 'medium'
                            ? 'sky-pill-warning'
                            : 'sky-pill-success'
                      }`}>
                        {tool.riskCode || 'unknown'}
                      </span>
                    </td>
                    <td>{tool.parameterCount || 0}</td>
                    <td>
                      <div className="d-flex flex-wrap gap-1">
                        {(tool.visibility || []).length > 0 ? (
                          tool.visibility.map((channel) => (
                            <span className="sky-pill sky-pill-info" key={channel}>
                              {channel}
                            </span>
                          ))
                        ) : (
                          <span className="sky-muted">—</span>
                        )}
                      </div>
                    </td>
                    <td>
                      {tool.outputType ? (
                        <span className="sky-pill sky-pill-success">{tool.outputType}</span>
                      ) : (
                        <span className="sky-muted">Standard process output</span>
                      )}
                    </td>
                    <td>
                      <StatusPill status={tool.enabled ? 'ACTIVE' : 'OFFLINE'}>
                        {tool.enabled ? 'Enabled' : 'Disabled'}
                      </StatusPill>
                    </td>
                    <td className="text-end">
                      <button
                        className="btn btn-sm sky-btn-ghost"
                        onClick={(event) => {
                          event.stopPropagation();
                          setCreating(false);
                          setSelectedToolId(tool.toolId);
                          setSuccess('');
                          setError('');
                        }}
                        type="button"
                      >
                        {tool.toolId === selectedToolId && !creating ? 'Selected' : 'Manage tool'}
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

      <Panel
            actions={
              !creating && selectedTool ? (
                <>
                  {selectedTool.managedBySkyCommand && (
                    <button
                      className="btn btn-sm sky-btn-ghost"
                      onClick={() => scrollToVerification()}
                      type="button"
                    >
                      Verification &amp; test
                    </button>
                  )}
                  {canWrite && (
                    <button
                      className={`btn btn-sm ${selectedTool.enabled ? 'sky-btn-danger' : 'sky-btn-primary'}`}
                      disabled={saving}
                      onClick={handleToggleStatus}
                      type="button"
                    >
                      {selectedTool.enabled ? 'Disable tool' : 'Enable tool'}
                    </button>
                  )}
                </>
              ) : null
            }
            subtitle={
              creating
                ? 'Create a new PostgreSQL catalogue record. No files are uploaded in Phase 15.2.'
                : 'Core configuration, visibility, parameters, and static choices.'
            }
            title={creating ? 'New tool configuration' : selectedTool?.label || 'Tool detail'}
          >
            {detailLoading && !creating ? (
              <div className="sky-empty-state py-5">
                <div className="spinner-border text-info" role="status" aria-label="Loading" />
              </div>
            ) : !creating && !selectedTool ? (
              <div className="sky-empty-state py-5">
                Select a tool to inspect its configuration.
              </div>
            ) : (
              <form className="sky-card-body" onSubmit={handleSave}>
                <div className="row g-3">
                  <div className="col-md-4">
                    <label className="form-label sky-form-label" htmlFor="adminToolCode">
                      Tool code <span className="text-danger">*</span>
                    </label>
                    <input
                      className="form-control sky-form-control sky-mono"
                      disabled={!creating || !canWrite || saving}
                      id="adminToolCode"
                      onChange={(event) => updateForm('toolCode', event.target.value)}
                      required
                      value={form.toolCode}
                    />
                    {!creating && (
                      <div className="form-text sky-muted">
                        Immutable after creation to protect workflow references.
                      </div>
                    )}
                  </div>
                  <div className="col-md-4">
                    <label className="form-label sky-form-label" htmlFor="adminToolName">
                      Internal name <span className="text-danger">*</span>
                    </label>
                    <input
                      className="form-control sky-form-control"
                      disabled={!canWrite || saving}
                      id="adminToolName"
                      onChange={(event) => updateForm('name', event.target.value)}
                      required
                      value={form.name}
                    />
                  </div>
                  <div className="col-md-4">
                    <label className="form-label sky-form-label" htmlFor="adminToolLabel">
                      Display label <span className="text-danger">*</span>
                    </label>
                    <input
                      className="form-control sky-form-control"
                      disabled={!canWrite || saving}
                      id="adminToolLabel"
                      onChange={(event) => updateForm('label', event.target.value)}
                      required
                      value={form.label}
                    />
                  </div>
                  <div className="col-12">
                    <label className="form-label sky-form-label" htmlFor="adminToolDescription">
                      Description
                    </label>
                    <textarea
                      className="form-control sky-form-control"
                      disabled={!canWrite || saving}
                      id="adminToolDescription"
                      onChange={(event) => updateForm('description', event.target.value)}
                      rows="2"
                      value={form.description}
                    />
                  </div>

                  <div className="col-md-4">
                    <label className="form-label sky-form-label" htmlFor="adminToolCategory">
                      Category <span className="text-danger">*</span>
                    </label>
                    <select
                      className="form-select sky-form-control"
                      disabled={!canWrite || saving}
                      id="adminToolCategory"
                      onChange={(event) => updateForm('categoryId', event.target.value)}
                      required
                      value={form.categoryId}
                    >
                      {(options.categories || []).map((category) => (
                        <option key={category.categoryId} value={category.categoryId}>
                          {category.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="col-md-4">
                    <label className="form-label sky-form-label" htmlFor="adminToolRepository">
                      Script repository <span className="text-danger">*</span>
                    </label>
                    <select
                      className="form-select sky-form-control"
                      disabled={!canWrite || saving}
                      id="adminToolRepository"
                      onChange={(event) => updateForm('scriptRepoId', event.target.value)}
                      required
                      value={form.scriptRepoId}
                    >
                      {(options.repositories || []).map((repository) => (
                        <option key={repository.repoId} value={repository.repoId}>
                          {repository.repoName} ({repository.repoCode})
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="col-md-4">
                    <label className="form-label sky-form-label" htmlFor="adminToolRuntime">
                      Runtime <span className="text-danger">*</span>
                    </label>
                    <select
                      className="form-select sky-form-control"
                      disabled={!canWrite || saving}
                      id="adminToolRuntime"
                      onChange={(event) => updateForm('runtimeCode', event.target.value)}
                      required
                      value={form.runtimeCode}
                    >
                      {(options.runtimes || []).map((runtime) => (
                        <option key={runtime.runtimeCode} value={runtime.runtimeCode}>
                          {runtime.runtimeName} ({runtime.runtimeCode})
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="col-md-8">
                    <label className="form-label sky-form-label" htmlFor="adminToolScriptPath">
                      Repository-relative script path <span className="text-danger">*</span>
                    </label>
                    <input
                      className="form-control sky-form-control sky-mono"
                      disabled={!canWrite || saving}
                      id="adminToolScriptPath"
                      onChange={(event) => updateForm('scriptPath', event.target.value)}
                      placeholder="packages/example/src/tool.js"
                      required
                      value={form.scriptPath}
                    />
                  </div>
                  <div className="col-md-4">
                    <label className="form-label sky-form-label" htmlFor="adminToolDisplayOrder">
                      Display order
                    </label>
                    <input
                      className="form-control sky-form-control"
                      disabled={!canWrite || saving}
                      id="adminToolDisplayOrder"
                      min="0"
                      onChange={(event) => updateForm('displayOrder', event.target.value)}
                      type="number"
                      value={form.displayOrder}
                    />
                  </div>

                  <div className="col-md-6">
                    <label className="form-label sky-form-label" htmlFor="adminToolPermission">
                      Execution permission
                    </label>
                    <select
                      className="form-select sky-form-control"
                      disabled={!canWrite || saving}
                      id="adminToolPermission"
                      onChange={(event) => updateForm('permissionCode', event.target.value)}
                      value={form.permissionCode}
                    >
                      <option value="">No tool-specific permission</option>
                      {(options.permissions || []).map((permission) => (
                        <option key={permission.permissionCode} value={permission.permissionCode}>
                          {permission.permissionCode}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="col-md-3">
                    <label className="form-label sky-form-label" htmlFor="adminToolRisk">
                      Risk
                    </label>
                    <select
                      className="form-select sky-form-control"
                      disabled={!canWrite || saving}
                      id="adminToolRisk"
                      onChange={(event) => updateForm('riskCode', event.target.value)}
                      value={form.riskCode}
                    >
                      {(options.risks || []).map((risk) => (
                        <option key={risk.riskCode} value={risk.riskCode}>
                          {risk.riskName}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="col-md-3 d-flex align-items-end">
                    <label className="form-check form-switch mb-2">
                      <input
                        checked={form.requiresConfirmation}
                        className="form-check-input"
                        disabled={!canWrite || saving}
                        onChange={(event) =>
                          updateForm('requiresConfirmation', event.target.checked)
                        }
                        type="checkbox"
                      />
                      <span className="form-check-label">Confirmation required</span>
                    </label>
                  </div>
                  {form.requiresConfirmation && (
                    <div className="col-12">
                      <label className="form-label sky-form-label" htmlFor="adminToolConfirmText">
                        Confirmation text
                      </label>
                      <input
                        className="form-control sky-form-control"
                        disabled={!canWrite || saving}
                        id="adminToolConfirmText"
                        onChange={(event) => updateForm('confirmationText', event.target.value)}
                        value={form.confirmationText}
                      />
                    </div>
                  )}

                  <div className="col-md-6">
                    <label className="form-label sky-form-label" htmlFor="adminToolOutputType">
                      Structured output type
                    </label>
                    <input
                      className="form-control sky-form-control sky-mono"
                      disabled={!canWrite || saving}
                      id="adminToolOutputType"
                      onChange={(event) => updateForm('outputType', event.target.value)}
                      placeholder="example_summary.v1"
                      value={form.outputType}
                    />
                  </div>
                  <div className="col-md-6">
                    <label className="form-label sky-form-label" htmlFor="adminToolSchemaPath">
                      Output schema path
                    </label>
                    <input
                      className="form-control sky-form-control sky-mono"
                      disabled={!canWrite || saving}
                      id="adminToolSchemaPath"
                      onChange={(event) => updateForm('outputSchemaPath', event.target.value)}
                      placeholder="packages/tools/contracts/example_summary.v1.schema.json"
                      value={form.outputSchemaPath}
                    />
                  </div>

                  <div className="col-12">
                    <div className="sky-subsection-title">Visibility and execution controls</div>
                    <div className="d-flex flex-wrap gap-3 mt-2">
                      {(options.visibilityChannels || []).map((channel) => (
                        <label className="form-check" key={channel.channelCode}>
                          <input
                            checked={form.visibility.includes(channel.channelCode)}
                            className="form-check-input"
                            disabled={!canWrite || saving}
                            onChange={() => toggleVisibility(channel.channelCode)}
                            type="checkbox"
                          />
                          <span className="form-check-label">{channel.channelName}</span>
                        </label>
                      ))}
                      <label className="form-check form-switch">
                        <input
                          checked={form.capturesOutput}
                          className="form-check-input"
                          disabled={!canWrite || saving}
                          onChange={(event) => updateForm('capturesOutput', event.target.checked)}
                          type="checkbox"
                        />
                        <span className="form-check-label">Capture output</span>
                      </label>
                      <label className="form-check form-switch">
                        <input
                          checked={form.enabled}
                          className="form-check-input"
                          disabled={!canWrite || saving}
                          onChange={(event) => updateForm('enabled', event.target.checked)}
                          type="checkbox"
                        />
                        <span className="form-check-label">Enabled</span>
                      </label>
                    </div>
                  </div>

                  <div className="col-12">
                    <div className="d-flex align-items-center justify-content-between gap-2 mb-2">
                      <div>
                        <div className="sky-subsection-title">Positional parameters</div>
                        <div className="small sky-muted">
                          Enabled parameters are appended to the command line in display order.
                        </div>
                      </div>
                      {canWrite && (
                        <button
                          className="btn btn-sm sky-btn-ghost"
                          disabled={saving}
                          onClick={addParameter}
                          type="button"
                        >
                          Add parameter
                        </button>
                      )}
                    </div>

                    {form.parameters.length === 0 ? (
                      <div className="sky-empty-state sky-tool-parameter-empty">
                        This tool has no configured positional parameters.
                      </div>
                    ) : (
                      <div className="d-grid gap-3">
                        {form.parameters.map((parameter, index) => (
                          <section
                            className="sky-tool-parameter-editor"
                            key={`${index}-${parameter.parameterName}`}
                          >
                            <div className="d-flex align-items-center justify-content-between gap-2 mb-3">
                              <div className="fw-semibold">Parameter {index + 1}</div>
                              {canWrite && (
                                <button
                                  className="btn btn-sm sky-btn-danger"
                                  disabled={saving}
                                  onClick={() => removeParameter(index)}
                                  type="button"
                                >
                                  Remove
                                </button>
                              )}
                            </div>
                            <div className="row g-3">
                              <div className="col-md-4">
                                <label className="form-label sky-form-label">Name</label>
                                <input
                                  className="form-control sky-form-control sky-mono"
                                  disabled={!canWrite || saving}
                                  onChange={(event) =>
                                    updateParameter(index, 'parameterName', event.target.value)
                                  }
                                  required
                                  value={parameter.parameterName}
                                />
                              </div>
                              <div className="col-md-4">
                                <label className="form-label sky-form-label">Label</label>
                                <input
                                  className="form-control sky-form-control"
                                  disabled={!canWrite || saving}
                                  onChange={(event) =>
                                    updateParameter(index, 'label', event.target.value)
                                  }
                                  required
                                  value={parameter.label}
                                />
                              </div>
                              <div className="col-md-2">
                                <label className="form-label sky-form-label">Type</label>
                                <select
                                  className="form-select sky-form-control"
                                  disabled={!canWrite || saving}
                                  onChange={(event) =>
                                    updateParameter(index, 'paramTypeCode', event.target.value)
                                  }
                                  value={parameter.paramTypeCode}
                                >
                                  {(options.paramTypes || []).map((type) => (
                                    <option key={type.paramTypeCode} value={type.paramTypeCode}>
                                      {type.paramTypeName}
                                    </option>
                                  ))}
                                </select>
                              </div>
                              <div className="col-md-2">
                                <label className="form-label sky-form-label">Position</label>
                                <input
                                  className="form-control sky-form-control"
                                  disabled={!canWrite || saving}
                                  min="1"
                                  onChange={(event) =>
                                    updateParameter(index, 'displayOrder', event.target.value)
                                  }
                                  type="number"
                                  value={parameter.displayOrder}
                                />
                              </div>
                              <div className="col-md-8">
                                <label className="form-label sky-form-label">
                                  Prompt / help text
                                </label>
                                <input
                                  className="form-control sky-form-control"
                                  disabled={!canWrite || saving}
                                  onChange={(event) =>
                                    updateParameter(index, 'prompt', event.target.value)
                                  }
                                  value={parameter.prompt}
                                />
                              </div>
                              <div className="col-md-4">
                                <label className="form-label sky-form-label">Default value</label>
                                <input
                                  className="form-control sky-form-control"
                                  disabled={!canWrite || saving}
                                  onChange={(event) =>
                                    updateParameter(index, 'defaultValue', event.target.value)
                                  }
                                  value={parameter.defaultValue}
                                />
                              </div>
                              <div className="col-md-4">
                                <label className="form-label sky-form-label">
                                  Dynamic option source
                                </label>
                                <select
                                  className="form-select sky-form-control"
                                  disabled={!canWrite || saving}
                                  onChange={(event) =>
                                    updateParameter(index, 'optionSourceCode', event.target.value)
                                  }
                                  value={parameter.optionSourceCode}
                                >
                                  <option value="">None</option>
                                  {(options.optionSources || []).map((source) => (
                                    <option
                                      key={source.optionSourceCode}
                                      value={source.optionSourceCode}
                                    >
                                      {source.optionSourceName}
                                    </option>
                                  ))}
                                </select>
                              </div>
                              <div className="col-md-8">
                                <label className="form-label sky-form-label">
                                  Static choices (one Label=Value per line)
                                </label>
                                <textarea
                                  className="form-control sky-form-control sky-mono"
                                  disabled={
                                    !canWrite || saving || Boolean(parameter.optionSourceCode)
                                  }
                                  onChange={(event) =>
                                    updateParameter(index, 'optionText', event.target.value)
                                  }
                                  rows="3"
                                  value={parameter.optionText}
                                />
                              </div>
                              <div className="col-12 d-flex flex-wrap gap-3">
                                <label className="form-check form-switch">
                                  <input
                                    checked={parameter.required}
                                    className="form-check-input"
                                    disabled={!canWrite || saving}
                                    onChange={(event) =>
                                      updateParameter(index, 'required', event.target.checked)
                                    }
                                    type="checkbox"
                                  />
                                  <span className="form-check-label">Required</span>
                                </label>
                                <label className="form-check form-switch">
                                  <input
                                    checked={parameter.enabled}
                                    className="form-check-input"
                                    disabled={!canWrite || saving}
                                    onChange={(event) =>
                                      updateParameter(index, 'enabled', event.target.checked)
                                    }
                                    type="checkbox"
                                  />
                                  <span className="form-check-label">Enabled</span>
                                </label>
                              </div>
                            </div>
                          </section>
                        ))}
                      </div>
                    )}
                  </div>

                  {!creating && selectedTool?.managedBySkyCommand && (
                    <div className="col-12">
                      <div className="alert alert-info mb-0">
                        This record was registered through the managed onboarding framework. Its
                        descriptor and file provenance remain informational; PostgreSQL is still the
                        runtime authority.
                      </div>
                    </div>
                  )}

                  <div className="col-12 d-flex flex-wrap gap-2 pt-2">
                    {canWrite && (
                      <button className="btn sky-btn-primary" disabled={saving} type="submit">
                        {saving ? 'Saving...' : creating ? 'Create tool' : 'Save configuration'}
                      </button>
                    )}
                    {creating && (
                      <button
                        className="btn sky-btn-ghost"
                        disabled={saving}
                        onClick={cancelCreate}
                        type="button"
                      >
                        Cancel
                      </button>
                    )}
                  </div>
                </div>
              </form>
            )}
      </Panel>

      {!creating && selectedTool?.managedBySkyCommand && (
        <div
            className="sky-managed-tool-verification-anchor"
            id="managed-tool-verification"
            ref={verificationPanelRef}
            tabIndex="-1"
          >
            <ManagedToolVerificationPanel
              canWrite={canWrite}
              onToolUpdated={handleManagedToolUpdated}
              tool={selectedTool}
            />
        </div>
      )}
    </>
  );
}

export default ManageTools;
