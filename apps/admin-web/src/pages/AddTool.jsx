import { useEffect, useMemo, useState } from 'react';
import Panel from '../components/ui/Panel.jsx';
import StatusPill from '../components/ui/StatusPill.jsx';
import adminService from '../services/adminService.js';

const EMPTY_FILES = {
  script: null,
  descriptor: null,
  schema: null,
};

function formatBytes(value) {
  const bytes = Number(value || 0);

  if (bytes < 1024) {
    return `${bytes} B`;
  }

  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }

  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(value) {
  if (!value) {
    return '—';
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

function FilePicker({ accept, file, help, id, label, onChange, required = false }) {
  return (
    <div>
      <label className="form-label" htmlFor={id}>
        {label} {required && <span className="text-danger">*</span>}
      </label>
      <input
        accept={accept}
        className="form-control sky-tool-upload-input"
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

function AddTool() {
  const [options, setOptions] = useState(null);
  const [files, setFiles] = useState(EMPTY_FILES);
  const [analysis, setAnalysis] = useState(null);
  const [loading, setLoading] = useState(true);
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState('');

  const readiness = options?.readiness || null;
  const uploadPolicy = options?.uploadPolicy || null;
  const canAnalyze = Boolean(readiness?.ready && files.script && !analyzing);

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
        if (active) {
          setOptions(result);
        }
      } catch (loadError) {
        if (active) {
          setError(loadError.message || 'Failed to load tool onboarding options.');
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    loadOptions();

    return () => {
      active = false;
    };
  }, []);

  function setFile(kind, file) {
    setFiles((current) => ({ ...current, [kind]: file }));
    setAnalysis(null);
    setError('');
  }

  function resetWorkbench() {
    setFiles(EMPTY_FILES);
    setAnalysis(null);
    setError('');
    document.querySelectorAll('input.sky-tool-upload-input').forEach((input) => {
      input.value = '';
    });
  }

  async function serializeFile(file) {
    if (!file) {
      return null;
    }

    return {
      filename: file.name,
      content: await file.text(),
    };
  }

  async function analyzePackage() {
    if (!canAnalyze) {
      return;
    }

    setAnalyzing(true);
    setError('');
    setAnalysis(null);

    try {
      const payload = {
        script: await serializeFile(files.script),
        descriptor: await serializeFile(files.descriptor),
        schema: await serializeFile(files.schema),
      };
      const result = await adminService.analyzeToolOnboardingPackage(payload);
      setAnalysis(result);
    } catch (analysisError) {
      setError(analysisError.message || 'Tool package analysis failed.');
    } finally {
      setAnalyzing(false);
    }
  }

  return (
    <div className="sky-page-shell">
      <div className="sky-page-stack">
        <Panel
          kicker="TOOLS"
          subtitle="Stage and inspect one trusted Node.js entry script plus an optional onboarding descriptor and output schema. Static analysis never executes uploaded code."
          title="Add Tool"
        >
          <div className="sky-card-body d-flex flex-wrap gap-2 align-items-center justify-content-between">
            <div className="small sky-muted">
              Phase 15.4 performs upload staging and static analysis only. Configuration,
              registration, and execution remain disabled.
            </div>
            <StatusPill status={readiness?.ready ? 'READY' : 'BLOCKED'} />
          </div>
        </Panel>

        {error && <div className="alert alert-danger mb-0">{error}</div>}

        <Panel
          subtitle="The designated repository and active profile path must be ready before onboarding files can be staged."
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
                  <div className="small sky-muted">Managed root</div>
                  <div className="text-break">{readiness?.path?.managedToolsRoot || '—'}</div>
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
          subtitle="Files are copied to a bounded, non-executable onboarding session. No npm install, script execution, catalogue write, or Git operation occurs."
          title="Trusted upload workbench"
        >
          <div className="sky-card-body">
            <div className="alert alert-warning">
              <strong>Privileged code deployment boundary:</strong> static analysis can identify
              syntax, metadata, dependency, schema, and policy concerns, but it cannot prove
              arbitrary code harmless. Only trusted administrator-authored files belong here.
            </div>

            <div className="row g-3">
              <div className="col-lg-4">
                <div>
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
              </div>
              <div className="col-lg-4">
                <div>
                  <FilePicker
                    accept=".json,application/json"
                    file={files.descriptor}
                    help={`Optional · skycommand.tool.json · max ${formatBytes(uploadPolicy?.descriptor?.maximumBytes)}`}
                    id="tool-descriptor-upload"
                    label="Onboarding descriptor"
                    onChange={(file) => setFile('descriptor', file)}
                  />
                </div>
              </div>
              <div className="col-lg-4">
                <div>
                  <FilePicker
                    accept=".json,application/json"
                    file={files.schema}
                    help={`Optional · <outputType>.schema.json · max ${formatBytes(uploadPolicy?.schema?.maximumBytes)}`}
                    id="tool-schema-upload"
                    label="Output schema"
                    onChange={(file) => setFile('schema', file)}
                  />
                </div>
              </div>
            </div>

            <div className="small sky-muted mt-3">
              Selected payload: {formatBytes(selectedBytes)} /{' '}
              {formatBytes(uploadPolicy?.maximumTotalBytes)} · Staging retention:{' '}
              {uploadPolicy?.sessionTtlHours || 24} hours
            </div>
          </div>
        </Panel>

        {analysis && (
          <>
            <Panel
              actions={<StatusPill status={analysis.summary?.status || 'UNKNOWN'} />}
              subtitle="Errors block the next phase. Warnings require administrator review. Informational findings document what SkyCommand detected."
              title="Static analysis result"
            >
              <div className="sky-card-body">
                <div className="row g-3 mb-3">
                  <div className="col-6 col-lg-3">
                    <div className="sky-stat-card h-100">
                      <div className="small sky-muted">Errors</div>
                      <div className="h4 mb-0">{analysis.summary?.error || 0}</div>
                    </div>
                  </div>
                  <div className="col-6 col-lg-3">
                    <div className="sky-stat-card h-100">
                      <div className="small sky-muted">Warnings</div>
                      <div className="h4 mb-0">{analysis.summary?.warning || 0}</div>
                    </div>
                  </div>
                  <div className="col-6 col-lg-3">
                    <div className="sky-stat-card h-100">
                      <div className="small sky-muted">Information</div>
                      <div className="h4 mb-0">{analysis.summary?.info || 0}</div>
                    </div>
                  </div>
                  <div className="col-6 col-lg-3">
                    <div className="sky-stat-card h-100">
                      <div className="small sky-muted">Continue</div>
                      <div className="h4 mb-0">{analysis.summary?.canContinue ? 'Yes' : 'No'}</div>
                    </div>
                  </div>
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
                      {(finding.filename || finding.dependency || finding.location) && (
                        <div className="small sky-muted mt-1">
                          {[finding.filename, finding.dependency, finding.location]
                            .filter(Boolean)
                            .join(' · ')}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </Panel>

            <div className="row g-3">
              <div className="col-xl-7">
                <Panel
                  subtitle="These values come from the descriptor when available and otherwise from conservative source analysis. They are suggestions, not catalogue decisions."
                  title="Configuration suggestions"
                >
                  <div className="sky-card-body">
                    <div className="table-responsive">
                      <table className="table table-sm align-middle mb-0">
                        <tbody>
                          <tr>
                            <th>Tool code</th>
                            <td>{analysis.suggestions?.toolCode || 'Not inferred'}</td>
                          </tr>
                          <tr>
                            <th>Label</th>
                            <td>{analysis.suggestions?.label || 'Not inferred'}</td>
                          </tr>
                          <tr>
                            <th>Runtime</th>
                            <td>{analysis.suggestions?.runtimeCode || 'node'}</td>
                          </tr>
                          <tr>
                            <th>Category</th>
                            <td>
                              {analysis.suggestions?.categoryCode ||
                                'Administrator review required'}
                            </td>
                          </tr>
                          <tr>
                            <th>Permission</th>
                            <td>
                              {analysis.suggestions?.permissionCode ||
                                'Administrator review required'}
                            </td>
                          </tr>
                          <tr>
                            <th>Risk</th>
                            <td>
                              {analysis.suggestions?.riskCode || 'Administrator review required'}
                            </td>
                          </tr>
                          <tr>
                            <th>Output type</th>
                            <td>
                              {analysis.suggestions?.outputType || 'No structured output inferred'}
                            </td>
                          </tr>
                          <tr>
                            <th>Destination</th>
                            <td className="text-break">
                              {analysis.suggestions?.destinationRelativePath ||
                                'Tool code required'}
                            </td>
                          </tr>
                        </tbody>
                      </table>
                    </div>

                    <h3 className="h6 mt-4">Positional parameters</h3>
                    {(analysis.suggestions?.parameters || []).length === 0 ? (
                      <div className="sky-muted">
                        No positional parameters were declared or inferred.
                      </div>
                    ) : (
                      <div className="table-responsive">
                        <table className="table table-sm align-middle mb-0">
                          <thead>
                            <tr>
                              <th>Position</th>
                              <th>Name</th>
                              <th>Type</th>
                              <th>Required</th>
                              <th>Source</th>
                            </tr>
                          </thead>
                          <tbody>
                            {analysis.suggestions.parameters.map((parameter) => (
                              <tr key={`${parameter.position}-${parameter.name}`}>
                                <td>{parameter.position}</td>
                                <td>{parameter.name}</td>
                                <td>{parameter.type}</td>
                                <td>{parameter.required ? 'Yes' : 'No'}</td>
                                <td>{parameter.source}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                </Panel>
              </div>

              <div className="col-xl-5">
                <Panel
                  subtitle="The staged source is retained only for the bounded onboarding session. Hashes are audit evidence, never runtime launch gates."
                  title="Staging session"
                >
                  <div className="sky-card-body">
                    <div className="mb-3">
                      <div className="small sky-muted">Session</div>
                      <div className="font-monospace text-break">{analysis.session?.sessionId}</div>
                    </div>
                    <div className="row g-3 mb-3">
                      <div className="col-6">
                        <div className="small sky-muted">Created</div>
                        <div>{formatDate(analysis.session?.createdAt)}</div>
                      </div>
                      <div className="col-6">
                        <div className="small sky-muted">Expires</div>
                        <div>{formatDate(analysis.session?.expiresAt)}</div>
                      </div>
                    </div>
                    <div className="d-flex flex-column gap-2">
                      {(analysis.session?.files || []).map((file) => (
                        <div className="border rounded p-2" key={file.kind}>
                          <div className="d-flex justify-content-between gap-2">
                            <strong>{file.filename}</strong>
                            <span className="small sky-muted">{formatBytes(file.sizeBytes)}</span>
                          </div>
                          <div className="small sky-muted font-monospace text-break">
                            SHA-256 {file.sha256}
                          </div>
                        </div>
                      ))}
                    </div>
                    <div className="alert alert-info mt-3 mb-0">
                      Phase 15.5 will turn a clean session into an editable catalogue and
                      destination preview. This page cannot register or execute the uploaded script.
                    </div>
                  </div>
                </Panel>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default AddTool;
