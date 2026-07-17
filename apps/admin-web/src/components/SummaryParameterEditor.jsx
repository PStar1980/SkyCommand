export const DEFAULT_SUMMARY_PARAMETERS = {
  title: '',
  summaryTemplate: '',
  technicalDetailsTemplate: '',
  recommendedNextActions: '',
  includeKeyOutputs: true,
  includeWarnings: true,
  includeTimings: true,
};

function getSafeObject(value, fallback = {}) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : fallback;
}

function toBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }

  return value === true || value === 'true' || value === '1';
}

export function cleanSummaryParameterValues(values = {}) {
  const input = {
    ...DEFAULT_SUMMARY_PARAMETERS,
    ...getSafeObject(values),
  };

  return {
    title: String(input.title || '').trim(),
    summaryTemplate: String(input.summaryTemplate || input.template || '').trim(),
    technicalDetailsTemplate: String(
      input.technicalDetailsTemplate || input.technicalTemplate || '',
    ).trim(),
    recommendedNextActions: String(input.recommendedNextActions || '').trim(),
    includeKeyOutputs: toBoolean(input.includeKeyOutputs, true),
    includeWarnings: toBoolean(input.includeWarnings, true),
    includeTimings: toBoolean(input.includeTimings, true),
  };
}

export function getSummaryExpressionSummary(parameters = {}) {
  const input = cleanSummaryParameterValues(parameters);

  if (input.summaryTemplate) {
    return 'custom summary template';
  }

  return 'auto summary from params, context, outputs, and timings';
}

export default function SummaryParameterEditor({
  idPrefix = 'summary-parameter',
  parameters = {},
  onChange,
}) {
  const values = {
    ...DEFAULT_SUMMARY_PARAMETERS,
    ...getSafeObject(parameters),
  };

  function patch(changes) {
    onChange?.({ ...values, ...changes });
  }

  return (
    <div className="row g-3">
      <div className="col-lg-6">
        <label className="form-label" htmlFor={`${idPrefix}-title`}>
          Summary title
        </label>
        <input
          className="form-control sky-form-control"
          id={`${idPrefix}-title`}
          onChange={(event) => patch({ title: event.target.value })}
          placeholder="Workflow run summary"
          value={values.title || ''}
        />
        <div className="form-text">Optional. Leave blank to use the workflow name.</div>
      </div>

      <div className="col-lg-6">
        <label className="form-label" htmlFor={`${idPrefix}-actions`}>
          Recommended next actions
        </label>
        <input
          className="form-control sky-form-control"
          id={`${idPrefix}-actions`}
          onChange={(event) => patch({ recommendedNextActions: event.target.value })}
          placeholder="Optional; separate multiple actions with new lines or semicolons."
          value={values.recommendedNextActions || ''}
        />
      </div>

      <div className="col-12">
        <label className="form-label" htmlFor={`${idPrefix}-summary-template`}>
          Summary template
        </label>
        <textarea
          className="form-control sky-form-control"
          id={`${idPrefix}-summary-template`}
          onChange={(event) => patch({ summaryTemplate: event.target.value })}
          placeholder="Optional. Example: Macro refresh inserted {{ nodes.fred_ingestion.output.totals.rowsInserted }} FRED row(s)."
          rows={3}
          value={values.summaryTemplate || ''}
        />
        <div className="form-text">
          Supports canonical paths such as{' '}
          <span className="sky-mono">{'{{ nodes.some_node.output.customField }}'}</span> for domain
          results and <span className="sky-mono">{'{{ nodes.some_node.result.success }}'}</span> for
          the complete ToolResult envelope.
        </div>
      </div>

      <div className="col-12">
        <label className="form-label" htmlFor={`${idPrefix}-technical-template`}>
          Technical details template
        </label>
        <textarea
          className="form-control sky-form-control"
          id={`${idPrefix}-technical-template`}
          onChange={(event) => patch({ technicalDetailsTemplate: event.target.value })}
          placeholder="Optional technical summary, artifact path, commit hash, counts, or operator notes."
          rows={2}
          value={values.technicalDetailsTemplate || ''}
        />
      </div>

      <div className="col-12 d-flex flex-wrap gap-3">
        <label className="sky-toggle-row mb-0" htmlFor={`${idPrefix}-key-outputs`}>
          <input
            checked={values.includeKeyOutputs !== false && values.includeKeyOutputs !== 'false'}
            id={`${idPrefix}-key-outputs`}
            onChange={(event) => patch({ includeKeyOutputs: event.target.checked })}
            type="checkbox"
          />
          <span>Include key outputs</span>
        </label>
        <label className="sky-toggle-row mb-0" htmlFor={`${idPrefix}-warnings`}>
          <input
            checked={values.includeWarnings !== false && values.includeWarnings !== 'false'}
            id={`${idPrefix}-warnings`}
            onChange={(event) => patch({ includeWarnings: event.target.checked })}
            type="checkbox"
          />
          <span>Include warnings/errors</span>
        </label>
        <label className="sky-toggle-row mb-0" htmlFor={`${idPrefix}-timings`}>
          <input
            checked={values.includeTimings !== false && values.includeTimings !== 'false'}
            id={`${idPrefix}-timings`}
            onChange={(event) => patch({ includeTimings: event.target.checked })}
            type="checkbox"
          />
          <span>Include timings</span>
        </label>
      </div>
    </div>
  );
}
