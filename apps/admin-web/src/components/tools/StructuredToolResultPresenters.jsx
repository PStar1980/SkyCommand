import structuredWarningHelpers from './structuredToolResultWarnings.cjs';

const { getStructuredWarningDisplayValue, mergeStructuredWarnings } = structuredWarningHelpers;

const MAX_ROWS = 100;
const MAX_COLUMNS = 10;
const SECRET_KEY_PATTERN = /(password|secret|token|credential|api[_-]?key|private[_-]?key)/i;

function getSafeArray(value) {
  return Array.isArray(value) ? value : [];
}

function getSafeObject(value, fallback = {}) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : fallback;
}

function formatDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(
    date,
  );
}

function formatDuration(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '—';
  return number < 1000 ? number + ' ms' : (number / 1000).toFixed(1) + ' s';
}

function humanize(value) {
  const label = String(value || '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!label) return 'Value';
  return label
    .split(' ')
    .map((word) => {
      const lower = word.toLowerCase();
      const acronym = {
        api: 'API',
        http: 'HTTP',
        https: 'HTTPS',
        id: 'ID',
        ids: 'IDs',
        json: 'JSON',
        ms: 'ms',
        url: 'URL',
        sha256: 'SHA-256',
        xlsx: 'XLSX',
      }[lower];
      return acronym || word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join(' ');
}

function isSecretKey(key) {
  return SECRET_KEY_PATTERN.test(String(key || ''));
}

function truncate(value, limit = 320) {
  const stringValue = String(value ?? '');
  return stringValue.length <= limit ? stringValue : stringValue.slice(0, limit - 1) + '…';
}

function sanitize(value, key = '', depth = 0) {
  if (isSecretKey(key)) return '[redacted]';
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return truncate(value, 600);
  if (depth >= 4) return '[nested value omitted]';
  if (Array.isArray(value)) {
    const result = value.slice(0, MAX_ROWS).map((item) => sanitize(item, key, depth + 1));
    if (value.length > result.length)
      result.push('[' + (value.length - result.length) + ' additional item(s) omitted]');
    return result;
  }
  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .slice(0, MAX_COLUMNS * 4)
        .map(([childKey, childValue]) => [childKey, sanitize(childValue, childKey, depth + 1)]),
    );
  }
  return value;
}

function json(value) {
  try {
    return truncate(JSON.stringify(sanitize(value), null, 2), 12000);
  } catch {
    return truncate(value, 12000);
  }
}

function outcomeClass(value) {
  const normalized = String(value || '').toUpperCase();
  if (['FAILED', 'FAIL', 'REJECTED', 'TIMED_OUT', 'NOT_READY'].includes(normalized))
    return 'sky-pill-danger';
  if (
    [
      'BLOCKED',
      'WARNING',
      'PARTIAL',
      'KNOWN_BASELINE_LIMITATION',
      'CONFLICT',
      'DIFFERENT',
    ].includes(normalized)
  )
    return 'sky-pill-warning';
  if (
    [
      'SUCCESS',
      'COMPLETED',
      'READY',
      'PASSED',
      'RECONCILED',
      'CHANGED',
      'APPLIED',
      'SYNCHRONIZED',
      'CAPABILITY_CATALOG_EXPORTED',
    ].includes(normalized)
  )
    return 'sky-pill-success';
  return 'sky-pill-info';
}

function outputOutcome(toolResult) {
  const output = getSafeObject(toolResult?.output);
  return (
    output.outcome ||
    output.status ||
    (toolResult?.success === false
      ? 'FAILED'
      : toolResult?.success === true
        ? 'SUCCESS'
        : 'UNKNOWN')
  );
}

export function isStructuredToolResultEnvelope(value) {
  return Boolean(
    value &&
      typeof value === 'object' &&
      typeof value.outputType === 'string' &&
      Object.prototype.hasOwnProperty.call(value, 'output'),
  );
}

function StructuredValueCell({ depth = 0, fieldKey = '', value }) {
  if (isSecretKey(fieldKey)) return <span className="sky-muted">[redacted]</span>;
  if (value === null || value === undefined || value === '')
    return <span className="sky-muted">—</span>;
  if (typeof value === 'boolean') {
    return (
      <span className={'sky-pill ' + (value ? 'sky-pill-success' : 'sky-pill-info')}>
        {value ? 'Yes' : 'No'}
      </span>
    );
  }
  if (typeof value === 'number') {
    if (
      String(fieldKey).toLowerCase().includes('duration') ||
      String(fieldKey).toLowerCase().endsWith('ms')
    ) {
      return <span>{formatDuration(value)}</span>;
    }
    return <span>{value.toLocaleString()}</span>;
  }
  if (typeof value === 'string') {
    if (
      String(fieldKey).toLowerCase().endsWith('at') ||
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value)
    ) {
      return <span>{formatDate(value)}</span>;
    }
    return (
      <span
        className={
          /(digest|hash|sha|path|id|key|code)/i.test(String(fieldKey))
            ? 'sky-mono text-break'
            : 'text-break'
        }
      >
        {truncate(value, 600)}
      </span>
    );
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return <span className="sky-muted">0 items</span>;
    if (depth >= 2) {
      return (
        <details>
          <summary>{value.length.toLocaleString()} item(s)</summary>
          <pre className="sky-structured-json mb-0">{json(value)}</pre>
        </details>
      );
    }
    return (
      <details>
        <summary>{value.length.toLocaleString()} item(s)</summary>
        <StructuredArrayTable depth={depth + 1} items={value} />
      </details>
    );
  }
  const keys = Object.keys(value);
  if (keys.length === 0) return <span className="sky-muted">Empty object</span>;
  if (depth >= 2) {
    return (
      <details>
        <summary>{keys.length.toLocaleString()} field(s)</summary>
        <pre className="sky-structured-json mb-0">{json(value)}</pre>
      </details>
    );
  }
  return (
    <details>
      <summary>{keys.length.toLocaleString()} field(s)</summary>
      <StructuredObjectTable depth={depth + 1} value={value} />
    </details>
  );
}

function StructuredObjectTable({ depth = 0, value = {} }) {
  const entries = Object.entries(getSafeObject(value));
  if (entries.length === 0)
    return <div className="sky-empty-state">No structured fields were recorded.</div>;
  return (
    <div className="table-responsive sky-table-card sky-structured-nested-table mt-2">
      <table className="table table-sm sky-table align-middle mb-0">
        <thead>
          <tr>
            <th>Field</th>
            <th>Value</th>
          </tr>
        </thead>
        <tbody>
          {entries.slice(0, MAX_COLUMNS * 4).map(([key, nestedValue]) => (
            <tr key={key}>
              <td className="fw-semibold">{humanize(key)}</td>
              <td>
                <StructuredValueCell depth={depth} fieldKey={key} value={nestedValue} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function StructuredArrayTable({ columns = null, depth = 0, items = [], maxRows = MAX_ROWS }) {
  const values = getSafeArray(items);
  if (values.length === 0) return <div className="sky-empty-state">No rows were recorded.</div>;
  const objectValues = values.filter(
    (item) => item && typeof item === 'object' && !Array.isArray(item),
  );
  const resolvedColumns =
    columns ||
    [...new Set(objectValues.flatMap((item) => Object.keys(item)))].slice(0, MAX_COLUMNS);
  if (objectValues.length === 0 || resolvedColumns.length === 0) {
    return <StructuredListPills items={values} empty="No scalar values" />;
  }
  const rows = values.slice(0, maxRows);
  return (
    <div className="table-responsive sky-table-card sky-structured-array-table mt-2">
      <table className="table table-sm sky-table align-middle mb-0">
        <thead>
          <tr>
            {resolvedColumns.map((column) => (
              <th key={column}>{humanize(column)}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((item, index) => (
            <tr key={(item?.id || item?.name || item?.path || 'row') + '-' + index}>
              {resolvedColumns.map((column) => (
                <td key={column}>
                  <StructuredValueCell depth={depth} fieldKey={column} value={item?.[column]} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {values.length > rows.length ? (
        <div className="small sky-muted p-2">
          Showing the first {rows.length.toLocaleString()} of {values.length.toLocaleString()} rows.
        </div>
      ) : null}
    </div>
  );
}

function StructuredKeyValueTable({ rows = [] }) {
  const visibleRows = rows.filter((row) => row && row.value !== undefined);
  if (visibleRows.length === 0)
    return <div className="sky-empty-state">No structured evidence was recorded.</div>;
  return (
    <div className="table-responsive sky-table-card">
      <table className="table table-sm sky-table align-middle mb-0">
        <thead>
          <tr>
            <th>Field</th>
            <th>Value</th>
          </tr>
        </thead>
        <tbody>
          {visibleRows.map((row) => (
            <tr key={row.key || row.label}>
              <td className="fw-semibold">{row.label}</td>
              <td>
                <StructuredValueCell fieldKey={row.key || row.label} value={row.value} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function StructuredSection({ children, title }) {
  return (
    <section className="sky-structured-result-section mb-3">
      <div className="sky-page-kicker mb-2">{title}</div>
      {children}
    </section>
  );
}

function StructuredListPills({ empty = 'None recorded', items = [] }) {
  const values = getSafeArray(items).filter(
    (item) => item !== null && item !== undefined && item !== '',
  );
  if (values.length === 0) return <span className="sky-muted">{empty}</span>;
  return (
    <div className="d-flex flex-wrap gap-2">
      {values.slice(0, MAX_ROWS).map((item, index) => (
        <span className="sky-pill sky-pill-info" key={String(item) + '-' + index}>
          <StructuredValueCell fieldKey="item" value={item} />
        </span>
      ))}
    </div>
  );
}

function StructuredResultHeader({ pills = [], subtitle = '', title, toolResult }) {
  const outputType = toolResult?.outputType || 'structured_tool_result';
  const outcome = outputOutcome(toolResult);
  return (
    <div
      className="d-flex flex-wrap align-items-start justify-content-between gap-3 mb-3"
      data-structured-output-type={outputType}
    >
      <div>
        <div className="sky-page-kicker">Structured ToolResult</div>
        <h3 className="h6 mb-1">{title}</h3>
        <p className="small sky-muted mb-0">{truncate(toolResult?.message || subtitle, 360)}</p>
      </div>
      <div className="d-flex flex-wrap gap-2">
        <span className={'sky-pill ' + outcomeClass(outcome)}>{outcome}</span>
        {pills.map((pill, index) => (
          <span
            className={'sky-pill ' + (pill.className || 'sky-pill-info')}
            key={String(pill.value) + '-' + index}
          >
            {pill.value}
          </span>
        ))}
      </div>
    </div>
  );
}

function StructuredWarnings({ errors = [], output = {}, toolResult }) {
  const warnings = mergeStructuredWarnings(toolResult?.warnings, output?.warnings);
  const errorValues = [
    ...getSafeArray(errors),
    ...(output?.error ? [output.error] : []),
    ...(toolResult?.error ? [toolResult.error] : []),
  ];
  if (warnings.length === 0 && errorValues.length === 0) return null;
  return (
    <div className="mt-3">
      {errorValues.length > 0 ? (
        <div className="alert alert-danger mb-2">
          <strong>Error:</strong>{' '}
          {errorValues.slice(0, 8).map((error, index) => (
            <span key={'error-' + index}>
              {index ? ' · ' : ''}
              {truncate(error?.message || error?.code || error, 360)}
            </span>
          ))}
        </div>
      ) : null}
      {warnings.length > 0 ? (
        <div className="alert alert-warning mb-0">
          <strong>Warnings:</strong>{' '}
          {warnings.slice(0, 12).map((warning, index) => (
            <span key={'warning-' + index}>
              {index ? ' · ' : ''}
              {truncate(getStructuredWarningDisplayValue(warning), 360)}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function ValidationChecksTable({ checks = [] }) {
  const values = getSafeArray(checks);
  if (values.length === 0)
    return <div className="sky-empty-state">No validation checks were recorded.</div>;
  return (
    <div className="table-responsive sky-table-card">
      <table className="table table-sm sky-table align-middle mb-0">
        <thead>
          <tr>
            <th>Check</th>
            <th>Classification</th>
            <th>Status</th>
            <th>Duration</th>
            <th>Exit code</th>
          </tr>
        </thead>
        <tbody>
          {values.slice(0, MAX_ROWS).map((check, index) => (
            <tr key={(check?.name || 'check') + '-' + index}>
              <td className="text-break">{check?.name || check?.detail || 'Unnamed check'}</td>
              <td>{check?.classification || 'REQUIRED'}</td>
              <td>
                <span
                  className={
                    'sky-pill ' +
                    (String(check?.classification || '').toUpperCase() ===
                    'KNOWN_BASELINE_LIMITATION'
                      ? 'sky-pill-warning'
                      : outcomeClass(check?.status))
                  }
                >
                  {check?.status || 'UNKNOWN'}
                </span>
              </td>
              <td>{formatDuration(check?.durationMs)}</td>
              <td>
                {check?.exitCode === null || check?.exitCode === undefined ? '—' : check.exitCode}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function CapabilityCatalogOutput({ toolResult }) {
  const output = getSafeObject(toolResult?.output);
  const artifacts = getSafeObject(output.artifacts || output.generatedArtifacts);
  return (
    <div data-testid="structured-output-capability-catalog">
      <StructuredResultHeader
        toolResult={toolResult}
        title="Capability Catalogue"
        subtitle="Generated capability and structured-output evidence."
        pills={[
          { value: output.capabilityCount ?? output.count, className: 'sky-pill-info' },
          {
            value: output.outputTypeCount ?? output.structuredOutputTypeCount,
            className: 'sky-pill-info',
          },
        ].filter((pill) => pill.value !== undefined)}
      />
      <StructuredSection title="Catalogue evidence">
        <StructuredKeyValueTable
          rows={[
            {
              key: 'catalogueVersion',
              label: 'Catalogue version',
              value: output.catalogueVersion || output.version,
            },
            {
              key: 'capabilityCount',
              label: 'Capability count',
              value: output.capabilityCount ?? output.count,
            },
            {
              key: 'outputTypeCount',
              label: 'Output type count',
              value: output.outputTypeCount ?? output.structuredOutputTypeCount,
            },
            {
              key: 'generatedAt',
              label: 'Generated at',
              value: output.generatedAt || output.createdAt,
            },
            {
              key: 'catalogueDigest',
              label: 'Catalogue digest',
              value: output.catalogueDigest || output.digest,
            },
          ]}
        />
      </StructuredSection>
      <StructuredSection title="Database and runtime identity">
        <StructuredKeyValueTable
          rows={[
            {
              key: 'database',
              label: 'Database',
              value: output.database?.database || output.databaseName,
            },
            {
              key: 'systemIdentifier',
              label: 'System identifier',
              value: output.database?.systemIdentifier || output.systemIdentifier,
            },
            {
              key: 'sourceRevision',
              label: 'Source revision',
              value: output.sourceRevision || output.sourceIdentity?.revision,
            },
            {
              key: 'environment',
              label: 'Environment',
              value: output.environment || output.binding?.environment,
            },
          ]}
        />
      </StructuredSection>
      <StructuredSection title="Generated artifacts">
        <StructuredKeyValueTable
          rows={[
            {
              key: 'jsonPath',
              label: 'JSON path',
              value:
                artifacts.json?.path || artifacts.capabilityCatalogJson?.path || output.jsonPath,
            },
            {
              key: 'jsonSha256',
              label: 'JSON SHA-256',
              value: artifacts.json?.sha256 || artifacts.capabilityCatalogJson?.sha256,
            },
            {
              key: 'xlsxPath',
              label: 'XLSX path',
              value:
                artifacts.xlsx?.path || artifacts.capabilityCatalogXlsx?.path || output.xlsxPath,
            },
            {
              key: 'xlsxSha256',
              label: 'XLSX SHA-256',
              value: artifacts.xlsx?.sha256 || artifacts.capabilityCatalogXlsx?.sha256,
            },
          ]}
        />
      </StructuredSection>
      {output.resourceFamilies || output.resources ? (
        <StructuredSection title="Resource families">
          <StructuredValueCell
            fieldKey="resources"
            value={output.resourceFamilies || output.resources}
          />
        </StructuredSection>
      ) : null}
      <StructuredWarnings output={output} toolResult={toolResult} />
    </div>
  );
}

export function DatabaseUpgradeOutput({ toolResult }) {
  const output = getSafeObject(toolResult?.output);
  return (
    <div data-testid="structured-output-database-upgrade">
      <StructuredResultHeader
        toolResult={toolResult}
        title="Database upgrade"
        subtitle="Governed migration plan, execution, and ledger evidence."
      />
      <StructuredSection title="Outcome and binding">
        <StructuredKeyValueTable
          rows={[
            { key: 'mode', label: 'Mode', value: output.mode },
            {
              key: 'database',
              label: 'Database',
              value: output.databaseIdentity?.database || output.database,
            },
            {
              key: 'systemIdentifier',
              label: 'System identifier',
              value: output.databaseIdentity?.systemIdentifier,
            },
            { key: 'sourceRevision', label: 'Source revision', value: output.sourceRevision },
            { key: 'planDigest', label: 'Plan digest', value: output.planDigest },
            { key: 'manifestDigest', label: 'Manifest digest', value: output.manifestDigest },
            { key: 'pendingCount', label: 'Pending changes', value: output.pendingCount },
            { key: 'appliedCount', label: 'Applied changes', value: output.appliedCount },
          ]}
        />
      </StructuredSection>
      <StructuredSection title="Migration and file outcomes">
        <StructuredArrayTable
          items={output.fileOutcomes || output.pendingChanges || output.changes}
        />
      </StructuredSection>
      <StructuredSection title="Ledger, lock, and revalidation">
        <StructuredKeyValueTable
          rows={[
            { key: 'ledger', label: 'Ledger', value: output.ledger },
            { key: 'lock', label: 'Lock', value: output.lock },
            { key: 'revalidation', label: 'Revalidation', value: output.revalidation },
            {
              key: 'durationMs',
              label: 'Duration',
              value: output.timing?.durationMs || output.durationMs,
            },
          ]}
        />
      </StructuredSection>
      <StructuredWarnings errors={output.errors} output={output} toolResult={toolResult} />
    </div>
  );
}

export function DevEnvReconcileOutput({ toolResult }) {
  const output = getSafeObject(toolResult?.output);
  return (
    <div data-testid="structured-output-dev-env-reconcile">
      <StructuredResultHeader
        toolResult={toolResult}
        title="Development environment reconciliation"
        subtitle="Allowlisted, credential-bound configuration evidence."
      />
      <StructuredSection title="Binding and outcome">
        <StructuredKeyValueTable
          rows={[
            { key: 'binding', label: 'Binding', value: output.binding },
            {
              key: 'configurationRevision',
              label: 'Configuration revision',
              value: output.configurationRevision,
            },
            { key: 'outcome', label: 'Outcome', value: output.outcome },
            { key: 'execution', label: 'Execution', value: output.execution },
            { key: 'restart', label: 'Restart', value: output.restart },
          ]}
        />
      </StructuredSection>
      <StructuredSection title="Requested and changed keys">
        <StructuredKeyValueTable
          rows={[
            { key: 'requestedKeys', label: 'Requested keys', value: output.requestedKeys },
            { key: 'changedKeys', label: 'Changed keys', value: output.changedKeys },
            { key: 'classifications', label: 'Classifications', value: output.classifications },
            {
              key: 'missingRequiredSecrets',
              label: 'Missing required secret names',
              value: output.missingRequiredSecrets,
            },
            { key: 'envExample', label: 'Example configuration', value: output.envExample },
          ]}
        />
      </StructuredSection>
      <StructuredSection title="Concurrency and restart">
        <StructuredKeyValueTable
          rows={[
            { key: 'concurrency', label: 'Concurrency', value: output.concurrency },
            {
              key: 'restartRequested',
              label: 'Restart requested',
              value: output.restart?.requested,
            },
            { key: 'restartOutcome', label: 'Restart outcome', value: output.restart?.outcome },
          ]}
        />
      </StructuredSection>
      <StructuredWarnings errors={output.errors} output={output} toolResult={toolResult} />
    </div>
  );
}

export function DevFinalizationPreflightOutput({ toolResult }) {
  const output = getSafeObject(toolResult?.output);
  const source = getSafeObject(output.sourceIdentity);
  return (
    <div data-testid="structured-output-dev-finalization-preflight">
      <StructuredResultHeader
        toolResult={toolResult}
        title="DEV finalization preflight"
        subtitle="Source, environment, database, and lifecycle gates."
      />
      <StructuredSection title="Run and binding">
        <StructuredKeyValueTable
          rows={[
            { key: 'runId', label: 'Run ID', value: output.runId },
            { key: 'contract', label: 'Contract', value: output.contract },
            { key: 'outcome', label: 'Outcome', value: output.outcome },
            { key: 'binding', label: 'Binding', value: output.binding },
            { key: 'environment', label: 'Environment', value: output.environment },
            {
              key: 'revision',
              label: 'Source revision',
              value: source.revision || source.commitSha,
            },
            {
              key: 'sourceIdentityDigest',
              label: 'Source identity digest',
              value: source.digest || output.priorSourceIdentityDigest,
            },
          ]}
        />
      </StructuredSection>
      <StructuredSection title="Change and lifecycle gates">
        <StructuredKeyValueTable
          rows={[
            { key: 'sourceChanged', label: 'Source changed', value: output.sourceChanged },
            {
              key: 'changedPathCount',
              label: 'Changed path count',
              value: output.changedPathCount,
            },
            {
              key: 'changedPathsDigest',
              label: 'Changed paths digest',
              value: output.changedPathsDigest,
            },
            {
              key: 'lifecycleServicesJson',
              label: 'Lifecycle services',
              value: output.lifecycleServicesJson,
            },
            { key: 'partialRun', label: 'Partial run', value: output.partialRun },
            { key: 'lock', label: 'Lock', value: output.lock },
          ]}
        />
        <StructuredArrayTable items={output.changedPaths} />
      </StructuredSection>
      <StructuredSection title="Environment and database gates">
        <StructuredKeyValueTable
          rows={[
            {
              key: 'patchRequested',
              label: 'Environment patch requested',
              value: output.environment?.patchRequested,
            },
            {
              key: 'requestedKeys',
              label: 'Requested keys',
              value: output.environment?.requestedKeys,
            },
            { key: 'database', label: 'Database', value: output.database },
          ]}
        />
      </StructuredSection>
      <StructuredWarnings errors={output.error} output={output} toolResult={toolResult} />
    </div>
  );
}

export function DevFinalizationLifecycleOutput({ toolResult }) {
  const output = getSafeObject(toolResult?.output);
  return (
    <div data-testid="structured-output-dev-finalization-lifecycle">
      <StructuredResultHeader
        toolResult={toolResult}
        title="DEV finalization lifecycle"
        subtitle="Durable, idempotent runtime reconciliation evidence."
        pills={[
          { value: output.action, className: 'sky-pill-info' },
          { value: output.status, className: 'sky-pill-success' },
        ].filter((pill) => pill.value)}
      />
      <StructuredSection title="Lifecycle action">
        <StructuredKeyValueTable
          rows={[
            { key: 'action', label: 'Action', value: output.action },
            { key: 'outcome', label: 'Outcome', value: output.outcome },
            { key: 'status', label: 'Status', value: output.status },
            { key: 'services', label: 'Services', value: output.services },
            {
              key: 'idempotencyOutcome',
              label: 'Idempotency outcome',
              value: output.idempotencyOutcome,
            },
            { key: 'operationId', label: 'Operation ID', value: output.operationId },
            { key: 'hostWorkflowId', label: 'Host workflow ID', value: output.hostWorkflowId },
            { key: 'hostRunId', label: 'Host run ID', value: output.hostRunId },
            { key: 'timing', label: 'Timing', value: output.timing },
          ]}
        />
      </StructuredSection>
      <StructuredSection title="Lifecycle evidence">
        <StructuredObjectTable value={output} />
      </StructuredSection>
      <StructuredWarnings errors={output.error} output={output} toolResult={toolResult} />
    </div>
  );
}

export function DevFinalizationValidationOutput({ toolResult }) {
  const output = getSafeObject(toolResult?.output);
  return (
    <div data-testid="structured-output-dev-finalization-validation">
      <StructuredResultHeader
        toolResult={toolResult}
        title="DEV finalization validation"
        subtitle="Validation profile, checks, and known limitations."
        pills={[
          { value: `${output.passedCount ?? 0} passed`, className: 'sky-pill-success' },
          {
            value: `${output.knownLimitationCount ?? 0} known limitation(s)`,
            className: 'sky-pill-warning',
          },
          {
            value: `${output.failedCount ?? 0} failed`,
            className: output.failedCount ? 'sky-pill-danger' : 'sky-pill-success',
          },
        ]}
      />
      <StructuredSection title="Validation overview">
        <StructuredKeyValueTable
          rows={[
            { key: 'profile', label: 'Profile', value: output.profile },
            { key: 'passedCount', label: 'Passed', value: output.passedCount },
            {
              key: 'knownLimitationCount',
              label: 'Known limitations',
              value: output.knownLimitationCount,
            },
            { key: 'failedCount', label: 'Failed', value: output.failedCount },
            {
              key: 'durationMs',
              label: 'Duration',
              value: output.timing?.durationMs || output.durationMs,
            },
          ]}
        />
      </StructuredSection>
      <StructuredSection title="Validation checks">
        <ValidationChecksTable checks={output.checks} />
      </StructuredSection>
      <StructuredWarnings errors={output.error} output={output} toolResult={toolResult} />
    </div>
  );
}

export function DevFinalizationReadinessOutput({ toolResult }) {
  const output = getSafeObject(toolResult?.output);
  return (
    <div data-testid="structured-output-dev-finalization-readiness">
      <StructuredResultHeader
        toolResult={toolResult}
        title="DEV finalization readiness"
        subtitle="Final runtime, database, and registration probes."
      />
      <StructuredSection title="Readiness overview">
        <StructuredKeyValueTable
          rows={[
            { key: 'runId', label: 'Run ID', value: output.runId },
            { key: 'outcome', label: 'Outcome', value: output.outcome },
            { key: 'runtime', label: 'Runtime', value: output.runtime },
            { key: 'database', label: 'Database', value: output.database },
            {
              key: 'workflowRegistrations',
              label: 'Workflow registrations',
              value: output.registrations?.workflow || output.registrations,
            },
            {
              key: 'toolRegistrations',
              label: 'Tool registrations',
              value: output.registrations?.tools,
            },
            {
              key: 'durationMs',
              label: 'Duration',
              value: output.timing?.durationMs || output.durationMs,
            },
          ]}
        />
      </StructuredSection>
      <StructuredSection title="Readiness probes">
        <ReadinessProbesTable probes={output.probes} />
      </StructuredSection>
      <StructuredWarnings errors={output.error} output={output} toolResult={toolResult} />
    </div>
  );
}

export function DevFinalizationReceiptOutput({ toolResult }) {
  const output = getSafeObject(toolResult?.output);
  const source = getSafeObject(output.sourceIdentity);
  const environment = getSafeObject(output.environment);
  const database = getSafeObject(output.database);
  const lifecycle = getSafeObject(output.lifecycle);
  const validation = getSafeObject(output.validation);
  const readiness = getSafeObject(output.readiness);
  const artifacts = getSafeObject(output.artifacts);
  return (
    <div data-testid="structured-output-dev-finalization-receipt">
      <StructuredResultHeader
        toolResult={toolResult}
        title="DEV finalization receipt"
        subtitle="Durable receipt for source, environment, database, lifecycle, validation, readiness, and artifacts."
        pills={[
          {
            value: output.outcome,
            className: output.outcome === 'COMPLETE' ? 'sky-pill-success' : 'sky-pill-warning',
          },
          {
            value: output.runId ? `Run ${truncate(output.runId, 18)}` : undefined,
            className: 'sky-pill-info',
          },
        ].filter((pill) => pill.value)}
      />
      <StructuredSection title="Receipt header">
        <StructuredKeyValueTable
          rows={[
            { key: 'contract', label: 'Contract', value: output.contract },
            { key: 'outcome', label: 'Outcome', value: output.outcome },
            { key: 'runId', label: 'Run ID', value: output.runId },
            { key: 'receiptPath', label: 'Receipt path', value: output.receiptPath },
            { key: 'receiptSha256', label: 'Receipt SHA-256', value: output.receiptSha256 },
          ]}
        />
      </StructuredSection>
      <StructuredSection title="Source and environment">
        <StructuredKeyValueTable
          rows={[
            { key: 'sourceIdentity', label: 'Source identity', value: source },
            { key: 'environment', label: 'Environment', value: environment },
            {
              key: 'lockReleasePolicy',
              label: 'Lock release policy',
              value: output.lockReleasePolicy,
            },
            {
              key: 'lockStateAtPersist',
              label: 'Lock at persist',
              value: output.lockStateAtPersist,
            },
            { key: 'lockReleased', label: 'Lock released', value: output.lockReleased },
          ]}
        />
      </StructuredSection>
      <StructuredSection title="Database and lifecycle">
        <StructuredKeyValueTable
          rows={[
            { key: 'database', label: 'Database', value: database },
            { key: 'lifecycle', label: 'Lifecycle', value: lifecycle },
            { key: 'sourceChange', label: 'Source change', value: output.sourceChange },
          ]}
        />
      </StructuredSection>
      <StructuredSection title="Validation and readiness">
        <StructuredKeyValueTable
          rows={[
            { key: 'validationOutcome', label: 'Validation outcome', value: validation.outcome },
            { key: 'passedCount', label: 'Validation passed', value: validation.passedCount },
            {
              key: 'knownLimitationCount',
              label: 'Known limitations',
              value: validation.knownLimitationCount,
            },
            { key: 'failedCount', label: 'Validation failed', value: validation.failedCount },
            { key: 'readinessOutcome', label: 'Readiness outcome', value: readiness.outcome },
          ]}
        />
        {validation.checks ? <ValidationChecksTable checks={validation.checks} /> : null}
        {readiness.probes ? <ReadinessProbesTable probes={readiness.probes} /> : null}
      </StructuredSection>
      <StructuredSection title="Artifacts and ZIP evidence">
        <StructuredKeyValueTable
          rows={[
            { key: 'artifacts', label: 'Artifacts', value: artifacts },
            { key: 'zipEntries', label: 'ZIP entries', value: output.zipEntries },
            {
              key: 'receiptSelfHashConvention',
              label: 'Receipt self-hash convention',
              value: output.receiptSelfHashConvention,
            },
          ]}
        />
      </StructuredSection>
      <StructuredWarnings errors={output.error} output={output} toolResult={toolResult} />
    </div>
  );
}

export function GitDevPullOutput({ toolResult }) {
  const output = getSafeObject(toolResult?.output);
  return (
    <div data-testid="structured-output-git-dev-pull">
      <StructuredResultHeader
        toolResult={toolResult}
        title="Git DEV pull"
        subtitle="Bounded DEV synchronization and safeguard evidence."
        pills={[
          {
            value: output.outcome,
            className: output.synchronized ? 'sky-pill-success' : 'sky-pill-warning',
          },
          {
            value:
              output.commitsPulled !== undefined ? `${output.commitsPulled} commit(s)` : undefined,
            className: 'sky-pill-info',
          },
        ].filter((pill) => pill.value !== undefined)}
      />
      <StructuredSection title="Repository and synchronization">
        <StructuredKeyValueTable
          rows={[
            { key: 'operationKind', label: 'Operation', value: output.operationKind },
            { key: 'executionTarget', label: 'Execution target', value: output.executionTarget },
            { key: 'repositoryName', label: 'Repository', value: output.repositoryName },
            { key: 'repositoryRoot', label: 'Repository root', value: output.repositoryRoot },
            { key: 'currentBranch', label: 'Current branch', value: output.currentBranch },
            { key: 'outcome', label: 'Outcome', value: output.outcome },
            { key: 'synchronized', label: 'Synchronized', value: output.synchronized },
          ]}
        />
      </StructuredSection>
      <StructuredSection title="Source references">
        <StructuredKeyValueTable
          rows={[
            {
              key: 'localDevBeforeSha',
              label: 'Local DEV before',
              value: output.localDevBeforeSha,
            },
            {
              key: 'remoteDevBeforeSha',
              label: 'Remote DEV before',
              value: output.remoteDevBeforeSha,
            },
            {
              key: 'fetchedRemoteDevSha',
              label: 'Fetched remote DEV',
              value: output.fetchedRemoteDevSha,
            },
            { key: 'localDevAfterSha', label: 'Local DEV after', value: output.localDevAfterSha },
            {
              key: 'remoteDevAfterSha',
              label: 'Remote DEV after',
              value: output.remoteDevAfterSha,
            },
            { key: 'currentHeadSha', label: 'Current HEAD', value: output.currentHeadSha },
            { key: 'commitsPulled', label: 'Commits pulled', value: output.commitsPulled },
            { key: 'stashCount', label: 'Stash count', value: output.stashCount },
          ]}
        />
      </StructuredSection>
      <StructuredSection title="Safeguards and steps">
        <StructuredKeyValueTable
          rows={[
            { key: 'safeguards', label: 'Safeguards', value: output.safeguards },
            {
              key: 'workingTreeCleanBefore',
              label: 'Clean before',
              value: output.workingTreeCleanBefore,
            },
            {
              key: 'workingTreeCleanAfter',
              label: 'Clean after',
              value: output.workingTreeCleanAfter,
            },
          ]}
        />
        <StructuredArrayTable items={output.steps} />
      </StructuredSection>
      <StructuredSection title="Performance and transport telemetry">
        <StructuredKeyValueTable
          rows={[
            { key: 'durationMs', label: 'Duration', value: output.durationMs },
            {
              key: 'performanceTelemetry',
              label: 'Performance telemetry',
              value: output.performanceTelemetry,
            },
            {
              key: 'transportTelemetry',
              label: 'Transport telemetry',
              value: output.transportTelemetry,
            },
          ]}
        />
      </StructuredSection>
      <StructuredWarnings errors={output.error} output={output} toolResult={toolResult} />
    </div>
  );
}

export function BrowserAutomationOutput({ toolResult }) {
  const output = getSafeObject(toolResult?.output);
  return (
    <div data-testid="structured-output-browser-automation">
      <StructuredResultHeader
        toolResult={toolResult}
        title="Browser automation"
        subtitle="Bounded browser execution and artifact evidence."
        pills={[
          {
            value: output.status,
            className: output.status === 'SUCCESS' ? 'sky-pill-success' : 'sky-pill-warning',
          },
          { value: output.browser, className: 'sky-pill-info' },
        ].filter((pill) => pill.value)}
      />
      <StructuredSection title="Execution">
        <StructuredKeyValueTable
          rows={[
            { key: 'contract', label: 'Contract', value: output.contract },
            { key: 'automationCode', label: 'Automation code', value: output.automationCode },
            { key: 'browser', label: 'Browser', value: output.browser },
            { key: 'environment', label: 'Environment', value: output.environment },
            { key: 'durationMs', label: 'Duration', value: output.durationMs },
          ]}
        />
      </StructuredSection>
      <StructuredSection title="Result">
        <StructuredValueCell fieldKey="result" value={output.result} />
      </StructuredSection>
      <StructuredSection title="Artifacts">
        <StructuredArrayTable items={output.artifacts} />
      </StructuredSection>
      <StructuredWarnings errors={output.error} output={output} toolResult={toolResult} />
    </div>
  );
}

export function GenericStructuredToolResultOutput({ toolResult }) {
  const output = getSafeObject(toolResult?.output);
  const rows = Object.entries(output)
    .slice(0, MAX_COLUMNS * 4)
    .map(([key, value]) => ({ key, label: humanize(key), value }));
  return (
    <div data-testid="structured-output-generic-fallback">
      <StructuredResultHeader
        toolResult={toolResult}
        title="Structured ToolResult"
        subtitle="A bounded generic view is being used for an unregistered structured output type."
      />
      <StructuredSection title="Structured summary">
        <StructuredKeyValueTable rows={rows} />
      </StructuredSection>
      <StructuredSection title="Nested evidence">
        <StructuredObjectTable value={output} />
      </StructuredSection>
      <StructuredWarnings errors={output.error} output={output} toolResult={toolResult} />
    </div>
  );
}

export function getStructuredToolResultSummary(toolResult) {
  const output = getSafeObject(toolResult?.output);
  const outputType = toolResult?.outputType;
  if (outputType === 'capability_catalog_summary.v1')
    return `${output.capabilityCount ?? output.count ?? 0} capabilities`;
  if (outputType === 'database_upgrade_summary.v1') return `${output.pendingCount ?? 0} pending`;
  if (outputType === 'dev_finalization_validation_summary.v1')
    return `${output.passedCount ?? 0} passed / ${output.failedCount ?? 0} failed`;
  if (outputType === 'dev_finalization_readiness_summary.v1')
    return String(output.outcome || 'Readiness');
  if (outputType === 'dev_finalization_lifecycle_summary.v1')
    return String(output.status || output.outcome || 'Lifecycle');
  if (outputType === 'dev_finalization_summary.v1') return String(output.outcome || 'Receipt');
  if (outputType === 'browser_automation_summary.v1') return String(output.status || 'Browser');
  return String(
    output.outcome ||
      output.status ||
      output.result?.status ||
      humanize(outputType || 'Structured result'),
  );
}

function ReadinessProbesTable({ probes = [] }) {
  const values = getSafeArray(probes);
  if (values.length === 0)
    return <div className="sky-empty-state">No readiness probes were recorded.</div>;
  return (
    <div className="table-responsive sky-table-card">
      <table className="table table-sm sky-table align-middle mb-0">
        <thead>
          <tr>
            <th>Probe</th>
            <th>Status</th>
            <th>Detail</th>
          </tr>
        </thead>
        <tbody>
          {values.slice(0, MAX_ROWS).map((probe, index) => (
            <tr key={(probe?.name || 'probe') + '-' + index}>
              <td>{probe?.name || 'Unnamed probe'}</td>
              <td>
                <span className={'sky-pill ' + outcomeClass(probe?.status)}>
                  {probe?.status || 'UNKNOWN'}
                </span>
              </td>
              <td className="text-break">{probe?.detail || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
