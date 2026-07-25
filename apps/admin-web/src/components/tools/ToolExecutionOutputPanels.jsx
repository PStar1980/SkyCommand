import StatusPill from '../ui/StatusPill.jsx';

function hasText(value) {
  return Boolean(String(value || '').trim());
}

function formatJson(value) {
  if (value === undefined || value === null) {
    return '—';
  }

  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function OutputBlock({ children, tone = 'default' }) {
  return (
    <pre
      className={`sky-code-block sky-tool-output-block ${
        tone === 'stderr' ? 'sky-tool-output-block-error' : ''
      }`.trim()}
    >
      {children}
    </pre>
  );
}

function ProcessOutputCard({ loading = false, stderr = '', stdout = '' }) {
  const hasStdout = hasText(stdout);
  const hasStderr = hasText(stderr);

  return (
    <section className="sky-card sky-tool-output-card">
      <div className="sky-card-header sky-tool-output-card-header">
        <div>
          <div className="sky-page-kicker">Streamed tool output</div>
          <h3 className="h5 mb-0">Process output</h3>
          <div className="small sky-muted mt-1">
            Captured stdout and stderr emitted by the tool process. Run Tools displays these streams when execution completes.
          </div>
        </div>
        <div className="d-flex flex-wrap gap-1">
          <span className={`sky-pill ${hasStdout ? 'sky-pill-success' : 'sky-pill-info'}`}>
            stdout {hasStdout ? 'available' : 'empty'}
          </span>
          <span className={`sky-pill ${hasStderr ? 'sky-pill-warning' : 'sky-pill-info'}`}>
            stderr {hasStderr ? 'available' : 'empty'}
          </span>
        </div>
      </div>
      <div className="sky-card-body sky-tool-output-card-body">
        {loading ? (
          <div className="sky-empty-state">Loading process output...</div>
        ) : !hasStdout && !hasStderr ? (
          <div className="sky-empty-state">No stdout or stderr was recorded for this execution.</div>
        ) : (
          <div className="sky-tool-stream-grid">
            {hasStdout && (
              <div className="sky-tool-output-section">
                <div className="sky-detail-label mb-2">stdout</div>
                <OutputBlock>{stdout}</OutputBlock>
              </div>
            )}
            {hasStderr && (
              <div className="sky-tool-output-section">
                <div className="sky-detail-label mb-2">stderr</div>
                <OutputBlock tone="stderr">{stderr}</OutputBlock>
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

function StructuredOutputCard({
  loading = false,
  structuredOutputExpected = false,
  toolResult = null,
  toolResultContract = null,
}) {
  const outputType = toolResult?.outputType || toolResultContract?.outputType || null;
  const contractStatus = toolResultContract?.status || null;

  return (
    <section className="sky-card sky-tool-output-card">
      <div className="sky-card-header sky-tool-output-card-header">
        <div>
          <div className="sky-page-kicker">Structured output</div>
          <h3 className="h5 mb-0">ToolResult</h3>
          <div className="small sky-muted mt-1">
            Versioned workflow-safe evidence emitted through the structured output contract.
          </div>
        </div>
        <div className="d-flex flex-wrap gap-1">
          {outputType && <span className="sky-pill sky-pill-info">{outputType}</span>}
          {contractStatus && <StatusPill status={contractStatus}>{contractStatus}</StatusPill>}
        </div>
      </div>
      <div className="sky-card-body sky-tool-output-card-body">
        {loading ? (
          <div className="sky-empty-state">Loading structured output...</div>
        ) : toolResult ? (
          <>
            <div className="sky-tool-result-summary mb-3">
              <div>
                <div className="sky-detail-label">Result</div>
                <StatusPill status={toolResult.success ? 'SUCCESS' : 'FAILED'}>
                  {toolResult.success ? 'SUCCESS' : 'FAILED'}
                </StatusPill>
              </div>
              <div className="sky-tool-result-message">
                <div className="sky-detail-label">Message</div>
                <div className="sky-detail-value">{toolResult.message || '—'}</div>
              </div>
            </div>
            <div className="sky-detail-label mb-2">Structured payload</div>
            <OutputBlock>{formatJson(toolResult.output ?? toolResult)}</OutputBlock>
            {Array.isArray(toolResult.warnings) && toolResult.warnings.length > 0 && (
              <div className="alert alert-warning mt-3 mb-0">
                <strong>Warnings:</strong> {toolResult.warnings.join(' · ')}
              </div>
            )}
          </>
        ) : structuredOutputExpected ? (
          <div className="sky-empty-state">
            Structured output was expected, but no persisted payload is available for this execution.
            Run the tool again to retain and display the ToolResult here.
          </div>
        ) : (
          <div className="sky-empty-state">This tool did not emit a structured ToolResult.</div>
        )}
      </div>
    </section>
  );
}

function ToolExecutionOutputPanels({
  className = '',
  loading = false,
  stderr = '',
  stdout = '',
  structuredOutputExpected = false,
  toolResult = null,
  toolResultContract = null,
}) {
  return (
    <div className={`sky-tool-output-grid ${className}`.trim()}>
      <ProcessOutputCard loading={loading} stderr={stderr} stdout={stdout} />
      <StructuredOutputCard
        loading={loading}
        structuredOutputExpected={structuredOutputExpected}
        toolResult={toolResult}
        toolResultContract={toolResultContract}
      />
    </div>
  );
}

export default ToolExecutionOutputPanels;
