function getSafeArray(value) {
  return Array.isArray(value) ? value : [];
}

function getSafeObject(value, fallback = {}) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : fallback;
}

function formatDate(value) {
  if (!value) {
    return '—';
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return '—';
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

function formatDuration(ms) {
  const value = Number(ms);

  if (!Number.isFinite(value)) {
    return '—';
  }

  if (value < 1000) {
    return `${value} ms`;
  }

  return `${(value / 1000).toFixed(1)} s`;
}

function humanizeOutputKey(value) {
  const label = String(value || '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!label) {
    return 'Value';
  }

  return label
    .split(' ')
    .map((word) => {
      const normalized = word.toLowerCase();
      const acronym = {
        api: 'API',
        http: 'HTTP',
        https: 'HTTPS',
        id: 'ID',
        ids: 'IDs',
        json: 'JSON',
        ms: 'ms',
        url: 'URL',
        ui: 'UI',
        stdout: 'Standard output',
        stderr: 'Error output',
      }[normalized];

      return acronym || `${word.charAt(0).toUpperCase()}${word.slice(1)}`;
    })
    .join(' ');
}

function isIsoDateValue(value) {
  return (
    typeof value === 'string' &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value) &&
    !Number.isNaN(new Date(value).getTime())
  );
}

function formatByteCount(value) {
  const bytes = Number(value);

  if (!Number.isFinite(bytes)) {
    return String(value ?? '—');
  }

  if (bytes < 1024) {
    return `${bytes.toLocaleString()} B`;
  }

  const units = ['KB', 'MB', 'GB', 'TB'];
  let scaled = bytes / 1024;
  let unitIndex = 0;

  while (scaled >= 1024 && unitIndex < units.length - 1) {
    scaled /= 1024;
    unitIndex += 1;
  }

  return `${scaled.toFixed(scaled >= 10 ? 1 : 2)} ${units[unitIndex]}`;
}

function formatTelemetryShare(durationMs, totalMs) {
  const duration = Number(durationMs);
  const total = Number(totalMs);

  if (!Number.isFinite(duration) || !Number.isFinite(total) || total <= 0) {
    return '—';
  }

  return `${((duration / total) * 100).toFixed(1)}%`;
}

export function PerformanceTelemetryTable({
  telemetry,
  title = 'Performance telemetry',
  note = 'Instrumented total covers tool internals. Workflow node duration can also include process-wrapper, structured-result transport, and orchestration overhead.',
}) {
  const data = getSafeObject(telemetry);
  const phases = getSafeArray(data.phases);
  const instrumentedTotalMs = Number(data.instrumentedTotalMs);

  if (phases.length === 0 || !Number.isFinite(instrumentedTotalMs)) {
    return null;
  }

  return (
    <>
      <div className="sky-page-kicker mb-2">{title}</div>
      <div className="table-responsive sky-table-card">
        <table className="table table-sm sky-table align-middle mb-0">
          <thead>
            <tr>
              <th>Phase</th>
              <th>Duration</th>
              <th>Share of instrumented total</th>
            </tr>
          </thead>
          <tbody>
            {phases.map((phase, index) => (
              <tr key={`${phase?.code || phase?.label || 'phase'}-${index}`}>
                <td>{phase?.label || humanizeOutputKey(phase?.code)}</td>
                <td>{formatDuration(phase?.durationMs)}</td>
                <td>{formatTelemetryShare(phase?.durationMs, instrumentedTotalMs)}</td>
              </tr>
            ))}
            <tr>
              <td className="fw-semibold">Instrumented total</td>
              <td className="fw-semibold">{formatDuration(instrumentedTotalMs)}</td>
              <td className="fw-semibold">100.0%</td>
            </tr>
          </tbody>
        </table>
      </div>
      <div className="small sky-muted mt-2 mb-3">{note}</div>
    </>
  );
}

export function MacroIngestionWorkloadTelemetryTable({ telemetry }) {
  const data = getSafeObject(telemetry);
  const workload = getSafeObject(data.workloadBreakdown);
  const cumulative = getSafeObject(workload.cumulativeStageMs);
  const slowestIndicators = getSafeArray(workload.slowestIndicators);
  const cumulativeRows = [
    ['Source fetch / download', cumulative.fetchMs],
    ['Normalization', cumulative.normalizeMs],
    ['Database / quality-aware load', cumulative.loadMs],
    ['Per-indicator temp cleanup', cumulative.cleanupMs],
  ].filter(([, value]) => Number.isFinite(Number(value)));
  const cumulativeTotalMs = cumulativeRows.reduce((sum, [, value]) => sum + Number(value || 0), 0);
  const hasWorkload = getSafeArray(workload.phases).length > 0
    || cumulativeRows.length > 0
    || slowestIndicators.length > 0;

  if (!hasWorkload) return null;

  return (
    <>
      <PerformanceTelemetryTable
        telemetry={workload}
        title="Source workload telemetry"
        note="Workload total is wall-clock time inside the source adapter. Batch execution overlaps indicator work according to the configured concurrency."
      />

      <div className="d-flex flex-wrap align-items-center justify-content-between gap-2 mb-2">
        <div className="sky-page-kicker">Cumulative indicator stage time</div>
        <div className="d-flex flex-wrap gap-2">
          <span className="sky-pill sky-pill-info">Concurrency {Number(workload.concurrency || 0)}</span>
          <span className="sky-pill sky-pill-info">{Number(workload.batchCount || 0)} batch(es)</span>
        </div>
      </div>
      <div className="table-responsive sky-table-card mb-3">
        <table className="table table-sm sky-table align-middle mb-0">
          <thead>
            <tr>
              <th>Indicator stage</th>
              <th>Cumulative worker time</th>
              <th>Share of cumulative stage time</th>
            </tr>
          </thead>
          <tbody>
            {cumulativeRows.map(([label, value]) => (
              <tr key={label}>
                <td>{label}</td>
                <td>{formatDuration(value)}</td>
                <td>{formatTelemetryShare(value, cumulativeTotalMs)}</td>
              </tr>
            ))}
            <tr>
              <td className="fw-semibold">Cumulative stage total</td>
              <td className="fw-semibold">{formatDuration(cumulativeTotalMs)}</td>
              <td className="fw-semibold">100.0%</td>
            </tr>
          </tbody>
        </table>
      </div>
      <div className="small sky-muted mb-3">
        Cumulative worker time intentionally adds overlapping indicator work, so it can exceed wall-clock duration. It shows where concurrent ingestion workers spend their time.
      </div>

      {slowestIndicators.length > 0 ? (
        <>
          <div className="sky-page-kicker mb-2">Slowest indicators</div>
          <div className="table-responsive sky-table-card mb-3">
            <table className="table table-sm sky-table align-middle mb-0">
              <thead>
                <tr>
                  <th>Indicator</th>
                  <th>Total</th>
                  <th>Fetch</th>
                  <th>Normalize</th>
                  <th>Load</th>
                  <th>Cleanup</th>
                </tr>
              </thead>
              <tbody>
                {slowestIndicators.map((indicator, index) => (
                  <tr key={`${indicator?.indicatorCode || 'indicator'}-${index}`}>
                    <td className="fw-semibold sky-mono">{indicator?.indicatorCode || '—'}</td>
                    <td>{formatDuration(indicator?.durationMs)}</td>
                    <td>{formatDuration(indicator?.fetchMs)}</td>
                    <td>{formatDuration(indicator?.normalizeMs)}</td>
                    <td>{formatDuration(indicator?.loadMs)}</td>
                    <td>{formatDuration(indicator?.cleanupMs)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : null}
    </>
  );
}

export function TransportTelemetryTable({ telemetry }) {
  return (
    <PerformanceTelemetryTable
      telemetry={telemetry}
      title="Transport / dispatch telemetry"
      note="Instrumented total covers the Docker-to-Host-Agent Temporal dispatch envelope, including client setup, connection, workflow wait, and connection shutdown. Compare it with the host tool telemetry and workflow node duration to isolate wrapper overhead."
    />
  );
}

export function ProcessEnvelopeTelemetryTable({ toolResult }) {
  const metadata = getSafeObject(toolResult?.metadata);
  const telemetry = getSafeObject(metadata.processEnvelopeTelemetry);
  const rows = [
    ['Child process wall clock', telemetry.childProcessDurationMs],
    ['Process start → transport start', telemetry.processStartToTransportStartMs],
    ['Transport instrumented total', telemetry.transportInstrumentedTotalMs],
    ['Transport complete → process close', telemetry.transportCompleteToProcessCloseMs],
    ['Uninstrumented process envelope', telemetry.uninstrumentedProcessEnvelopeMs],
  ].filter(([, value]) => Number.isFinite(Number(value)));

  if (rows.length === 0) return null;

  return (
    <>
      <div className="sky-page-kicker mb-2">Process envelope telemetry</div>
      <div className="table-responsive sky-table-card">
        <table className="table table-sm sky-table align-middle mb-0">
          <thead>
            <tr>
              <th>Phase</th>
              <th>Duration</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([label, value]) => (
              <tr key={label}>
                <td>{label}</td>
                <td>{formatDuration(value)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="small sky-muted mt-2 mb-3">
        Child-process timing is measured by the SkyCommand process wrapper. The pre/post rows isolate
        startup and shutdown time outside the instrumented Host Agent transport envelope.
      </div>
    </>
  );
}

export function ArchiveBuildBreakdownTable({ telemetry }) {
  const data = getSafeObject(telemetry);
  const breakdown = getSafeObject(data.archiveBuildBreakdown);
  const phases = getSafeArray(breakdown.phases);
  const archiveBuildDurationMs = Number(breakdown.durationMs);

  if (phases.length === 0 || !Number.isFinite(archiveBuildDurationMs)) {
    return null;
  }

  return (
    <>
      <div className="sky-page-kicker mb-2">Archive build breakdown</div>
      <div className="table-responsive sky-table-card">
        <table className="table table-sm sky-table align-middle mb-0">
          <thead>
            <tr>
              <th>Archive phase</th>
              <th>Duration</th>
              <th>Share of archive build</th>
            </tr>
          </thead>
          <tbody>
            {phases.map((phase, index) => (
              <tr key={`${phase?.code || phase?.label || 'archive-phase'}-${index}`}>
                <td>{phase?.label || humanizeOutputKey(phase?.code)}</td>
                <td>{formatDuration(phase?.durationMs)}</td>
                <td>{formatTelemetryShare(phase?.durationMs, archiveBuildDurationMs)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="small sky-muted mt-2 mb-3">
        Source stat/read work uses bounded asynchronous batches
        {Number.isFinite(Number(breakdown.ioConcurrency))
          ? ` (${Number(breakdown.ioConcurrency).toLocaleString()} concurrent files)`
          : ''}
        . Source size is accumulated from the bytes already read for the archive, so no second
        filesystem statistics pass is required.
      </div>
    </>
  );
}

function FriendlyOutputScalar({ fieldKey = '', value }) {
  const normalizedKey = String(fieldKey || '').toLowerCase();

  if (value === null || value === undefined || value === '') {
    return <span className="sky-muted">—</span>;
  }

  if (typeof value === 'boolean') {
    return (
      <span className={`sky-pill ${value ? 'sky-pill-success' : 'sky-pill-info'}`}>
        {value ? 'Yes' : 'No'}
      </span>
    );
  }

  if (typeof value === 'number') {
    if (normalizedKey.endsWith('ms') || normalizedKey.includes('duration')) {
      return <span>{formatDuration(value)}</span>;
    }

    if (normalizedKey.includes('byte')) {
      return <span>{formatByteCount(value)}</span>;
    }

    return <span>{value.toLocaleString()}</span>;
  }

  const text = String(value);

  if (isIsoDateValue(text) || normalizedKey.endsWith('at') || normalizedKey.includes('timestamp')) {
    const formatted = formatDate(text);

    if (formatted !== '—') {
      return <span>{formatted}</span>;
    }
  }

  if (normalizedKey === 'status' || normalizedKey.endsWith('status')) {
    return <span className={`sky-pill ${statusClass(text)}`}>{text}</span>;
  }

  if (/^https?:\/\//i.test(text)) {
    return (
      <a href={text} rel="noreferrer" target="_blank">
        {text}
      </a>
    );
  }

  if (text.includes('\n') || text.length > 180) {
    return <pre className="sky-node-output-readable-text mb-0">{text}</pre>;
  }

  const mono =
    normalizedKey.endsWith('id') ||
    normalizedKey.endsWith('key') ||
    normalizedKey.endsWith('code') ||
    normalizedKey.includes('hash') ||
    normalizedKey.includes('path');

  return <span className={mono ? 'sky-mono' : undefined}>{text}</span>;
}

function macroOutcomeClass(outcome) {
  const normalized = String(outcome || '').toUpperCase();

  if (normalized === 'UPDATED') {
    return 'sky-pill-success';
  }

  if (normalized === 'FAILED') {
    return 'sky-pill-danger';
  }

  if (normalized === 'PARTIAL') {
    return 'sky-pill-warning';
  }

  return 'sky-pill-info';
}

function operationOutcomeClass(outcome) {
  const normalized = String(outcome || '').toUpperCase();

  if (['FAILED', 'REJECTED', 'TIMED_OUT'].includes(normalized)) {
    return 'sky-pill-danger';
  }

  if (['PARTIAL', 'WARNING', 'STOPPED', 'BLOCKED', 'DIFFERENT', 'REMOTE_PROMOTED'].includes(normalized)) {
    return 'sky-pill-warning';
  }

  if (
    [
      'SUCCESS',
      'COMPLETED',
      'CREATED',
      'PUSHED',
      'APPROVED',
      'PROMOTED',
      'SYNCHRONIZED',
      'TAGGED',
      'READY',
      'MATCH',
      'BUILT',
      'ONLINE',
      'PASSED',
    ].includes(normalized)
  ) {
    return 'sky-pill-success';
  }

  return 'sky-pill-info';
}

function statusClass(status) {
  const normalized = String(status || '').toUpperCase();

  if (normalized === 'COMPLETED' || normalized === 'SUCCESS' || normalized === 'APPROVED') {
    return 'sky-pill-success';
  }

  if (
    normalized === 'FAILED' ||
    normalized === 'TERMINATED' ||
    normalized === 'REJECTED' ||
    normalized === 'TIMED_OUT'
  ) {
    return 'sky-pill-danger';
  }

  if (normalized === 'RUNNING' || normalized === 'QUEUED' || normalized === 'PENDING') {
    return 'sky-pill-warning';
  }

  return 'sky-pill-info';
}

function MacroIngestionOutput({ toolResult }) {
  const output = getSafeObject(toolResult?.output);
  const totals = getSafeObject(output.totals);
  const indicators = getSafeArray(output.indicators);
  const warnings = getSafeArray(toolResult?.warnings);
  const failedMessage = toolResult?.error?.message || null;

  return (
    <div className="sky-macro-ingestion-output">
      <div className="d-flex flex-wrap align-items-start justify-content-between gap-3 mb-3">
        <div>
          <div className="sky-page-kicker">Macro ingestion result</div>
          <h3 className="h6 mb-1">{output.sourceCode || 'Macro source'} update summary</h3>
          <p className="small sky-muted mb-0">
            {toolResult.message || 'Structured ingestion result recorded.'}
          </p>
        </div>
        <div className="d-flex flex-wrap gap-2">
          <span className={`sky-pill ${macroOutcomeClass(output.outcome)}`}>
            {output.outcome || 'UNKNOWN'}
          </span>
          <span className="sky-pill sky-pill-info">
            {output.selectedIndicators ? 'Selected indicators' : 'Full catalogue'}
          </span>
          <span className="sky-pill sky-pill-info">{formatDuration(output.durationMs)}</span>
        </div>
      </div>

      <div className="sky-page-kicker mb-2">Run totals</div>
      <div className="table-responsive sky-table-card mb-3">
        <table className="table table-sm sky-table align-middle mb-0">
          <thead>
            <tr>
              <th>Requested</th>
              <th>Succeeded</th>
              <th>Updated</th>
              <th>Unchanged</th>
              <th>Failed</th>
              <th>Rows staged</th>
              <th>New rows</th>
              <th>Rows inserted</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>{Number(totals.indicatorsRequested || 0).toLocaleString()}</td>
              <td>{Number(totals.indicatorsSucceeded || 0).toLocaleString()}</td>
              <td>{Number(totals.indicatorsUpdated || 0).toLocaleString()}</td>
              <td>{Number(totals.indicatorsUnchanged || 0).toLocaleString()}</td>
              <td>{Number(totals.indicatorsFailed || 0).toLocaleString()}</td>
              <td>{Number(totals.rowsStaged || 0).toLocaleString()}</td>
              <td>{Number(totals.rowsDetectedAsNew || 0).toLocaleString()}</td>
              <td className="fw-semibold">{Number(totals.rowsInserted || 0).toLocaleString()}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <PerformanceTelemetryTable telemetry={output.performanceTelemetry} />
      <MacroIngestionWorkloadTelemetryTable telemetry={output.performanceTelemetry} />

      <div className="d-flex flex-wrap align-items-center justify-content-between gap-2 mb-2">
        <div className="sky-page-kicker">Indicator results</div>
        <span className="sky-pill sky-pill-info">{indicators.length} indicator(s)</span>
      </div>

      {indicators.length === 0 ? (
        <div className="sky-empty-state">No indicator-level result records were emitted.</div>
      ) : (
        <div className="table-responsive sky-table-card sky-macro-ingestion-indicator-table">
          <table className="table table-sm sky-table align-middle mb-0">
            <thead>
              <tr>
                <th>Indicator</th>
                <th>Outcome</th>
                <th>Rows inserted</th>
                <th>New rows</th>
                <th>Staging rows</th>
                <th>Previous max</th>
                <th>Source max</th>
                <th>Current max</th>
                <th>Duration</th>
                <th>Error</th>
              </tr>
            </thead>
            <tbody>
              {indicators.map((indicator, index) => (
                <tr key={`${indicator.indicatorCode || 'indicator'}-${index}`}>
                  <td className="fw-semibold sky-mono">{indicator.indicatorCode || '—'}</td>
                  <td>
                    <span className={`sky-pill ${macroOutcomeClass(indicator.outcome)}`}>
                      {indicator.outcome || 'UNKNOWN'}
                    </span>
                  </td>
                  <td>{Number(indicator.rowsInserted || 0).toLocaleString()}</td>
                  <td>{Number(indicator.newRowsDetected || 0).toLocaleString()}</td>
                  <td>{Number(indicator.stagingRows || 0).toLocaleString()}</td>
                  <td>
                    <FriendlyOutputScalar
                      fieldKey="previousTargetMaxDate"
                      value={indicator.previousTargetMaxDate}
                    />
                  </td>
                  <td>
                    <FriendlyOutputScalar
                      fieldKey="sourceMaxDate"
                      value={indicator.sourceMaxDate}
                    />
                  </td>
                  <td>
                    <FriendlyOutputScalar
                      fieldKey="currentTargetMaxDate"
                      value={indicator.currentTargetMaxDate}
                    />
                  </td>
                  <td>{formatDuration(indicator.durationMs)}</td>
                  <td className="sky-macro-ingestion-error-cell">
                    {indicator.error?.message || '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {warnings.length > 0 || failedMessage ? (
        <div className="alert alert-warning mt-3 mb-0 py-2">
          {warnings.map((warning) => (
            <div key={warning}>{warning}</div>
          ))}
          {failedMessage ? <div>{failedMessage}</div> : null}
        </div>
      ) : null}
    </div>
  );
}

function RepositoryPackageOutput({ toolResult }) {
  const output = getSafeObject(toolResult?.output);
  const options = getSafeObject(output.options);
  const warnings = getSafeArray(toolResult?.warnings);
  const failedMessage = toolResult?.error?.message || null;
  const compressionPercent = Number.isFinite(Number(output.compressionRatio))
    ? `${(Number(output.compressionRatio) * 100).toFixed(1)}%`
    : '—';

  return (
    <div className="sky-repository-package-output">
      <div className="d-flex flex-wrap align-items-start justify-content-between gap-3 mb-3">
        <div>
          <div className="sky-page-kicker">Repository package result</div>
          <h3 className="h6 mb-1">{output.fileName || 'Repository archive'}</h3>
          <p className="small sky-muted mb-0">
            {toolResult.message || 'Structured repository package result recorded.'}
          </p>
        </div>
        <div className="d-flex flex-wrap gap-2">
          <span
            className={`sky-pill ${output.outcome === 'CREATED' ? 'sky-pill-success' : 'sky-pill-danger'}`}
          >
            {output.outcome || 'UNKNOWN'}
          </span>
          <span className="sky-pill sky-pill-info">{formatDuration(output.durationMs)}</span>
        </div>
      </div>

      <div className="sky-page-kicker mb-2">Artifact summary</div>
      <div className="table-responsive sky-table-card mb-3">
        <table className="table table-sm sky-table align-middle mb-0">
          <tbody>
            <tr>
              <th>Repository</th>
              <td>{output.repositoryName || '—'}</td>
              <th>Files included</th>
              <td>{Number(output.filesIncluded || 0).toLocaleString()}</td>
            </tr>
            <tr>
              <th>Source size</th>
              <td>{formatByteCount(output.sourceBytes)}</td>
              <th>Archive size</th>
              <td>{formatByteCount(output.archiveBytes)}</td>
            </tr>
            <tr>
              <th>Compression ratio</th>
              <td>{compressionPercent}</td>
              <th>Created</th>
              <td>
                <FriendlyOutputScalar fieldKey="completedAt" value={output.completedAt} />
              </td>
            </tr>
            <tr>
              <th>Archive path</th>
              <td colSpan="3" className="sky-mono text-break">
                {output.artifactPath || '—'}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <PerformanceTelemetryTable telemetry={output.performanceTelemetry} />
      <ArchiveBuildBreakdownTable telemetry={output.performanceTelemetry} />

      <div className="sky-page-kicker mb-2">Packaging policy</div>
      <div className="table-responsive sky-table-card">
        <table className="table table-sm sky-table align-middle mb-0">
          <thead>
            <tr>
              <th>Node modules</th>
              <th>Images</th>
              <th>Sensitive environment files</th>
              <th>Generated artifacts</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>{options.nodeModulesIncluded ? 'Included' : 'Excluded'}</td>
              <td>{options.imagesIncluded ? 'Included' : 'Excluded'}</td>
              <td>{options.sensitiveEnvironmentFilesExcluded ? 'Excluded' : 'Included'}</td>
              <td>{options.generatedArtifactsExcluded ? 'Excluded' : 'Included'}</td>
            </tr>
          </tbody>
        </table>
      </div>

      {warnings.length > 0 || failedMessage ? (
        <div className="alert alert-warning mt-3 mb-0 py-2">
          {warnings.map((warning) => (
            <div key={warning}>{warning}</div>
          ))}
          {failedMessage ? <div>{failedMessage}</div> : null}
        </div>
      ) : null}
    </div>
  );
}

function RepositoryMapOutput({ toolResult }) {
  const output = getSafeObject(toolResult?.output);
  const policy = getSafeObject(output.policy);
  const extensions = Object.entries(getSafeObject(output.extensionCounts)).sort(
    (a, b) => Number(b[1]) - Number(a[1]),
  );
  const warnings = getSafeArray(toolResult?.warnings);
  const failedMessage = toolResult?.error?.message || null;

  return (
    <div className="sky-repository-map-output">
      <div className="d-flex flex-wrap align-items-start justify-content-between gap-3 mb-3">
        <div>
          <div className="sky-page-kicker">Repository map result</div>
          <h3 className="h6 mb-1">{output.fileName || 'Repository map'}</h3>
          <p className="small sky-muted mb-0">
            {toolResult.message || 'Structured repository map result recorded.'}
          </p>
        </div>
        <div className="d-flex flex-wrap gap-2">
          <span
            className={`sky-pill ${output.outcome === 'CREATED' ? 'sky-pill-success' : 'sky-pill-danger'}`}
          >
            {output.outcome || 'UNKNOWN'}
          </span>
          <span className="sky-pill sky-pill-info">{formatDuration(output.durationMs)}</span>
        </div>
      </div>
      <div className="sky-page-kicker mb-2">Map summary</div>
      <div className="table-responsive sky-table-card mb-3">
        <table className="table table-sm sky-table align-middle mb-0">
          <tbody>
            <tr>
              <th>Repository</th>
              <td>{output.repositoryName || '—'}</td>
              <th>Format</th>
              <td>{output.format || '—'}</td>
            </tr>
            <tr>
              <th>Directories documented</th>
              <td>{Number(output.directoriesDocumented || 0).toLocaleString()}</td>
              <th>Files documented</th>
              <td>{Number(output.filesDocumented || 0).toLocaleString()}</td>
            </tr>
            <tr>
              <th>Directories excluded</th>
              <td>{Number(output.directoriesExcluded || 0).toLocaleString()}</td>
              <th>Files excluded</th>
              <td>{Number(output.filesExcluded || 0).toLocaleString()}</td>
            </tr>
            <tr>
              <th>Output size</th>
              <td>{formatByteCount(output.outputBytes)}</td>
              <th>Created</th>
              <td>
                <FriendlyOutputScalar fieldKey="completedAt" value={output.completedAt} />
              </td>
            </tr>
            <tr>
              <th>Map path</th>
              <td colSpan="3" className="sky-mono text-break">
                {output.artifactPath || '—'}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <PerformanceTelemetryTable telemetry={output.performanceTelemetry} />

      <div className="sky-page-kicker mb-2">Documentation policy</div>
      <div className="table-responsive sky-table-card mb-3">
        <table className="table table-sm sky-table align-middle mb-0">
          <thead>
            <tr>
              <th>Node modules</th>
              <th>Environment files</th>
              <th>Generated artifacts</th>
              <th>E2E tests</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>{policy.nodeModulesExcluded ? 'Excluded' : 'Included'}</td>
              <td>{policy.sensitiveEnvironmentFilesExcluded ? 'Excluded' : 'Included'}</td>
              <td>{policy.generatedArtifactsExcluded ? 'Excluded' : 'Included'}</td>
              <td>{policy.e2eTestsExcluded ? 'Excluded' : 'Included'}</td>
            </tr>
          </tbody>
        </table>
      </div>
      {extensions.length > 0 ? (
        <>
          <div className="sky-page-kicker mb-2">File extension breakdown</div>
          <div className="table-responsive sky-table-card">
            <table className="table table-sm sky-table align-middle mb-0">
              <thead>
                <tr>
                  <th>Extension</th>
                  <th>Files</th>
                </tr>
              </thead>
              <tbody>
                {extensions.map(([extension, count]) => (
                  <tr key={extension}>
                    <td className="sky-mono">{extension}</td>
                    <td>{Number(count || 0).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : null}
      {warnings.length > 0 || failedMessage ? (
        <div className="alert alert-warning mt-3 mb-0 py-2">
          {warnings.map((warning) => (
            <div key={warning}>{warning}</div>
          ))}
          {failedMessage ? <div>{failedMessage}</div> : null}
        </div>
      ) : null}
    </div>
  );
}

function GitRepositoryStatusOutput({ toolResult }) {
  const output = getSafeObject(toolResult?.output);
  const workingTree = getSafeObject(output.workingTree);
  const branches = getSafeObject(output.branches);
  const relationship = getSafeObject(output.relationship);
  const repositoryState = getSafeObject(output.repositoryState);
  const blockers = getSafeArray(output.blockers);
  const advisories = getSafeArray(output.advisories);
  const recommendedActions = getSafeArray(output.recommendedActions);
  const recentCommits = getSafeArray(output.recentCommits);
  const workingTreeEntries = getSafeArray(workingTree.entries).slice(0, 50);
  const warnings = getSafeArray(toolResult?.warnings);
  const failedMessage = toolResult?.error?.message || null;
  const branchRows = [branches.dev, branches.main].filter(Boolean);
  const stateRows = [
    ['Index lock', repositoryState.indexLockPresent],
    ['Merge', repositoryState.mergeInProgress],
    ['Rebase', repositoryState.rebaseInProgress],
    ['Cherry-pick', repositoryState.cherryPickInProgress],
    ['Revert', repositoryState.revertInProgress],
    ['Bisect', repositoryState.bisectInProgress],
  ];

  return (
    <div className="sky-git-repository-status-output">
      <div className="d-flex flex-wrap align-items-start justify-content-between gap-3 mb-3">
        <div>
          <div className="sky-page-kicker">Repository intelligence</div>
          <h3 className="h6 mb-1">
            {output.repositoryCode || output.repositoryName || 'Repository'} promotion preflight
          </h3>
          <p className="small sky-muted mb-0">
            {toolResult.message || 'Structured repository status recorded.'}
          </p>
        </div>
        <div className="d-flex flex-wrap gap-2">
          <span className={`sky-pill ${operationOutcomeClass(output.outcome)}`}>
            {output.outcome || 'UNKNOWN'}
          </span>
          <span
            className={`sky-pill ${
              output.readyForDevelopmentPromotion ? 'sky-pill-success' : 'sky-pill-warning'
            }`}
          >
            {output.readyForDevelopmentPromotion ? 'Promotion ready' : `${blockers.length} blocker(s)`}
          </span>
          <span className="sky-pill sky-pill-info">Watcher-safe</span>
          <span className="sky-pill sky-pill-info">{formatDuration(output.durationMs)}</span>
        </div>
      </div>

      <div className="sky-page-kicker mb-2">Promotion readiness</div>
      <div className="table-responsive sky-table-card mb-3">
        <table className="table table-sm sky-table align-middle mb-0">
          <tbody>
            <tr>
              <th>Repository</th>
              <td>{output.repositoryCode || output.repositoryName || '—'}</td>
              <th>Inspection strategy</th>
              <td>{humanizeOutputKey(output.executionStrategy || 'checkout free inspection')}</td>
            </tr>
            <tr>
              <th>Active branch</th>
              <td className="sky-mono">{output.currentBranch || 'Detached HEAD'}</td>
              <th>Expected branch</th>
              <td className="sky-mono">{output.expectedBranch || '—'}</td>
            </tr>
            <tr>
              <th>Remote refresh</th>
              <td>{output.fetchSucceeded ? 'Completed' : 'Unavailable'}</td>
              <th>Remote baseline synchronized</th>
              <td>{relationship.remoteBranchesSynchronized ? 'Yes' : 'No'}</td>
            </tr>
            <tr>
              <th>Development promotion</th>
              <td>
                <span className={`sky-pill ${operationOutcomeClass(output.outcome)}`}>
                  {output.readyForDevelopmentPromotion ? 'READY' : 'BLOCKED'}
                </span>
              </td>
              <th>Common ancestor</th>
              <td className="sky-mono text-break">{relationship.commonAncestorSha || '—'}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="sky-page-kicker mb-2">Working tree</div>
      <div className="table-responsive sky-table-card mb-3">
        <table className="table table-sm sky-table align-middle mb-0">
          <thead>
            <tr>
              <th>Clean</th>
              <th>Total changes</th>
              <th>Staged</th>
              <th>Modified</th>
              <th>Untracked</th>
              <th>Conflicted</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>{workingTree.clean ? 'Yes' : 'No'}</td>
              <td>{Number(workingTree.totalChanges || 0).toLocaleString()}</td>
              <td>{Number(workingTree.staged || 0).toLocaleString()}</td>
              <td>{Number(workingTree.modified || 0).toLocaleString()}</td>
              <td>{Number(workingTree.untracked || 0).toLocaleString()}</td>
              <td>{Number(workingTree.conflicted || 0).toLocaleString()}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="sky-page-kicker mb-2">Branch tracking</div>
      <div className="table-responsive sky-table-card mb-3">
        <table className="table table-sm sky-table align-middle mb-0">
          <thead>
            <tr>
              <th>Branch</th>
              <th>Local head</th>
              <th>Remote head</th>
              <th>Ahead</th>
              <th>Behind</th>
              <th>Tracking synchronized</th>
              <th>Latest remote commit</th>
            </tr>
          </thead>
          <tbody>
            {branchRows.map((branch) => (
              <tr key={branch.name || branch.remoteSha || branch.localSha}>
                <td className="fw-semibold sky-mono">{branch.name || '—'}</td>
                <td className="sky-mono text-break">{branch.localSha || '—'}</td>
                <td className="sky-mono text-break">{branch.remoteSha || '—'}</td>
                <td>{branch.ahead ?? '—'}</td>
                <td>{branch.behind ?? '—'}</td>
                <td>{branch.localMatchesRemote ? 'Yes' : 'No'}</td>
                <td>
                  <div className="sky-mono">{branch.latestRemoteCommit?.shortSha || '—'}</div>
                  <div className="small sky-muted">{branch.latestRemoteCommit?.subject || '—'}</div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="sky-page-kicker mb-2">Repository operation state</div>
      <div className="table-responsive sky-table-card mb-3">
        <table className="table table-sm sky-table align-middle mb-0">
          <thead>
            <tr>
              {stateRows.map(([label]) => (
                <th key={label}>{label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              {stateRows.map(([label, active]) => (
                <td key={label}>{active ? 'In progress' : 'Clear'}</td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>

      {blockers.length > 0 ? (
        <>
          <div className="sky-page-kicker mb-2">Promotion blockers</div>
          <div className="table-responsive sky-table-card mb-3">
            <table className="table table-sm sky-table align-middle mb-0">
              <thead>
                <tr>
                  <th>Code</th>
                  <th>Finding</th>
                </tr>
              </thead>
              <tbody>
                {blockers.map((blocker, index) => (
                  <tr key={`${blocker.code || 'blocker'}-${index}`}>
                    <td className="sky-mono">{blocker.code || 'REPOSITORY_BLOCKER'}</td>
                    <td>{blocker.message || String(blocker)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : null}

      {workingTreeEntries.length > 0 ? (
        <>
          <div className="d-flex flex-wrap align-items-center justify-content-between gap-2 mb-2">
            <div className="sky-page-kicker">Working-tree paths</div>
            <span className="sky-pill sky-pill-info">
              {workingTreeEntries.length}
              {getSafeArray(workingTree.entries).length > workingTreeEntries.length ? '+' : ''} path(s)
            </span>
          </div>
          <div className="table-responsive sky-table-card mb-3">
            <table className="table table-sm sky-table align-middle mb-0">
              <thead>
                <tr>
                  <th>Path</th>
                  <th>Index</th>
                  <th>Working tree</th>
                  <th>Classification</th>
                </tr>
              </thead>
              <tbody>
                {workingTreeEntries.map((entry, index) => (
                  <tr key={`${entry.path || 'path'}-${index}`}>
                    <td className="sky-mono text-break">{entry.path || '—'}</td>
                    <td className="sky-mono">{entry.indexStatus || '—'}</td>
                    <td className="sky-mono">{entry.workTreeStatus || '—'}</td>
                    <td>
                      {entry.conflicted
                        ? 'Conflicted'
                        : entry.untracked
                          ? 'Untracked'
                          : entry.staged && entry.modified
                            ? 'Staged + modified'
                            : entry.staged
                              ? 'Staged'
                              : entry.modified
                                ? 'Modified'
                                : 'Changed'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : null}

      {recentCommits.length > 0 ? (
        <>
          <div className="d-flex flex-wrap align-items-center justify-content-between gap-2 mb-2">
            <div className="sky-page-kicker">Recent repository history</div>
            <span className="sky-pill sky-pill-info">{recentCommits.length} commit(s)</span>
          </div>
          <div className="table-responsive sky-table-card mb-3">
            <table className="table table-sm sky-table align-middle mb-0">
              <thead>
                <tr>
                  <th>Commit</th>
                  <th>Subject</th>
                  <th>References</th>
                  <th>Author</th>
                  <th>Authored</th>
                </tr>
              </thead>
              <tbody>
                {recentCommits.map((commit, index) => (
                  <tr key={`${commit.sha || commit.shortSha || 'commit'}-${index}`}>
                    <td className="sky-mono">{commit.shortSha || commit.sha || '—'}</td>
                    <td>{commit.subject || '—'}</td>
                    <td className="sky-mono small">{commit.decorations || '—'}</td>
                    <td>{commit.authorName || '—'}</td>
                    <td>
                      <FriendlyOutputScalar fieldKey="authoredAt" value={commit.authoredAt} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : null}

      {advisories.length > 0 || recommendedActions.length > 0 ? (
        <div className="row g-3">
          <div className="col-lg-6">
            <div className="sky-page-kicker mb-2">Advisories</div>
            <div className="sky-table-card p-3 h-100">
              {advisories.length > 0 ? (
                <ul className="small mb-0">
                  {advisories.map((advisory, index) => (
                    <li key={`${advisory}-${index}`}>{advisory}</li>
                  ))}
                </ul>
              ) : (
                <div className="small sky-muted">No advisories.</div>
              )}
            </div>
          </div>
          <div className="col-lg-6">
            <div className="sky-page-kicker mb-2">Recommended actions</div>
            <div className="sky-table-card p-3 h-100">
              {recommendedActions.length > 0 ? (
                <ol className="small mb-0">
                  {recommendedActions.map((action, index) => (
                    <li key={`${action}-${index}`}>{action}</li>
                  ))}
                </ol>
              ) : (
                <div className="small sky-muted">No corrective action is required.</div>
              )}
            </div>
          </div>
        </div>
      ) : null}

      {warnings.length > 0 || failedMessage ? (
        <div className="alert alert-warning mt-3 mb-0 py-2">
          {warnings.map((warning, index) => (
            <div key={`${warning}-${index}`}>{warning}</div>
          ))}
          {failedMessage ? <div>{failedMessage}</div> : null}
        </div>
      ) : null}
    </div>
  );
}

function GitCommitOutput({ toolResult }) {
  const output = getSafeObject(toolResult?.output);
  const changes = getSafeObject(output.changes);
  const steps = getSafeObject(output.steps);
  const metadata = getSafeObject(toolResult?.metadata);
  return (
    <div className="sky-git-commit-output">
      <div className="d-flex flex-wrap align-items-start justify-content-between gap-3 mb-3">
        <div>
          <div className="sky-page-kicker">Git commit result</div>
          <h3 className="h6 mb-1">
            {output.repositoryCode || output.repositoryName || 'Repository'}
          </h3>
          <p className="small sky-muted mb-0">
            {toolResult.message || 'Structured git commit result recorded.'}
          </p>
        </div>
        <div className="d-flex flex-wrap gap-2">
          <span
            className={`sky-pill ${output.outcome === 'FAILED' ? 'sky-pill-danger' : output.outcome === 'NO_CHANGES' ? 'sky-pill-info' : 'sky-pill-success'}`}
          >
            {output.outcome || 'UNKNOWN'}
          </span>
          {metadata.executionTarget ? (
            <span className="sky-pill sky-pill-info">{metadata.executionTarget}</span>
          ) : null}
          <span className="sky-pill sky-pill-info">{formatDuration(output.durationMs)}</span>
        </div>
      </div>
      <div className="sky-page-kicker mb-2">Commit summary</div>
      <div className="table-responsive sky-table-card mb-3">
        <table className="table table-sm sky-table align-middle mb-0">
          <tbody>
            <tr>
              <th>Branch</th>
              <td className="sky-mono">{output.branch || '—'}</td>
              <th>Changed files</th>
              <td>{Number(output.changedFiles || 0).toLocaleString()}</td>
            </tr>
            <tr>
              <th>Commit</th>
              <td colSpan="3" className="sky-mono text-break">
                {output.commitSha || output.currentHeadSha || 'No new commit'}
              </td>
            </tr>
            <tr>
              <th>Message</th>
              <td colSpan="3">{output.commitMessage || '—'}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <PerformanceTelemetryTable telemetry={output.performanceTelemetry} />
      <TransportTelemetryTable telemetry={output.transportTelemetry} />
      <ProcessEnvelopeTelemetryTable toolResult={toolResult} />
      <div className="sky-page-kicker mb-2">Change set</div>
      <div className="table-responsive sky-table-card mb-3">
        <table className="table table-sm sky-table align-middle mb-0">
          <thead>
            <tr>
              <th>Added</th>
              <th>Modified</th>
              <th>Deleted</th>
              <th>Renamed</th>
              <th>Untracked</th>
              <th>Other</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              {['added', 'modified', 'deleted', 'renamed', 'untracked', 'other'].map((key) => (
                <td key={key}>{Number(changes[key] || 0).toLocaleString()}</td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
      <div className="sky-page-kicker mb-2">Git steps</div>
      <div className="table-responsive sky-table-card">
        <table className="table table-sm sky-table align-middle mb-0">
          <thead>
            <tr>
              <th>Fetched</th>
              <th>Branch selected</th>
              <th>Pulled</th>
              <th>Staged</th>
              <th>Committed</th>
              <th>Pushed</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              {['fetched', 'switchedBranch', 'pulled', 'staged', 'committed', 'pushed'].map(
                (key) => (
                  <td key={key}>{steps[key] ? 'Completed' : 'Not performed'}</td>
                ),
              )}
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

function GitLocalSyncOutput({ toolResult }) {
  const output = getSafeObject(toolResult?.output);
  const safeguards = getSafeObject(output.safeguards);
  const steps = getSafeObject(output.steps);
  const warnings = getSafeArray(toolResult?.warnings);
  const failedMessage = toolResult?.error?.message || null;

  return (
    <div className="sky-git-local-sync-output">
      <div className="d-flex flex-wrap align-items-start justify-content-between gap-3 mb-3">
        <div>
          <div className="sky-page-kicker">Host local repository synchronization</div>
          <h3 className="h6 mb-1">
            {output.repositoryCode || output.repositoryName || 'Repository'} · {output.mainBranch || 'main'} / {output.devBranch || 'dev'}
          </h3>
          <p className="small sky-muted mb-0">
            {toolResult.message || 'Structured guarded host synchronization result recorded.'}
          </p>
        </div>
        <div className="d-flex flex-wrap gap-2">
          <span className={`sky-pill ${operationOutcomeClass(output.outcome)}`}>
            {output.outcome || 'UNKNOWN'}
          </span>
          <span className="sky-pill sky-pill-info">HOST</span>
          <span className="sky-pill sky-pill-info">{formatDuration(output.durationMs)}</span>
        </div>
      </div>

      <div className="sky-page-kicker mb-2">Synchronization contract</div>
      <div className="table-responsive sky-table-card mb-3">
        <table className="table table-sm sky-table align-middle mb-0">
          <tbody>
            <tr>
              <th>Expected local dev baseline</th>
              <td className="sky-mono text-break">{output.expectedLocalDevSha || '—'}</td>
              <th>Approved synchronized head</th>
              <td className="sky-mono text-break">{output.expectedSynchronizedHeadSha || '—'}</td>
            </tr>
            <tr>
              <th>Local dev baseline state</th>
              <td colSpan="3">{String(output.devBaselineState || 'UNKNOWN').replaceAll('_', ' ')}</td>
            </tr>
            <tr>
              <th>Local main before</th>
              <td className="sky-mono text-break">{output.localMainBeforeSha || '—'}</td>
              <th>Local dev before</th>
              <td className="sky-mono text-break">{output.localDevBeforeSha || '—'}</td>
            </tr>
            <tr>
              <th>Local main after</th>
              <td className="sky-mono text-break">{output.localMainAfterSha || '—'}</td>
              <th>Local dev after</th>
              <td className="sky-mono text-break">{output.localDevAfterSha || '—'}</td>
            </tr>
            <tr>
              <th>Origin main after</th>
              <td className="sky-mono text-break">{output.remoteMainAfterSha || '—'}</td>
              <th>Origin dev after</th>
              <td className="sky-mono text-break">{output.remoteDevAfterSha || '—'}</td>
            </tr>
            <tr>
              <th>Four-way synchronized</th>
              <td>{output.fourWaySynchronized ? 'Yes' : 'No'}</td>
              <th>Working tree clean</th>
              <td>{output.workingTreeCleanAfter ? 'Yes' : 'No'}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <PerformanceTelemetryTable telemetry={output.performanceTelemetry} />
      <TransportTelemetryTable telemetry={output.transportTelemetry} />
      <ProcessEnvelopeTelemetryTable toolResult={toolResult} />

      <div className="sky-page-kicker mb-2">Safety guardrails</div>
      <div className="table-responsive sky-table-card mb-3">
        <table className="table table-sm sky-table align-middle mb-0">
          <tbody>
            {[
              ['Host profile verified', 'hostProfileVerified'],
              ['Repository lock acquired', 'repositoryLockAcquired'],
              ['No Git operation in progress', 'gitOperationClear'],
              ['Working tree clean', 'workingTreeClean'],
              ['Worktree ownership safe', 'worktreeOwnershipSafe'],
              ['Dev baseline / approved lineage accepted', 'devBaselineMatched'],
              ['Remote target matched', 'remoteTargetMatched'],
              ['Local main fast-forward safe', 'localMainFastForwardSafe'],
              ['Local dev fast-forward safe', 'localDevFastForwardSafe'],
              ['Remote reverified before mutation', 'remoteReverifiedBeforeMutation'],
            ].map(([label, key]) => (
              <tr key={key}>
                <th>{label}</th>
                <td>{safeguards[key] ? 'Passed' : 'Not passed'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="sky-page-kicker mb-2">Execution steps</div>
      <div className="table-responsive sky-table-card">
        <table className="table table-sm sky-table align-middle mb-0">
          <thead>
            <tr>
              <th>Remote inspected</th>
              <th>Fetched</th>
              <th>Main updated</th>
              <th>Dev updated</th>
              <th>Remote reverified</th>
              <th>Post verified</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              {['remoteInspected', 'fetched', 'mainRefUpdated', 'devRefUpdated', 'remoteReverified', 'postVerified'].map((key) => (
                <td key={key}>{steps[key] ? 'Completed' : 'Not performed'}</td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>

      {warnings.length > 0 || failedMessage ? (
        <div className="alert alert-warning mt-3 mb-0 py-2">
          {warnings.map((warning, index) => (
            <div key={`local-sync-warning-${index}`}>{warning}</div>
          ))}
          {failedMessage ? <div>{failedMessage}</div> : null}
        </div>
      ) : null}
    </div>
  );
}

function GitBranchSyncOutput({ toolResult }) {
  const output = getSafeObject(toolResult?.output);
  const steps = getSafeObject(output.steps);
  const metadata = getSafeObject(toolResult?.metadata);
  const warnings = getSafeArray(toolResult?.warnings);
  const failedMessage = toolResult?.error?.message || null;
  const sourceBranch = output.sourceBranch || output.mainBranch || 'main';
  const targetBranch = output.targetBranch || output.devBranch || 'dev';

  return (
    <div className="sky-git-branch-sync-output">
      <div className="d-flex flex-wrap align-items-start justify-content-between gap-3 mb-3">
        <div>
          <div className="sky-page-kicker">Git branch synchronization result</div>
          <h3 className="h6 mb-1">
            {output.repositoryCode || output.repositoryName || 'Repository'} · {sourceBranch} →{' '}
            {targetBranch}
          </h3>
          <p className="small sky-muted mb-0">
            {toolResult.message || 'Structured branch synchronization result recorded.'}
          </p>
        </div>
        <div className="d-flex flex-wrap gap-2">
          <span className={`sky-pill ${operationOutcomeClass(output.outcome)}`}>
            {output.outcome || 'UNKNOWN'}
          </span>
          {metadata.executionTarget ? (
            <span className="sky-pill sky-pill-info">{metadata.executionTarget}</span>
          ) : null}
          <span className="sky-pill sky-pill-info">{formatDuration(output.durationMs)}</span>
        </div>
      </div>

      <div className="sky-page-kicker mb-2">Synchronization summary</div>
      <div className="table-responsive sky-table-card mb-3">
        <table className="table table-sm sky-table align-middle mb-0">
          <tbody>
            <tr>
              <th>Source branch</th>
              <td className="sky-mono">{sourceBranch}</td>
              <th>Target branch</th>
              <td className="sky-mono">{targetBranch}</td>
            </tr>
            <tr>
              <th>Commits applied</th>
              <td>{Number(output.commitsApplied || 0).toLocaleString()}</td>
              <th>Branches synchronized</th>
              <td>{output.branchesSynchronized ? 'Yes' : 'No'}</td>
            </tr>
            <tr>
              <th>Development branch advanced</th>
              <td>{output.devAdvanced ? 'Yes' : 'No'}</td>
              <th>Tag</th>
              <td>{output.tagCreated ? output.tagName || 'Created' : 'Not created'}</td>
            </tr>
            <tr>
              <th>Execution strategy</th>
              <td>{output.executionStrategy === 'CHECKOUT_FREE_REMOTE_SYNC' ? 'Checkout-free remote sync' : output.executionStrategy || '—'}</td>
              <th>Watcher safe</th>
              <td>{output.watcherSafe ? 'Yes' : 'No'}</td>
            </tr>
            <tr>
              <th>Local workspace</th>
              <td>{output.localWorkspaceUpdated ? 'Updated without file rewrite' : 'Not rewritten'}</td>
              <th>Refresh required</th>
              <td>{output.localWorkspaceRefreshRequired ? 'Yes' : 'No'}</td>
            </tr>
            <tr>
              <th>Host local sync required</th>
              <td>{output.localHostSyncRequired ? 'Yes' : 'No'}</td>
              <th>Deferred local branches</th>
              <td className="sky-mono">
                {getSafeArray(output.deferredLocalBranches).join(', ') || 'None'}
              </td>
            </tr>
            <tr>
              <th>Synchronized head</th>
              <td colSpan="3" className="sky-mono text-break">
                {output.synchronizedHeadSha || output.devHeadAfterSha || '—'}
              </td>
            </tr>
            {output.localSyncCommandTemplate ? (
              <tr>
                <th>Host sync command template</th>
                <td colSpan="3" className="sky-mono text-break">
                  {output.localSyncCommandTemplate}
                </td>
              </tr>
            ) : null}
            {output.localRefreshCommand ? (
              <tr>
                <th>Local refresh command</th>
                <td colSpan="3" className="sky-mono text-break">
                  {output.localRefreshCommand}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <PerformanceTelemetryTable telemetry={output.performanceTelemetry} />
      <TransportTelemetryTable telemetry={output.transportTelemetry} />
      <ProcessEnvelopeTelemetryTable toolResult={toolResult} />

      <div className="sky-page-kicker mb-2">Branch head movement</div>
      <div className="table-responsive sky-table-card mb-3">
        <table className="table table-sm sky-table align-middle mb-0">
          <thead>
            <tr>
              <th>Checkpoint</th>
              <th>Commit SHA</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Main after pull</td>
              <td className="sky-mono text-break">{output.mainHeadSha || '—'}</td>
            </tr>
            <tr>
              <td>Development before synchronization</td>
              <td className="sky-mono text-break">{output.devHeadBeforeSha || '—'}</td>
            </tr>
            <tr>
              <td>Development after synchronization</td>
              <td className="sky-mono text-break">{output.devHeadAfterSha || '—'}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="sky-page-kicker mb-2">Git steps</div>
      <div className="table-responsive sky-table-card">
        <table className="table table-sm sky-table align-middle mb-0">
          <thead>
            <tr>
              <th>Fetched</th>
              <th>Remote fast-forward</th>
              <th>Remote verified</th>
              <th>Main ref updated</th>
              <th>Dev ref updated</th>
              <th>Workspace updated</th>
              <th>Tag pushed</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              {[
                'fetched',
                'fastForwardMerged',
                'remoteFastForwardVerified',
                'localMainRefUpdated',
                'localDevRefUpdated',
                'localWorkspaceUpdated',
                'tagsPushed',
              ].map((key) => (
                <td key={key}>{steps[key] ? 'Completed' : 'Not performed'}</td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>

      {warnings.length > 0 || failedMessage ? (
        <div className="alert alert-warning mt-3 mb-0 py-2">
          {warnings.map((warning) => (
            <div key={warning}>{warning}</div>
          ))}
          {failedMessage ? <div>{failedMessage}</div> : null}
        </div>
      ) : null}
    </div>
  );
}


function DatabaseHealthOutput({ toolResult }) {
  const output = getSafeObject(toolResult?.output);
  const databases = getSafeArray(output.databases);
  const warnings = getSafeArray(toolResult?.warnings);
  const failedMessage = toolResult?.error?.message || null;
  const outcome = toolResult?.success === false ? 'FAILED' : output.allOnline ? 'ONLINE' : 'PARTIAL';

  return (
    <div className="sky-database-health-output">
      <div className="d-flex flex-wrap align-items-start justify-content-between gap-3 mb-3">
        <div>
          <div className="sky-page-kicker">PostgreSQL database health</div>
          <h3 className="h6 mb-1">
            {Number(output.onlineCount || 0).toLocaleString()} of{' '}
            {Number(output.requestedCount || databases.length || 0).toLocaleString()} database(s) online
          </h3>
          <p className="small sky-muted mb-0">
            {toolResult?.message || 'Structured PostgreSQL connection evidence recorded.'}
          </p>
        </div>
        <div className="d-flex flex-wrap gap-2">
          <span className={`sky-pill ${operationOutcomeClass(outcome)}`}>{outcome}</span>
          <span className="sky-pill sky-pill-success">
            {Number(output.onlineCount || 0).toLocaleString()} online
          </span>
          {Number(output.offlineCount || 0) > 0 ? (
            <span className="sky-pill sky-pill-warning">
              {Number(output.offlineCount || 0).toLocaleString()} offline
            </span>
          ) : null}
          <span className="sky-pill sky-pill-info">{formatDuration(output.durationMs)}</span>
        </div>
      </div>

      <div className="sky-page-kicker mb-2">Health-check overview</div>
      <div className="table-responsive sky-table-card mb-3">
        <table className="table table-sm sky-table align-middle mb-0">
          <thead>
            <tr>
              <th>Checked at</th>
              <th>Requested</th>
              <th>Online</th>
              <th>Offline</th>
              <th>All online</th>
              <th>Offline policy</th>
              <th>Duration</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td><FriendlyOutputScalar fieldKey="checkedAt" value={output.checkedAt} /></td>
              <td>{Number(output.requestedCount || databases.length || 0).toLocaleString()}</td>
              <td>{Number(output.onlineCount || 0).toLocaleString()}</td>
              <td>{Number(output.offlineCount || 0).toLocaleString()}</td>
              <td>
                <span className={`sky-pill ${output.allOnline ? 'sky-pill-success' : 'sky-pill-warning'}`}>
                  {output.allOnline ? 'YES' : 'NO'}
                </span>
              </td>
              <td>{output.failWhenOffline ? 'Fail execution' : 'Report evidence'}</td>
              <td>{formatDuration(output.durationMs)}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="d-flex flex-wrap align-items-center justify-content-between gap-2 mb-2">
        <div className="sky-page-kicker">Database results</div>
        <span className="sky-pill sky-pill-info">{databases.length} database(s)</span>
      </div>
      {databases.length > 0 ? (
        <div className="table-responsive sky-table-card">
          <table className="table table-sm sky-table align-middle mb-0">
            <thead>
              <tr>
                <th>Database</th>
                <th>Status</th>
                <th>Latency</th>
                <th>Server version</th>
                <th>User</th>
                <th>Endpoint</th>
                <th>Checked at</th>
                <th>Evidence</th>
              </tr>
            </thead>
            <tbody>
              {databases.map((database, index) => {
                const endpoint = database?.serverAddress
                  ? `${database.serverAddress}${database.serverPort ? `:${database.serverPort}` : ''}`
                  : '—';
                const evidence = database?.online
                  ? 'Connection succeeded'
                  : [database?.errorCode, database?.errorMessage].filter(Boolean).join(' · ') || 'Connection failed';

                return (
                  <tr key={`${database?.databaseName || 'database'}-${index}`}>
                    <td className="fw-semibold sky-mono">{database?.databaseName || '—'}</td>
                    <td>
                      <span className={`sky-pill ${database?.online ? 'sky-pill-success' : 'sky-pill-warning'}`}>
                        {database?.online ? 'ONLINE' : 'OFFLINE'}
                      </span>
                    </td>
                    <td>{database?.online ? formatDuration(database?.latencyMs) : '—'}</td>
                    <td>{database?.serverVersion || '—'}</td>
                    <td className="sky-mono">{database?.currentUser || '—'}</td>
                    <td className="sky-mono text-break">{endpoint}</td>
                    <td><FriendlyOutputScalar fieldKey="checkedAt" value={database?.checkedAt} /></td>
                    <td className="text-break">{evidence}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="sky-empty-state">No database health rows were returned.</div>
      )}

      {warnings.length > 0 || failedMessage ? (
        <div className="alert alert-warning mt-3 mb-0 py-2">
          {warnings.map((warning, index) => (
            <div key={`database-health-warning-${index}`}>
              {typeof warning === 'string' ? warning : warning.message || JSON.stringify(warning)}
            </div>
          ))}
          {failedMessage ? <div>{failedMessage}</div> : null}
        </div>
      ) : null}
    </div>
  );
}

function DatabaseBuildOutput({ toolResult }) {
  const output = getSafeObject(toolResult?.output);
  const allFiles = getSafeArray(output.files);
  const files = allFiles.slice(0, 250);
  const uiFilesTruncated = allFiles.length > files.length;
  const warnings = getSafeArray(toolResult?.warnings);
  const failedMessage = toolResult?.error?.message || null;
  const buildStatus = output.status || (output.buildCompleted ? 'BUILT' : 'FAILED');
  const sqlRemaining = Math.max(
    0,
    Number(output.sqlFilesDiscovered || 0) - Number(output.sqlFilesExecuted || 0),
  );
  const migrationRemaining = Math.max(
    0,
    Number(output.migrationFilesDiscovered || 0) - Number(output.migrationFilesExecuted || 0),
  );
  const seedRemaining = Math.max(
    0,
    Number(output.seedFilesDiscovered || 0) - Number(output.seedFilesExecuted || 0),
  );

  return (
    <div className="sky-database-build-output">
      <div className="d-flex flex-wrap align-items-start justify-content-between gap-3 mb-3">
        <div>
          <div className="sky-page-kicker">PostgreSQL database build</div>
          <h3 className="h6 mb-1 sky-mono">{output.targetDatabase || 'Target database'}</h3>
          <p className="small sky-muted mb-0">
            {toolResult?.message || 'Structured database rebuild evidence recorded.'}
          </p>
        </div>
        <div className="d-flex flex-wrap gap-2">
          <span className={`sky-pill ${operationOutcomeClass(buildStatus)}`}>
            {buildStatus}
          </span>
          <span className={`sky-pill ${output.buildCompleted ? 'sky-pill-success' : 'sky-pill-warning'}`}>
            {output.buildCompleted ? 'Build completed' : humanizeOutputKey(output.phase || 'Incomplete')}
          </span>
          <span className="sky-pill sky-pill-info">{formatDuration(output.durationMs)}</span>
        </div>
      </div>

      <div className="sky-page-kicker mb-2">Build overview</div>
      <div className="table-responsive sky-table-card mb-3">
        <table className="table table-sm sky-table align-middle mb-0">
          <thead>
            <tr>
              <th>Target database</th>
              <th>Phase</th>
              <th>Dropped</th>
              <th>Created</th>
              <th>Completed</th>
              <th>Started</th>
              <th>Completed at</th>
              <th>Duration</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="fw-semibold sky-mono">{output.targetDatabase || '—'}</td>
              <td>{humanizeOutputKey(output.phase || '—')}</td>
              <td>{output.databaseDropped ? 'Yes' : 'No'}</td>
              <td>{output.databaseCreated ? 'Yes' : 'No'}</td>
              <td>
                <span className={`sky-pill ${output.buildCompleted ? 'sky-pill-success' : 'sky-pill-warning'}`}>
                  {output.buildCompleted ? 'YES' : 'NO'}
                </span>
              </td>
              <td><FriendlyOutputScalar fieldKey="startedAt" value={output.startedAt} /></td>
              <td><FriendlyOutputScalar fieldKey="completedAt" value={output.completedAt} /></td>
              <td>{formatDuration(output.durationMs)}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="sky-page-kicker mb-2">SQL execution totals</div>
      <div className="table-responsive sky-table-card mb-3">
        <table className="table table-sm sky-table align-middle mb-0">
          <thead>
            <tr>
              <th>File group</th>
              <th>Discovered</th>
              <th>Executed</th>
              <th>Remaining</th>
              <th>Completion</th>
            </tr>
          </thead>
          <tbody>
            {[
              ['All SQL files', output.sqlFilesDiscovered, output.sqlFilesExecuted, sqlRemaining],
              ['Migrations', output.migrationFilesDiscovered, output.migrationFilesExecuted, migrationRemaining],
              ['Seeds', output.seedFilesDiscovered, output.seedFilesExecuted, seedRemaining],
            ].map(([label, discovered, executed, remaining]) => {
              const complete =
                (Number(discovered || 0) > 0 || output.buildCompleted) &&
                Number(discovered || 0) === Number(executed || 0) &&
                Number(remaining || 0) === 0;
              return (
                <tr key={label}>
                  <td className="fw-semibold">{label}</td>
                  <td>{Number(discovered || 0).toLocaleString()}</td>
                  <td>{Number(executed || 0).toLocaleString()}</td>
                  <td>{Number(remaining || 0).toLocaleString()}</td>
                  <td>
                    <span className={`sky-pill ${complete ? 'sky-pill-success' : 'sky-pill-warning'}`}>
                      {complete ? 'COMPLETE' : 'INCOMPLETE'}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="sky-page-kicker mb-2">Build checkpoints</div>
      <div className="table-responsive sky-table-card mb-3">
        <table className="table table-sm sky-table align-middle mb-0">
          <tbody>
            <tr>
              <th>SQL roots</th>
              <td colSpan="3" className="sky-mono text-break">
                {getSafeArray(output.sqlRoots).join(', ') || '—'}
              </td>
            </tr>
            <tr>
              <th>First SQL file</th>
              <td className="sky-mono text-break">{output.firstSqlFile || '—'}</td>
              <th>Last SQL file</th>
              <td className="sky-mono text-break">{output.lastSqlFile || '—'}</td>
            </tr>
            <tr>
              <th>Last completed SQL file</th>
              <td className="sky-mono text-break">{output.lastCompletedSqlFile || '—'}</td>
              <th>Failed SQL file</th>
              <td className="sky-mono text-break">{output.failedSqlFile || '—'}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="d-flex flex-wrap align-items-center justify-content-between gap-2 mb-2">
        <div className="sky-page-kicker">Ordered SQL execution</div>
        <span className="sky-pill sky-pill-info">
          {files.length}{uiFilesTruncated ? '+' : ''} file row(s)
        </span>
      </div>
      {files.length > 0 ? (
        <div className="table-responsive sky-table-card">
          <table className="table table-sm sky-table align-middle mb-0">
            <thead>
              <tr>
                <th>Ordinal</th>
                <th>Kind</th>
                <th>Status</th>
                <th>Duration</th>
                <th>Repository-relative SQL file</th>
              </tr>
            </thead>
            <tbody>
              {files.map((file, index) => (
                <tr key={`${file?.relativePath || 'sql-file'}-${index}`}>
                  <td>{Number(file?.ordinal || 0).toLocaleString()}</td>
                  <td>{humanizeOutputKey(file?.kind || 'OTHER')}</td>
                  <td>
                    <span className={`sky-pill ${operationOutcomeClass(file?.status)}`}>
                      {file?.status || 'UNKNOWN'}
                    </span>
                  </td>
                  <td>{file?.durationMs == null ? '—' : formatDuration(file.durationMs)}</td>
                  <td className="sky-mono text-break">{file?.relativePath || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="sky-empty-state">No SQL execution rows were returned.</div>
      )}

      {uiFilesTruncated ? (
        <div className="small sky-muted mt-2">
          Workflow Operations displays the first 250 SQL rows; the complete structured result remains persisted.
        </div>
      ) : null}

      {warnings.length > 0 || failedMessage ? (
        <div className="alert alert-warning mt-3 mb-0 py-2">
          {warnings.map((warning, index) => (
            <div key={`database-build-warning-${index}`}>
              {typeof warning === 'string' ? warning : warning.message || JSON.stringify(warning)}
            </div>
          ))}
          {failedMessage ? <div>{failedMessage}</div> : null}
        </div>
      ) : null}
    </div>
  );
}

function DatabaseComparisonOutput({ toolResult }) {
  const output = getSafeObject(toolResult?.output);
  const byType = getSafeArray(output.byType);
  const allDifferences = getSafeArray(output.differences);
  const differences = allDifferences.slice(0, 250);
  const uiDifferenceDetailsTruncated = allDifferences.length > differences.length;
  const differenceTypes = byType.filter(
    (item) =>
      Number(item.onlyInDatabaseA || 0) > 0 ||
      Number(item.onlyInDatabaseB || 0) > 0 ||
      Number(item.definitionMismatches || 0) > 0,
  );
  const typeRows = differenceTypes.length > 0 ? differenceTypes : byType;
  const warnings = getSafeArray(toolResult?.warnings);
  const failedMessage = toolResult?.error?.message || null;

  return (
    <div className="sky-database-comparison-output">
      <div className="d-flex flex-wrap align-items-start justify-content-between gap-3 mb-3">
        <div>
          <div className="sky-page-kicker">PostgreSQL database comparison</div>
          <h3 className="h6 mb-1">
            {output.databaseA || 'Database A'} ↔ {output.databaseB || 'Database B'}
          </h3>
          <p className="small sky-muted mb-0">
            {toolResult?.message || 'Structured PostgreSQL catalogue comparison recorded.'}
          </p>
        </div>
        <div className="d-flex flex-wrap gap-2">
          <span className={`sky-pill ${operationOutcomeClass(output.status)}`}>
            {output.status || 'UNKNOWN'}
          </span>
          <span
            className={`sky-pill ${output.databasesMatch ? 'sky-pill-success' : 'sky-pill-warning'}`}
          >
            {output.databasesMatch ? 'Definitions match' : `${Number(output.totalDifferenceCount || 0).toLocaleString()} difference(s)`}
          </span>
          <span className="sky-pill sky-pill-info">{formatDuration(output.durationMs)}</span>
        </div>
      </div>

      <div className="sky-page-kicker mb-2">Comparison overview</div>
      <div className="table-responsive sky-table-card mb-3">
        <table className="table table-sm sky-table align-middle mb-0">
          <thead>
            <tr>
              <th>Database</th>
              <th>Objects</th>
              <th>Fingerprint</th>
              <th>Compared at</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="fw-semibold sky-mono">{output.databaseA || '—'}</td>
              <td>{Number(output.databaseAObjectCount || 0).toLocaleString()}</td>
              <td className="sky-mono text-break">{output.databaseAFingerprint || '—'}</td>
              <td rowSpan="2">
                <FriendlyOutputScalar fieldKey="comparedAt" value={output.comparedAt} />
              </td>
            </tr>
            <tr>
              <td className="fw-semibold sky-mono">{output.databaseB || '—'}</td>
              <td>{Number(output.databaseBObjectCount || 0).toLocaleString()}</td>
              <td className="sky-mono text-break">{output.databaseBFingerprint || '—'}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="sky-page-kicker mb-2">Object reconciliation</div>
      <div className="table-responsive sky-table-card mb-3">
        <table className="table table-sm sky-table align-middle mb-0">
          <thead>
            <tr>
              <th>Matched</th>
              <th>Only in {output.databaseA || 'Database A'}</th>
              <th>Only in {output.databaseB || 'Database B'}</th>
              <th>Definition mismatches</th>
              <th>Total differences</th>
              <th>Details returned</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="fw-semibold">
                {Number(output.matchedObjectCount || 0).toLocaleString()}
              </td>
              <td>{Number(output.onlyInDatabaseACount || 0).toLocaleString()}</td>
              <td>{Number(output.onlyInDatabaseBCount || 0).toLocaleString()}</td>
              <td>{Number(output.definitionMismatchCount || 0).toLocaleString()}</td>
              <td className={output.totalDifferenceCount ? 'fw-semibold' : ''}>
                {Number(output.totalDifferenceCount || 0).toLocaleString()}
              </td>
              <td>
                {Number(output.differenceDetailsReturned || differences.length || 0).toLocaleString()}
                {output.differenceDetailsTruncated || uiDifferenceDetailsTruncated ? ' (truncated)' : ''}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      {typeRows.length > 0 ? (
        <>
          <div className="d-flex flex-wrap align-items-center justify-content-between gap-2 mb-2">
            <div className="sky-page-kicker">
              {differenceTypes.length > 0 ? 'Differences by object type' : 'Object counts by type'}
            </div>
            <span className="sky-pill sky-pill-info">{typeRows.length} type(s)</span>
          </div>
          <div className="table-responsive sky-table-card mb-3">
            <table className="table table-sm sky-table align-middle mb-0">
              <thead>
                <tr>
                  <th>Object type</th>
                  <th>{output.databaseA || 'Database A'}</th>
                  <th>{output.databaseB || 'Database B'}</th>
                  <th>Only in A</th>
                  <th>Only in B</th>
                  <th>Definition mismatches</th>
                  <th>Total differences</th>
                </tr>
              </thead>
              <tbody>
                {typeRows.map((item) => {
                  const differenceCount =
                    Number(item.onlyInDatabaseA || 0) +
                    Number(item.onlyInDatabaseB || 0) +
                    Number(item.definitionMismatches || 0);

                  return (
                    <tr key={item.objectType || JSON.stringify(item)}>
                      <td className="fw-semibold">{humanizeOutputKey(item.objectType)}</td>
                      <td>{Number(item.databaseACount || 0).toLocaleString()}</td>
                      <td>{Number(item.databaseBCount || 0).toLocaleString()}</td>
                      <td>{Number(item.onlyInDatabaseA || 0).toLocaleString()}</td>
                      <td>{Number(item.onlyInDatabaseB || 0).toLocaleString()}</td>
                      <td>{Number(item.definitionMismatches || 0).toLocaleString()}</td>
                      <td className={differenceCount ? 'fw-semibold' : ''}>
                        {differenceCount.toLocaleString()}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      ) : null}

      {differences.length > 0 ? (
        <>
          <div className="d-flex flex-wrap align-items-center justify-content-between gap-2 mb-2">
            <div className="sky-page-kicker">Difference details</div>
            <span className="sky-pill sky-pill-warning">
              {differences.length}
              {output.differenceDetailsTruncated || uiDifferenceDetailsTruncated ? '+' : ''} row(s)
            </span>
          </div>
          <div className="table-responsive sky-table-card">
            <table className="table table-sm sky-table align-middle mb-0">
              <thead>
                <tr>
                  <th>Difference</th>
                  <th>Object type</th>
                  <th>Object</th>
                  <th>Identity</th>
                </tr>
              </thead>
              <tbody>
                {differences.map((difference, index) => (
                  <tr key={`${difference.objectKey || difference.objectName || 'difference'}-${index}`}>
                    <td>
                      <span className={`sky-pill ${operationOutcomeClass('DIFFERENT')}`}>
                        {humanizeOutputKey(difference.kind)}
                      </span>
                    </td>
                    <td>{humanizeOutputKey(difference.objectType)}</td>
                    <td className="sky-mono text-break">
                      {difference.schemaName ? `${difference.schemaName}.` : ''}
                      {difference.objectName || '—'}
                    </td>
                    <td className="sky-mono text-break">{difference.identity || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <div className="alert alert-success py-2 mb-0">
          No PostgreSQL catalogue differences were detected.
        </div>
      )}

      {warnings.length > 0 || failedMessage ? (
        <div className="alert alert-warning mt-3 mb-0 py-2">
          {warnings.map((warning, index) => (
            <div key={`database-comparison-warning-${index}`}>
              {typeof warning === 'string' ? warning : warning.message || JSON.stringify(warning)}
            </div>
          ))}
          {failedMessage ? <div>{failedMessage}</div> : null}
        </div>
      ) : null}
    </div>
  );
}


const STRUCTURED_TOOL_RESULT_RENDERERS = {
  'macro_ingestion_summary.v1': MacroIngestionOutput,
  'repository_package_summary.v1': RepositoryPackageOutput,
  'repository_map_summary.v1': RepositoryMapOutput,
  'git_repository_status.v1': GitRepositoryStatusOutput,
  'git_commit_summary.v1': GitCommitOutput,
  'git_branch_sync_summary.v1': GitBranchSyncOutput,
  'git_local_sync_summary.v1': GitLocalSyncOutput,
  'database_health_summary.v1': DatabaseHealthOutput,
  'database_build_summary.v1': DatabaseBuildOutput,
  'postgresql_database_comparison_summary.v1': DatabaseComparisonOutput,
};

export function isStructuredToolResultDisplaySupported(toolResult) {
  return Boolean(STRUCTURED_TOOL_RESULT_RENDERERS[toolResult?.outputType]);
}

function StructuredToolResultDisplay({ toolResult }) {
  const Renderer = STRUCTURED_TOOL_RESULT_RENDERERS[toolResult?.outputType];

  if (!Renderer) {
    return null;
  }

  return <Renderer toolResult={toolResult} />;
}

export default StructuredToolResultDisplay;
