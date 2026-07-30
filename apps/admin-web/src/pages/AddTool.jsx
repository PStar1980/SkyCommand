import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Panel from '../components/ui/Panel.jsx';
import StatusPill from '../components/ui/StatusPill.jsx';
import IngestionProfileEditor from '../components/IngestionProfileEditor.jsx';
import adminService from '../services/adminService.js';

const EMPTY_FILES = { script: null, descriptor: null, schema: null };

function getCategoryKind(options = {}, categoryId) {
  return (
    (options.categories || []).find((category) => category.categoryId === categoryId)
      ?.categoryKindCode || 'GENERAL'
  );
}

function createEmptyIngestionProfile(options = {}, preferredDomainId = '') {
  const domain =
    (options.dataDomains || []).find((item) => item.domainId === preferredDomainId) ||
    options.dataDomains?.[0];
  const source = (options.dataSources || []).find(
    (item) => !domain?.domainId || item.domainId === domain.domainId,
  );

  return {
    dataDomainId: domain?.domainId || '',
    sourceId: source?.sourceId || '',
    adapterCode: source?.sourceCode || '',
    contractVersion: 'ingestion_run_summary.v1',
    supportsIncremental: false,
    supportsSelectedAssets: false,
    supportsBackfill: false,
    supportsRevisions: false,
    supportsResume: false,
    supportsDryRun: false,
    active: true,
    configurationText: '{}',
  };
}

function parseConfigurationObject(text) {
  const parsed = JSON.parse(String(text || '{}'));
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Ingestion profile configuration must be a JSON object.');
  }
  return parsed;
}

function formatBytes(value) {
  const bytes = Number(value || 0);
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
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
      return { label, value, displayOrder: index + 1, enabled: true };
    });
}

function FilePicker({ accept, file, help, id, label, onChange, required = false }) {
  return (
    <div>
      <label className="form-label" htmlFor={id}>
        {label} {required && <span className="text-danger">*</span>}
      </label>
      <input
        accept={accept}
        className="form-control sky-form-control sky-tool-upload-input"
        id={id}
        onChange={(event) => onChange(event.target.files?.[0] || null)}
        type="file"
      />
      <div className="small sky-muted mt-1">
        {file ? `${file.name} · ${formatBytes(file.size)}` : help}
      </div>
    </div>
  );
}

function createForm(analysis, catalogueOptions = {}) {
  const suggestions = analysis?.suggestions || {};
  const category = (catalogueOptions.categories || []).find(
    (item) => item.categoryCode === suggestions.categoryCode,
  );
  const visibility = suggestions.visibility?.length
    ? suggestions.visibility
    : (catalogueOptions.visibilityChannels || []).map((item) => item.channelCode);

  const categoryId = category?.categoryId || catalogueOptions.categories?.[0]?.categoryId || '';

  return {
    toolCode: suggestions.toolCode || '',
    packageRelativePath:
      suggestions.destinationRelativePath ||
      `${catalogueOptions.defaultToolPackageRelativePath || 'packages/tools/custom'}/${suggestions.toolCode || 'new_tool'}`,
    entrypointRelativePath:
      suggestions.entrypointRelativePath || `src/${suggestions.scriptFilename || 'tool.js'}`,
    name: suggestions.name || suggestions.toolCode || '',
    label: suggestions.label || '',
    description: suggestions.description || '',
    categoryId,
    runtimeCode: 'node',
    permissionCode: suggestions.permissionCode || '',
    riskCode: suggestions.riskCode || catalogueOptions.risks?.[0]?.riskCode || 'low',
    requiresConfirmation: Boolean(suggestions.requiresConfirmation),
    confirmationText: suggestions.confirmationText || '',
    capturesOutput: suggestions.capturesOutput !== false,
    displayOrder: 999,
    outputType: suggestions.outputType || '',
    visibility,
    parameters: (suggestions.parameters || []).map((parameter, index) => ({
      parameterName: parameter.name || `parameter${index + 1}`,
      label: parameter.label || parameter.name || `Parameter ${index + 1}`,
      paramTypeCode: parameter.type || 'string',
      prompt: parameter.prompt || '',
      required: Boolean(parameter.required),
      defaultValue: parameter.defaultValue ?? '',
      optionSourceCode: parameter.optionSourceCode || '',
      displayOrder: parameter.position || index + 1,
      enabled: true,
      optionText: serializeOptions(parameter.options || []),
    })),
    ingestionProfile:
      getCategoryKind(catalogueOptions, categoryId) === 'INGESTION'
        ? createEmptyIngestionProfile(catalogueOptions)
        : null,
  };
}

function createEmptyParameter(index, catalogueOptions = {}) {
  return {
    parameterName: '',
    label: '',
    paramTypeCode: catalogueOptions.paramTypes?.[0]?.paramTypeCode || 'string',
    prompt: '',
    required: false,
    defaultValue: '',
    optionSourceCode: '',
    displayOrder: index + 1,
    enabled: true,
    optionText: '',
  };
}

function buildConfiguration(form, catalogueOptions = {}) {
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

  const ingestionProfile =
    getCategoryKind(catalogueOptions, form.categoryId) === 'INGESTION'
      ? {
          ...form.ingestionProfile,
          configuration: parseConfigurationObject(form.ingestionProfile?.configurationText),
        }
      : null;

  if (ingestionProfile) {
    delete ingestionProfile.configurationText;
  }

  return {
    toolCode: form.toolCode.trim(),
    packageRelativePath: form.packageRelativePath.trim(),
    entrypointRelativePath: form.entrypointRelativePath.trim(),
    name: form.name.trim(),
    label: form.label.trim(),
    description: form.description.trim() || null,
    categoryId: form.categoryId,
    runtimeCode: 'node',
    permissionCode: form.permissionCode || null,
    riskCode: form.riskCode,
    requiresConfirmation: Boolean(form.requiresConfirmation),
    confirmationText: form.requiresConfirmation ? form.confirmationText.trim() || null : null,
    capturesOutput: Boolean(form.capturesOutput),
    allowParams: parameters.some((parameter) => parameter.enabled),
    displayOrder: Number(form.displayOrder),
    enabled: false,
    outputType: form.outputType.trim() || null,
    visibility: form.visibility,
    parameters,
    ingestionProfile,
  };
}

function AddTool() {
  const navigate = useNavigate();
  const [options, setOptions] = useState(null);
  const [files, setFiles] = useState(EMPTY_FILES);
  const [analysis, setAnalysis] = useState(null);
  const [form, setForm] = useState(null);
  const [preview, setPreview] = useState(null);
  const [registration, setRegistration] = useState(null);
  const [confirmRegistration, setConfirmRegistration] = useState(false);
  const [loading, setLoading] = useState(true);
  const [analyzing, setAnalyzing] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [registering, setRegistering] = useState(false);
  const [error, setError] = useState('');

  const readiness = options?.readiness || null;
  const uploadPolicy = options?.uploadPolicy || null;
  const catalogueOptions = options?.catalogueOptions || {};
  const canAnalyze = Boolean(readiness?.ready && files.script && !analyzing);
  const canPreview = Boolean(
    analysis?.summary?.canContinue && form && !previewing && !registration,
  );
  const canRegister = Boolean(preview?.canRegister && confirmRegistration && !registering);

  const selectedBytes = useMemo(
    () => Object.values(files).reduce((sum, file) => sum + Number(file?.size || 0), 0),
    [files],
  );

  useEffect(() => {
    let active = true;
    async function loadOptions() {
      setLoading(true);
      setError('');
      try {
        const result = await adminService.getToolOnboardingOptions();
        if (active) setOptions(result);
      } catch (loadError) {
        if (active) setError(loadError.message || 'Failed to load tool onboarding options.');
      } finally {
        if (active) setLoading(false);
      }
    }
    loadOptions();
    return () => {
      active = false;
    };
  }, []);

  function invalidatePreview() {
    setPreview(null);
    setRegistration(null);
    setConfirmRegistration(false);
  }

  function setFile(kind, file) {
    setFiles((current) => ({ ...current, [kind]: file }));
    setAnalysis(null);
    setForm(null);
    invalidatePreview();
    setError('');
  }

  function resetWorkbench() {
    setFiles(EMPTY_FILES);
    setAnalysis(null);
    setForm(null);
    invalidatePreview();
    setError('');
    document.querySelectorAll('input.sky-tool-upload-input').forEach((input) => {
      input.value = '';
    });
  }

  async function serializeFile(file) {
    if (!file) return null;
    return { filename: file.name, content: await file.text() };
  }

  async function analyzePackage() {
    if (!canAnalyze) return;
    setAnalyzing(true);
    setError('');
    setAnalysis(null);
    setForm(null);
    invalidatePreview();
    try {
      const result = await adminService.analyzeToolOnboardingPackage({
        script: await serializeFile(files.script),
        descriptor: await serializeFile(files.descriptor),
        schema: await serializeFile(files.schema),
      });
      setAnalysis(result);
      setForm(createForm(result, result.catalogueOptions || catalogueOptions));
    } catch (analysisError) {
      setError(analysisError.message || 'Tool package analysis failed.');
    } finally {
      setAnalyzing(false);
    }
  }

  function updateForm(key, value) {
    setForm((current) => {
      if (key !== 'categoryId') {
        return { ...current, [key]: value };
      }

      const categoryKindCode = getCategoryKind(catalogueOptions, value);
      return {
        ...current,
        categoryId: value,
        ingestionProfile:
          categoryKindCode === 'INGESTION'
            ? current.ingestionProfile || createEmptyIngestionProfile(catalogueOptions)
            : null,
      };
    });
    invalidatePreview();
  }

  function updateIngestionProfile(profile) {
    setForm((current) => ({ ...current, ingestionProfile: profile }));
    invalidatePreview();
  }

  function toggleVisibility(channelCode) {
    setForm((current) => ({
      ...current,
      visibility: current.visibility.includes(channelCode)
        ? current.visibility.filter((item) => item !== channelCode)
        : [...current.visibility, channelCode],
    }));
    invalidatePreview();
  }

  function addParameter() {
    setForm((current) => ({
      ...current,
      parameters: [
        ...current.parameters,
        createEmptyParameter(current.parameters.length, catalogueOptions),
      ],
    }));
    invalidatePreview();
  }

  function updateParameter(index, key, value) {
    setForm((current) => ({
      ...current,
      parameters: current.parameters.map((parameter, parameterIndex) =>
        parameterIndex === index ? { ...parameter, [key]: value } : parameter,
      ),
    }));
    invalidatePreview();
  }

  function removeParameter(index) {
    setForm((current) => ({
      ...current,
      parameters: current.parameters
        .filter((_, parameterIndex) => parameterIndex !== index)
        .map((parameter, parameterIndex) => ({
          ...parameter,
          displayOrder: parameterIndex + 1,
        })),
    }));
    invalidatePreview();
  }

  async function refreshPreview() {
    if (!canPreview) return;
    setPreviewing(true);
    setError('');
    invalidatePreview();
    try {
      const result = await adminService.previewToolOnboardingRegistration({
        sessionId: analysis.session.sessionId,
        configuration: buildConfiguration(form, catalogueOptions),
      });
      setPreview(result.preview);
    } catch (previewError) {
      setError(previewError.message || 'Registration preview failed.');
    } finally {
      setPreviewing(false);
    }
  }

  async function registerPackage() {
    if (!canRegister) return;
    setRegistering(true);
    setError('');
    try {
      const result = await adminService.registerToolOnboardingPackage({
        sessionId: analysis.session.sessionId,
        configuration: buildConfiguration(form, catalogueOptions),
        previewFingerprint: preview.fingerprint,
      });
      setRegistration(result.registration);
    } catch (registrationError) {
      setError(registrationError.message || 'Managed tool registration failed.');
    } finally {
      setRegistering(false);
    }
  }

  return (
    <div className="sky-page-shell">
      <div className="sky-page-stack">
        <Panel
          kicker="TOOLS"
          subtitle="Stage, analyze, configure, preview, and register one trusted Node.js tool package. Registration writes the implementation and optional central contract plus a disabled PostgreSQL catalogue record, but never executes the uploaded code."
          title="Add Tool"
          titleClassName="sky-page-title mb-0"
        >
          <div className="sky-card-body d-flex flex-wrap gap-2 align-items-center justify-content-between">
            <div className="small sky-muted">
              Phase 15.5.1 keeps onboarding lightweight: destinations may be any new directory
              inside packages, and hashes remain registration evidence only.
            </div>
            <StatusPill status={readiness?.ready ? 'READY' : 'BLOCKED'} />
          </div>
        </Panel>

        {error && <div className="alert alert-danger mb-0">{error}</div>}

        <Panel
          subtitle="The designated repository and active profile path must be ready before onboarding files can be staged or promoted."
          title="SkyCommand repository readiness"
        >
          <div className="sky-card-body">
            {loading ? (
              <div className="sky-muted">Checking repository readiness…</div>
            ) : (
              <div className="row g-3">
                <div className="col-md-3">
                  <div className="small sky-muted">Status</div>
                  <StatusPill status={readiness?.ready ? 'READY' : 'BLOCKED'} />
                </div>
                <div className="col-md-3">
                  <div className="small sky-muted">Repository</div>
                  <div>{readiness?.repository?.repoName || 'Not configured'}</div>
                </div>
                <div className="col-md-3">
                  <div className="small sky-muted">Profile</div>
                  <div>{readiness?.profileCode || '—'}</div>
                </div>
                <div className="col-md-3">
                  <div className="small sky-muted">Packages root</div>
                  <div className="text-break">{readiness?.path?.packagesRoot || '—'}</div>
                </div>
                <div className="col-12">
                  <div className={readiness?.ready ? 'text-success' : 'text-danger'}>
                    {readiness?.message || 'Repository readiness is unavailable.'}
                  </div>
                  {readiness?.errorCode && (
                    <div className="small sky-muted mt-1">{readiness.errorCode}</div>
                  )}
                </div>
              </div>
            )}
          </div>
        </Panel>

        {!registration && (
          <Panel
            actions={
              <>
                <button
                  className="btn btn-outline-secondary btn-sm"
                  onClick={resetWorkbench}
                  type="button"
                >
                  Reset
                </button>
                <button
                  className="btn btn-primary btn-sm"
                  disabled={!canAnalyze}
                  onClick={analyzePackage}
                  type="button"
                >
                  {analyzing ? 'Analyzing…' : 'Stage and analyze'}
                </button>
              </>
            }
            subtitle="Files enter a bounded, non-executable session. No npm install, script execution, or Git operation occurs."
            title="Trusted upload workbench"
          >
            <div className="sky-card-body">
              <div className="alert alert-warning">
                <strong>Privileged code deployment boundary:</strong> static analysis cannot prove
                arbitrary code harmless. Only trusted administrator-authored files belong here.
              </div>
              <div className="row g-3">
                <div className="col-lg-4">
                  <FilePicker
                    accept=".js,text/javascript"
                    file={files.script}
                    help={`Required · one .js file · max ${formatBytes(uploadPolicy?.script?.maximumBytes)}`}
                    id="tool-script-upload"
                    label="Node.js entry script"
                    onChange={(file) => setFile('script', file)}
                    required
                  />
                </div>
                <div className="col-lg-4">
                  <FilePicker
                    accept=".json,application/json"
                    file={files.descriptor}
                    help={`Optional · analyzed for prefill, then discarded · max ${formatBytes(uploadPolicy?.descriptor?.maximumBytes)}`}
                    id="tool-descriptor-upload"
                    label="Onboarding descriptor (not retained)"
                    onChange={(file) => setFile('descriptor', file)}
                  />
                </div>
                <div className="col-lg-4">
                  <FilePicker
                    accept=".json,application/json"
                    file={files.schema}
                    help={`Optional · promoted to packages/tools/contracts · max ${formatBytes(uploadPolicy?.schema?.maximumBytes)}`}
                    id="tool-schema-upload"
                    label="Output schema"
                    onChange={(file) => setFile('schema', file)}
                  />
                </div>
              </div>
              <div className="small sky-muted mt-3">
                Selected payload: {formatBytes(selectedBytes)} · Staging retention:{' '}
                {uploadPolicy?.sessionTtlHours || 24} hours
              </div>
            </div>
          </Panel>
        )}

        {analysis && !registration && (
          <>
            <Panel
              subtitle="Errors block registration. Warnings are advisory. Informational findings document what SkyCommand observed."
              title="Static analysis findings"
            >
              <div className="sky-card-body">
                <div className="row g-3 mb-3">
                  {['error', 'warning', 'info'].map((key) => (
                    <div className="col-4" key={key}>
                      <div className="sky-stat-card h-100">
                        <div className="small sky-muted text-capitalize">{key}</div>
                        <div className="h4 mb-0">{analysis.summary?.[key] || 0}</div>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="d-flex flex-column gap-2">
                  {(analysis.findings || []).map((finding, index) => (
                    <div className="border rounded p-3" key={`${finding.code}-${index}`}>
                      <div className="d-flex flex-wrap gap-2 align-items-center mb-1">
                        <StatusPill label={finding.severity} status={finding.severity} />
                        <strong>{finding.code}</strong>
                        {finding.confidence && (
                          <span className="small sky-muted">Confidence: {finding.confidence}</span>
                        )}
                      </div>
                      <div>{finding.message}</div>
                    </div>
                  ))}
                </div>
              </div>
            </Panel>

            {form && (
              <Panel
                actions={
                  <button
                    className="btn btn-primary btn-sm"
                    disabled={!canPreview}
                    onClick={refreshPreview}
                    type="button"
                  >
                    {previewing ? 'Building preview…' : 'Build registration preview'}
                  </button>
                }
                subtitle="Descriptor and source-analysis suggestions are editable. PostgreSQL catalogue values below become authoritative after registration."
                title="Tool configuration"
              >
                <div className="sky-card-body">
                  {!analysis.summary?.canContinue && (
                    <div className="alert alert-danger">
                      Correct the blocking files and upload them again before registration can
                      continue.
                    </div>
                  )}
                  <div className="row g-3">
                    <div className="col-md-4">
                      <label className="form-label" htmlFor="onboard-tool-code">
                        Tool code
                      </label>
                      <input
                        className="form-control"
                        id="onboard-tool-code"
                        onChange={(e) => updateForm('toolCode', e.target.value)}
                        value={form.toolCode}
                      />
                    </div>
                    <div className="col-12">
                      <label className="form-label" htmlFor="onboard-package-path">
                        Package destination
                      </label>
                      <input
                        className="form-control font-monospace"
                        id="onboard-package-path"
                        onChange={(e) => updateForm('packageRelativePath', e.target.value)}
                        placeholder="packages/tools/custom/example_tool"
                        value={form.packageRelativePath}
                      />
                      <div className="small sky-muted mt-1">
                        Choose any new directory inside packages. The default remains
                        packages/tools/custom/&lt;toolCode&gt;.
                      </div>
                    </div>
                    <div className="col-12">
                      <label className="form-label" htmlFor="onboard-entrypoint-path">
                        Entrypoint inside package
                      </label>
                      <input
                        className="form-control font-monospace"
                        id="onboard-entrypoint-path"
                        onChange={(e) => updateForm('entrypointRelativePath', e.target.value)}
                        placeholder="src/example_tool.js"
                        value={form.entrypointRelativePath}
                      />
                      <div className="small sky-muted mt-1">
                        Keep the script inside the package src folder. Its filename must match the
                        uploaded script filename.
                      </div>
                    </div>
                    <div className="col-md-4">
                      <label className="form-label" htmlFor="onboard-name">
                        Internal name
                      </label>
                      <input
                        className="form-control"
                        id="onboard-name"
                        onChange={(e) => updateForm('name', e.target.value)}
                        value={form.name}
                      />
                    </div>
                    <div className="col-md-4">
                      <label className="form-label" htmlFor="onboard-label">
                        Display label
                      </label>
                      <input
                        className="form-control"
                        id="onboard-label"
                        onChange={(e) => updateForm('label', e.target.value)}
                        value={form.label}
                      />
                    </div>
                    <div className="col-12">
                      <label className="form-label" htmlFor="onboard-description">
                        Description
                      </label>
                      <textarea
                        className="form-control"
                        id="onboard-description"
                        onChange={(e) => updateForm('description', e.target.value)}
                        rows="2"
                        value={form.description}
                      />
                    </div>
                    <div className="col-md-3">
                      <label className="form-label" htmlFor="onboard-category">
                        Category
                      </label>
                      <select
                        className="form-select"
                        id="onboard-category"
                        onChange={(e) => updateForm('categoryId', e.target.value)}
                        value={form.categoryId}
                      >
                        {(catalogueOptions.categories || []).map((item) => (
                          <option key={item.categoryId} value={item.categoryId}>
                            {item.label}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="col-md-3">
                      <label className="form-label" htmlFor="onboard-runtime">
                        Runtime
                      </label>
                      <input
                        className="form-control"
                        disabled
                        id="onboard-runtime"
                        value="Node.js (node)"
                      />
                    </div>
                    <div className="col-md-3">
                      <label className="form-label" htmlFor="onboard-permission">
                        Permission
                      </label>
                      <select
                        className="form-select"
                        id="onboard-permission"
                        onChange={(e) => updateForm('permissionCode', e.target.value)}
                        value={form.permissionCode}
                      >
                        <option value="">No tool-specific permission</option>
                        {(catalogueOptions.permissions || []).map((item) => (
                          <option key={item.permissionCode} value={item.permissionCode}>
                            {item.permissionCode}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="col-md-3">
                      <label className="form-label" htmlFor="onboard-risk">
                        Risk
                      </label>
                      <select
                        className="form-select"
                        id="onboard-risk"
                        onChange={(e) => updateForm('riskCode', e.target.value)}
                        value={form.riskCode}
                      >
                        {(catalogueOptions.risks || []).map((item) => (
                          <option key={item.riskCode} value={item.riskCode}>
                            {item.riskName}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="col-md-4">
                      <label className="form-label" htmlFor="onboard-output-type">
                        Structured output type
                      </label>
                      <input
                        className="form-control"
                        id="onboard-output-type"
                        onChange={(e) => updateForm('outputType', e.target.value)}
                        placeholder="example_summary.v1"
                        value={form.outputType}
                      />
                    </div>
                    <div className="col-md-2">
                      <label className="form-label" htmlFor="onboard-order">
                        Display order
                      </label>
                      <input
                        className="form-control"
                        id="onboard-order"
                        min="0"
                        onChange={(e) => updateForm('displayOrder', e.target.value)}
                        type="number"
                        value={form.displayOrder}
                      />
                    </div>
                    <div className="col-md-6 d-flex flex-wrap align-items-end gap-3 pb-2">
                      <label className="form-check">
                        <input
                          checked={form.capturesOutput}
                          className="form-check-input"
                          onChange={(e) => updateForm('capturesOutput', e.target.checked)}
                          type="checkbox"
                        />
                        <span className="form-check-label">Capture output</span>
                      </label>
                      <label className="form-check">
                        <input
                          checked={form.requiresConfirmation}
                          className="form-check-input"
                          onChange={(e) => updateForm('requiresConfirmation', e.target.checked)}
                          type="checkbox"
                        />
                        <span className="form-check-label">Confirmation required</span>
                      </label>
                    </div>
                    {form.requiresConfirmation && (
                      <div className="col-12">
                        <label className="form-label" htmlFor="onboard-confirmation">
                          Confirmation text
                        </label>
                        <input
                          className="form-control"
                          id="onboard-confirmation"
                          onChange={(e) => updateForm('confirmationText', e.target.value)}
                          value={form.confirmationText}
                        />
                      </div>
                    )}

                    {getCategoryKind(catalogueOptions, form.categoryId) === 'INGESTION' && (
                      <IngestionProfileEditor
                        onChange={updateIngestionProfile}
                        options={catalogueOptions}
                        profile={form.ingestionProfile}
                      />
                    )}
                  </div>

                  <h3 className="h6 mt-4">Visibility</h3>
                  <div className="d-flex flex-wrap gap-3">
                    {(catalogueOptions.visibilityChannels || []).map((channel) => (
                      <label className="form-check" key={channel.channelCode}>
                        <input
                          checked={form.visibility.includes(channel.channelCode)}
                          className="form-check-input"
                          onChange={() => toggleVisibility(channel.channelCode)}
                          type="checkbox"
                        />
                        <span className="form-check-label">{channel.channelName}</span>
                      </label>
                    ))}
                  </div>

                  <div className="d-flex justify-content-between align-items-center mt-4 mb-2">
                    <h3 className="h6 mb-0">Positional parameters</h3>
                    <button
                      className="btn btn-outline-secondary btn-sm"
                      onClick={addParameter}
                      type="button"
                    >
                      Add parameter
                    </button>
                  </div>
                  {form.parameters.length === 0 ? (
                    <div className="sky-muted">No positional parameters configured.</div>
                  ) : (
                    <div className="d-flex flex-column gap-3">
                      {form.parameters.map((parameter, index) => (
                        <div
                          className="border rounded p-3"
                          key={`${index}-${parameter.parameterName}`}
                        >
                          <div className="d-flex justify-content-between gap-2 mb-3">
                            <strong>Parameter {index + 1}</strong>
                            <button
                              className="btn btn-outline-danger btn-sm"
                              onClick={() => removeParameter(index)}
                              type="button"
                            >
                              Remove
                            </button>
                          </div>
                          <div className="row g-3">
                            <div className="col-md-3">
                              <label className="form-label">Name</label>
                              <input
                                className="form-control"
                                onChange={(e) =>
                                  updateParameter(index, 'parameterName', e.target.value)
                                }
                                value={parameter.parameterName}
                              />
                            </div>
                            <div className="col-md-3">
                              <label className="form-label">Label</label>
                              <input
                                className="form-control"
                                onChange={(e) => updateParameter(index, 'label', e.target.value)}
                                value={parameter.label}
                              />
                            </div>
                            <div className="col-md-2">
                              <label className="form-label">Type</label>
                              <select
                                className="form-select"
                                onChange={(e) =>
                                  updateParameter(index, 'paramTypeCode', e.target.value)
                                }
                                value={parameter.paramTypeCode}
                              >
                                {(catalogueOptions.paramTypes || []).map((item) => (
                                  <option key={item.paramTypeCode} value={item.paramTypeCode}>
                                    {item.paramTypeName}
                                  </option>
                                ))}
                              </select>
                            </div>
                            <div className="col-md-2">
                              <label className="form-label">Position</label>
                              <input
                                className="form-control"
                                min="1"
                                onChange={(e) =>
                                  updateParameter(index, 'displayOrder', e.target.value)
                                }
                                type="number"
                                value={parameter.displayOrder}
                              />
                            </div>
                            <div className="col-md-2 d-flex align-items-end pb-2">
                              <label className="form-check">
                                <input
                                  checked={parameter.required}
                                  className="form-check-input"
                                  onChange={(e) =>
                                    updateParameter(index, 'required', e.target.checked)
                                  }
                                  type="checkbox"
                                />
                                <span className="form-check-label">Required</span>
                              </label>
                            </div>
                            <div className="col-md-6">
                              <label className="form-label">Prompt</label>
                              <input
                                className="form-control"
                                onChange={(e) => updateParameter(index, 'prompt', e.target.value)}
                                value={parameter.prompt}
                              />
                            </div>
                            <div className="col-md-3">
                              <label className="form-label">Default</label>
                              <input
                                className="form-control"
                                onChange={(e) =>
                                  updateParameter(index, 'defaultValue', e.target.value)
                                }
                                value={parameter.defaultValue}
                              />
                            </div>
                            <div className="col-md-3">
                              <label className="form-label">Option source</label>
                              <select
                                className="form-select"
                                onChange={(e) =>
                                  updateParameter(index, 'optionSourceCode', e.target.value)
                                }
                                value={parameter.optionSourceCode}
                              >
                                <option value="">Static / none</option>
                                {(catalogueOptions.optionSources || []).map((item) => (
                                  <option key={item.optionSourceCode} value={item.optionSourceCode}>
                                    {item.optionSourceName}
                                  </option>
                                ))}
                              </select>
                            </div>
                            {!parameter.optionSourceCode &&
                              parameter.paramTypeCode === 'select' && (
                                <div className="col-12">
                                  <label className="form-label">Static choices</label>
                                  <textarea
                                    className="form-control font-monospace"
                                    onChange={(e) =>
                                      updateParameter(index, 'optionText', e.target.value)
                                    }
                                    placeholder="Label=value"
                                    rows="3"
                                    value={parameter.optionText}
                                  />
                                </div>
                              )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </Panel>
            )}

            {preview && (
              <Panel
                actions={
                  <button
                    className="btn btn-success btn-sm"
                    disabled={!canRegister}
                    onClick={registerPackage}
                    type="button"
                  >
                    {registering ? 'Registering…' : 'Register disabled tool'}
                  </button>
                }
                subtitle="This is the current server-resolved plan. Preview and file hashes are registration evidence only; they never restrict later tool execution."
                title="Registration preview"
              >
                <div className="sky-card-body">
                  <div className="d-flex flex-wrap gap-2 align-items-center mb-3">
                    <StatusPill status={preview.status} />
                    <span className="small sky-muted">
                      Preview evidence captured for this registration request only
                    </span>
                  </div>
                  {(preview.blockers || []).map((blocker) => (
                    <div className="alert alert-danger" key={blocker.code}>
                      <strong>{blocker.code}</strong>
                      <div>{blocker.message}</div>
                    </div>
                  ))}
                  <div className="row g-3">
                    <div className="col-xl-6">
                      <h3 className="h6">Resolved command</h3>
                      <pre className="border rounded p-3 text-wrap mb-0">
                        {preview.commandPreview?.display}
                      </pre>
                    </div>
                    <div className="col-xl-6">
                      <h3 className="h6">Managed package</h3>
                      <div className="border rounded p-3 text-break">
                        <div>
                          <strong>Repository:</strong> {readiness?.repository?.repoName}
                        </div>
                        <div>
                          <strong>Package:</strong> {preview.paths?.packageRelativePath}
                        </div>
                        <div>
                          <strong>Physical:</strong> {preview.paths?.packagePhysicalPath}
                        </div>
                        <div>
                          <strong>Entrypoint:</strong> {preview.paths?.entrypointRelativePath}
                        </div>
                        {preview.paths?.outputSchemaPath && (
                          <div>
                            <strong>Central contract:</strong> {preview.paths.outputSchemaPath}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                  <h3 className="h6 mt-4">Files to promote</h3>
                  <div className="table-responsive">
                    <table className="table table-sm">
                      <thead>
                        <tr>
                          <th>Kind</th>
                          <th>Action</th>
                          <th>Final path</th>
                          <th>SHA-256 evidence (registration only)</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(preview.files || []).map((file) => (
                          <tr key={file.kind}>
                            <td>
                              {file.kind}
                              {file.generated ? ' (generated)' : ''}
                            </td>
                            <td>{file.action || 'PROMOTE'}</td>
                            <td className="text-break">{file.relativePath}</td>
                            <td className="font-monospace text-break">{file.sha256}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {(preview.onboardingInputs || []).length > 0 && (
                    <>
                      <h3 className="h6 mt-4">Onboarding inputs not retained</h3>
                      <div className="table-responsive">
                        <table className="table table-sm">
                          <thead>
                            <tr>
                              <th>Kind</th>
                              <th>Filename</th>
                              <th>Purpose</th>
                              <th>SHA-256 evidence (registration only)</th>
                            </tr>
                          </thead>
                          <tbody>
                            {preview.onboardingInputs.map((file) => (
                              <tr key={`${file.kind}-${file.filename}`}>
                                <td>{file.kind}</td>
                                <td>{file.filename}</td>
                                <td>{file.purpose}</td>
                                <td className="font-monospace text-break">{file.sha256}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </>
                  )}
                  <h3 className="h6 mt-4">PostgreSQL record</h3>
                  <div className="table-responsive">
                    <table className="table table-sm">
                      <tbody>
                        {Object.entries(preview.databasePreview?.tool || {}).map(([key, value]) => (
                          <tr key={key}>
                            <th>{key}</th>
                            <td className="text-break">{value === null ? '—' : String(value)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {preview.databasePreview?.ingestionProfile && (
                    <>
                      <h3 className="h6 mt-4">Portable ingestion profile</h3>
                      <pre className="sky-code-block mb-0">
                        {JSON.stringify(preview.databasePreview.ingestionProfile, null, 2)}
                      </pre>
                    </>
                  )}
                  <label className="form-check mt-3">
                    <input
                      checked={confirmRegistration}
                      className="form-check-input"
                      onChange={(e) => setConfirmRegistration(e.target.checked)}
                      type="checkbox"
                    />
                    <span className="form-check-label">
                      I understand that SkyCommand will write the implementation and optional central
                      contract shown above, discard the onboarding descriptor after registration, and
                      create a disabled catalogue record. Warnings are advisory, uploaded code is
                      not executed, and file hashes will not become runtime launch gates.
                    </span>
                  </label>
                </div>
              </Panel>
            )}
          </>
        )}

        {registration && (
          <Panel
            actions={
              <>
                <button
                  className="btn btn-outline-secondary btn-sm"
                  onClick={resetWorkbench}
                  type="button"
                >
                  Add another tool
                </button>
                <button
                  className="btn btn-primary btn-sm"
                  onClick={() =>
                    navigate(
                      `/tools/manage?toolId=${registration.tool?.toolId || ''}&view=verification`,
                    )
                  }
                  type="button"
                >
                  Open verification & test
                </button>
              </>
            }
            subtitle="The managed package and PostgreSQL configuration are now present, but the tool remains disabled until deliberate verification and enablement."
            title="Tool registered disabled"
          >
            <div className="sky-card-body">
              <div className="alert alert-success">
                <strong>{registration.tool?.label}</strong> was registered successfully as{' '}
                <span className="font-monospace">{registration.tool?.toolCode}</span>.
              </div>
              <div className="row g-3">
                <div className="col-md-4">
                  <div className="small sky-muted">Status</div>
                  <StatusPill status="DISABLED" />
                </div>
                <div className="col-md-4">
                  <div className="small sky-muted">Catalogue ID</div>
                  <div className="font-monospace text-break">{registration.tool?.toolId}</div>
                </div>
                <div className="col-md-4">
                  <div className="small sky-muted">Package</div>
                  <div className="text-break">{registration.paths?.packageRelativePath}</div>
                </div>
              </div>
              <div className="alert alert-info mt-3 mb-0">{registration.nextStep}</div>
            </div>
          </Panel>
        )}
      </div>
    </div>
  );
}

export default AddTool;
